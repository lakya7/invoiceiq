// zoho.js — Zoho Books Integration
// APFlow → Zoho Books Bills (Accounts Payable)

const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const ZOHO_TOKEN_URL = "https://accounts.zoho.com/oauth/v2/token";
const ZOHO_API_BASE = "https://www.zohoapis.com/books/v3";

// ── LINE TYPE MAPPER ─────────────────────────────────────────────
function getZohoLineType(item) {
  const lt = (item.lineType || "").toUpperCase();
  const desc = (item.description || "").toLowerCase();
  const freightKw = ["freight", "shipping", "delivery", "courier", "carriage", "postage"];
  if (lt === "FREIGHT" || freightKw.some(k => desc.includes(k))) return "freight";
  if (lt === "DISCOUNT") return "discount";
  return "item";
}

// ── GET ACCESS TOKEN ─────────────────────────────────────────────
async function getZohoToken(teamId) {
  const { data: conn } = await supabase
    .from("erp_connections")
    .select("*")
    .eq("team_id", teamId)
    .eq("erp_type", "zoho")
    .single();

  if (!conn) throw new Error("Zoho Books not connected for this team");

  const creds = conn.credentials || {};

  // Refresh if expired
  if (!creds.accessToken || Date.now() > (creds.expiresAt || 0)) {
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: process.env.ZOHO_CLIENT_ID,
      client_secret: process.env.ZOHO_CLIENT_SECRET,
      refresh_token: creds.refreshToken,
    });
    const res = await axios.post(ZOHO_TOKEN_URL, params.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" }
    });
    creds.accessToken = res.data.access_token;
    creds.expiresAt = Date.now() + (res.data.expires_in * 1000);
    await supabase.from("erp_connections").update({ credentials: creds }).eq("team_id", teamId).eq("erp_type", "zoho");
  }

  return { accessToken: creds.accessToken, orgId: creds.orgId };
}

// ── VALIDATE ─────────────────────────────────────────────────────
async function validateInvoice(invoiceData) {
  const errors = [];
  const warnings = [];

  if (!invoiceData.invoiceNumber) errors.push("Bill number is required");
  if (!invoiceData.total || invoiceData.total <= 0) errors.push("Total must be greater than zero");
  if (!invoiceData.invoiceDate) errors.push("Bill date is required");
  if (!invoiceData.vendor?.name) errors.push("Vendor name is required");

  if (invoiceData.invoiceDate && new Date(invoiceData.invoiceDate) > new Date()) {
    errors.push("Bill date is in the future");
  }

  if (invoiceData.lineItems?.length > 0) {
    const lineTotal = invoiceData.lineItems.reduce((s, l) => s + (l.amount || 0), 0);
    const tax = invoiceData.tax || 0;
    if (Math.abs(lineTotal + tax - invoiceData.total) > 0.02) {
      errors.push(`Amount mismatch: lines (${lineTotal.toFixed(2)}) + tax (${tax.toFixed(2)}) ≠ total (${invoiceData.total})`);
    }
  }

  if (!invoiceData.poNumber) warnings.push("No PO number — bill will be unmatched");

  return { valid: errors.length === 0, errors, warnings };
}

// ── PUSH INVOICE TO ZOHO BOOKS ───────────────────────────────────
async function pushInvoice(teamId, invoiceData) {
  const { accessToken, orgId } = await getZohoToken(teamId);

  const validation = await validateInvoice(invoiceData);
  if (!validation.valid) {
    throw new Error(`Invoice failed Zoho pre-validation:\n${validation.errors.map(e => `• ${e}`).join("\n")}`);
  }

  // Build Zoho Bill payload
  const zohoBill = {
    vendor_name: invoiceData.vendor?.name,
    bill_number: invoiceData.invoiceNumber,
    reference_number: invoiceData.poNumber || "",
    date: invoiceData.invoiceDate,
    due_date: invoiceData.dueDate || invoiceData.invoiceDate,
    currency_code: invoiceData.currency || "USD",
    notes: `Processed by APFlow`,
    line_items: (invoiceData.lineItems || []).map(item => ({
      description: item.description || "",
      quantity: item.quantity || 1,
      rate: item.unitPrice || item.amount || 0,
      item_total: item.amount || 0,
      account_name: getZohoLineType(item) === "freight" ? "Freight & Delivery" : "Purchases",
    })),
  };

  // Add tax line if needed
  if (invoiceData.tax && invoiceData.tax > 0) {
    const hasTax = (invoiceData.lineItems || []).some(l => (l.lineType || "").toUpperCase() === "TAX");
    if (!hasTax) {
      zohoBill.line_items.push({
        description: "Tax",
        quantity: 1,
        rate: invoiceData.tax,
        item_total: invoiceData.tax,
        account_name: "Tax Payable",
      });
    }
  }

  const res = await axios.post(
    `${ZOHO_API_BASE}/bills?organization_id=${orgId}`,
    zohoBill,
    {
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (res.data?.code !== 0) throw new Error(`Zoho Books error: ${res.data?.message}`);

  const bill = res.data?.bill;
  return {
    success: true,
    erpReference: `ZOHO-${bill?.bill_id || Date.now()}`,
    erpType: "zoho",
    validation,
    details: {
      billId: bill?.bill_id,
      billNumber: bill?.bill_number,
      status: bill?.status,
      amount: bill?.total,
      warnings: validation.warnings,
    }
  };
}

// ── OAUTH FLOW ───────────────────────────────────────────────────
function getAuthUrl(teamId) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.ZOHO_CLIENT_ID,
    redirect_uri: process.env.ZOHO_REDIRECT_URI,
    scope: "ZohoBooks.bills.CREATE,ZohoBooks.bills.READ,ZohoBooks.contacts.READ",
    state: teamId,
    access_type: "offline",
  });
  return `https://accounts.zoho.com/oauth/v2/auth?${params}`;
}

async function handleCallback(code, teamId) {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    redirect_uri: process.env.ZOHO_REDIRECT_URI,
    code,
  });
  const res = await axios.post(ZOHO_TOKEN_URL, params.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" }
  });

  // Get organisation ID
  const orgsRes = await axios.get(`${ZOHO_API_BASE}/organizations`, {
    headers: { Authorization: `Zoho-oauthtoken ${res.data.access_token}` }
  });
  const org = orgsRes.data?.organizations?.[0];

  await supabase.from("erp_connections").upsert({
    team_id: teamId,
    erp_type: "zoho",
    status: "connected",
    credentials: {
      accessToken: res.data.access_token,
      refreshToken: res.data.refresh_token,
      expiresAt: Date.now() + (res.data.expires_in * 1000),
      orgId: org?.organization_id,
      orgName: org?.name,
    },
    updated_at: new Date().toISOString(),
  }, { onConflict: "team_id,erp_type" });

  return { success: true, orgName: org?.name };
}

async function getConnectionStatus(teamId) {
  const { data } = await supabase.from("erp_connections").select("status, updated_at, credentials").eq("team_id", teamId).eq("erp_type", "zoho").single();
  return data || { status: "disconnected" };
}

async function disconnect(teamId) {
  await supabase.from("erp_connections").update({ status: "disconnected" }).eq("team_id", teamId).eq("erp_type", "zoho");
  return { success: true };
}

async function validateOnly(teamId, invoiceData) {
  return await validateInvoice(invoiceData);
}

module.exports = { pushInvoice, getAuthUrl, handleCallback, getConnectionStatus, disconnect, validateOnly };
