// quickbooks.js — QuickBooks Online Integration
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const QB_BASE_URL = process.env.QB_SANDBOX === "true"
  ? "https://sandbox-quickbooks.api.intuit.com"
  : "https://quickbooks.api.intuit.com";

const QB_AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const QB_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

// ── OAUTH FLOW ──────────────────────────────────────────────────

// Step 1: Generate auth URL for user to authorize
function getAuthUrl(teamId) {
  const params = new URLSearchParams({
    client_id: process.env.QB_CLIENT_ID,
    redirect_uri: process.env.QB_REDIRECT_URI,
    response_type: "code",
    scope: "com.intuit.quickbooks.accounting",
    state: teamId, // pass teamId so we know which team is connecting
  });
  return `${QB_AUTH_URL}?${params.toString()}`;
}

// Step 2: Exchange code for tokens (called after redirect)
async function exchangeCode(code, teamId, realmId) {
  const credentials = Buffer.from(`${process.env.QB_CLIENT_ID}:${process.env.QB_CLIENT_SECRET}`).toString("base64");

  const res = await axios.post(QB_TOKEN_URL,
    new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: process.env.QB_REDIRECT_URI }),
    { headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" } }
  );

  const { access_token, refresh_token, expires_in } = res.data;
  const expiresAt = new Date(Date.now() + expires_in * 1000).toISOString();

  // Save tokens to Supabase
  await supabase.from("erp_connections").upsert({
    team_id: teamId,
    erp_type: "quickbooks",
    realm_id: realmId,
    access_token,
    refresh_token,
    expires_at: expiresAt,
    status: "connected",
    updated_at: new Date().toISOString(),
  }, { onConflict: "team_id,erp_type" });

  return { access_token, refresh_token, realmId };
}

// Step 3: Refresh access token when expired
async function refreshToken(teamId) {
  const { data: conn } = await supabase
    .from("erp_connections")
    .select("*")
    .eq("team_id", teamId)
    .eq("erp_type", "quickbooks")
    .single();

  if (!conn) throw new Error("QuickBooks not connected for this team");

  // Check if token is still valid
  if (new Date(conn.expires_at) > new Date(Date.now() + 60000)) {
    return conn.access_token;
  }

  // Refresh the token
  const credentials = Buffer.from(`${process.env.QB_CLIENT_ID}:${process.env.QB_CLIENT_SECRET}`).toString("base64");
  const res = await axios.post(QB_TOKEN_URL,
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token }),
    { headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" } }
  );

  const { access_token, refresh_token, expires_in } = res.data;
  const expiresAt = new Date(Date.now() + expires_in * 1000).toISOString();

  await supabase.from("erp_connections").update({
    access_token, refresh_token, expires_at: expiresAt, updated_at: new Date().toISOString()
  }).eq("team_id", teamId).eq("erp_type", "quickbooks");

  return access_token;
}

// ── PUSH INVOICE AS BILL ────────────────────────────────────────
async function pushInvoice(teamId, invoiceData) {
  const { data: conn } = await supabase
    .from("erp_connections")
    .select("*")
    .eq("team_id", teamId)
    .eq("erp_type", "quickbooks")
    .single();

  if (!conn) throw new Error("QuickBooks not connected. Please connect QuickBooks first.");

  const accessToken = await refreshToken(teamId);
  const realmId = conn.realm_id;

  // Find or create vendor
  const vendorId = await findOrCreateVendor(accessToken, realmId, invoiceData.vendor);

  // Build Bill object for QuickBooks
  const bill = {
    VendorRef: { value: vendorId },
    TxnDate: invoiceData.invoiceDate || new Date().toISOString().split("T")[0],
    DueDate: invoiceData.dueDate,
    DocNumber: invoiceData.invoiceNumber,
    PrivateNote: `Processed by InvoiceIQ. PO: ${invoiceData.poNumber || "N/A"}`,
    Line: (invoiceData.lineItems || []).map((item, i) => ({
      DetailType: "AccountBasedExpenseLineDetail",
      Amount: item.amount || 0,
      Description: item.description,
      AccountBasedExpenseLineDetail: {
        AccountRef: { value: "1", name: "Accounts Payable" },
        BillableStatus: "NotBillable",
      }
    })),
    TotalAmt: invoiceData.total || 0,
  };

  // Add tax line if present
  if (invoiceData.tax && invoiceData.tax > 0) {
    bill.Line.push({
      DetailType: "AccountBasedExpenseLineDetail",
      Amount: invoiceData.tax,
      Description: "Tax",
      AccountBasedExpenseLineDetail: {
        AccountRef: { value: "2", name: "Tax" },
        BillableStatus: "NotBillable",
      }
    });
  }

  const res = await axios.post(
    `${QB_BASE_URL}/v3/company/${realmId}/bill`,
    bill,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      params: { minorversion: 65 }
    }
  );

  const qbBill = res.data.Bill;
  return {
    success: true,
    erpReference: `QB-${qbBill.Id}`,
    erpType: "quickbooks",
    details: {
      billId: qbBill.Id,
      syncToken: qbBill.SyncToken,
      totalAmt: qbBill.TotalAmt,
      status: qbBill.PaymentType,
    }
  };
}

// ── FIND OR CREATE VENDOR ───────────────────────────────────────
async function findOrCreateVendor(accessToken, realmId, vendor) {
  if (!vendor?.name) return "1"; // default vendor

  // Search for existing vendor
  try {
    const searchRes = await axios.get(
      `${QB_BASE_URL}/v3/company/${realmId}/query`,
      {
        params: { query: `SELECT * FROM Vendor WHERE DisplayName = '${vendor.name.replace(/'/g, "\\'")}'`, minorversion: 65 },
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }
      }
    );

    const vendors = searchRes.data.QueryResponse?.Vendor;
    if (vendors && vendors.length > 0) return vendors[0].Id;
  } catch (e) { console.log("Vendor search failed, creating new:", e.message); }

  // Create new vendor
  try {
    const createRes = await axios.post(
      `${QB_BASE_URL}/v3/company/${realmId}/vendor`,
      {
        DisplayName: vendor.name,
        PrimaryEmailAddr: vendor.email ? { Address: vendor.email } : undefined,
        PrimaryPhone: vendor.phone ? { FreeFormNumber: vendor.phone } : undefined,
      },
      {
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json" },
        params: { minorversion: 65 }
      }
    );
    return createRes.data.Vendor.Id;
  } catch (e) {
    console.error("Vendor creation failed:", e.message);
    return "1"; // fallback to default
  }
}

// ── GET CONNECTION STATUS ───────────────────────────────────────
async function getConnectionStatus(teamId) {
  const { data } = await supabase
    .from("erp_connections")
    .select("status, realm_id, expires_at, updated_at")
    .eq("team_id", teamId)
    .eq("erp_type", "quickbooks")
    .single();

  return data || { status: "disconnected" };
}

// ── DISCONNECT ──────────────────────────────────────────────────
async function disconnect(teamId) {
  await supabase.from("erp_connections").update({ status: "disconnected" }).eq("team_id", teamId).eq("erp_type", "quickbooks");
  return { success: true };
}

module.exports = { getAuthUrl, exchangeCode, pushInvoice, getConnectionStatus, disconnect };
