// xero.js — Xero Accounting Integration
// APFlow → Xero Bills (Accounts Payable)

const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";
const XERO_API_URL = "https://api.xero.com/api.xro/2.0";

// ── LINE TYPE MAPPER ─────────────────────────────────────────────
function getXeroLineType(item) {
  const lt = (item.lineType || "").toUpperCase();
  const desc = (item.description || "").toLowerCase();
  const freightKw = ["freight", "shipping", "delivery", "courier", "carriage", "postage"];
  const taxKw = ["tax", "gst", "vat", "sales tax"];
  if (lt === "FREIGHT" || freightKw.some(k => desc.includes(k))) return "freight";
  if (lt === "TAX" || taxKw.some(k => desc.includes(k))) return "tax";
  if (lt === "DISCOUNT") return "discount";
  return "item";
}

// ── GET ACCESS TOKEN ─────────────────────────────────────────────
async function getXeroToken(teamId) {
  const { data: conn } = await supabase
    .from("erp_connections")
    .select("*")
    .eq("team_id", teamId)
    .eq("erp_type", "xero")
    .single();

  if (!conn) throw new Error("Xero not connected for this team");

  const creds = conn.credentials || {};

  // Refresh token if expired
  if (!creds.accessToken || Date.now() > (creds.expiresAt || 0)) {
    if (!creds.refreshToken) throw new Error("Xero refresh token missing — please reconnect");
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: creds.refreshToken,
    });
    const basicAuth = Buffer.from(`${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`).toString("base64");
    const res = await axios.post(XERO_TOKEN_URL, params.toString(), {
      headers: { Authorization: `Basic ${basicAuth}`, "Content-Type": "application/x-www-form-urlencoded" }
    });
    creds.accessToken = res.data.access_token;
    creds.refreshToken = res.data.refresh_token;
    creds.expiresAt = Date.now() + (res.data.expires_in * 1000);
    await supabase.from("erp_connections").update({ credentials: creds }).eq("team_id", teamId).eq("erp_type", "xero");
  }

  return { accessToken: creds.accessToken, tenantId: creds.tenantId };
}

// ── PRE-PUSH VALIDATION ──────────────────────────────────────────
async function validateInvoice(invoiceData) {
  const errors = [];
  const warnings = [];

  if (!invoiceData.invoiceNumber) errors.push("Invoice number is required");
  if (!invoiceData.total || invoiceData.total <= 0) errors.push("Invoice total must be greater than zero");
  if (!invoiceData.invoiceDate) errors.push("Invoice date is required");
  if (!invoiceData.vendor?.name) errors.push("Vendor/Contact name is required");

  if (invoiceData.invoiceDate && new Date(invoiceData.invoiceDate) > new Date()) {
    errors.push("Invoice date is in the future — Xero will reject this");
  }

  if (invoiceData.dueDate && invoiceData.invoiceDate) {
    if (new Date(invoiceData.dueDate) < new Date(invoiceData.invoiceDate)) {
      errors.push("Due date is before invoice date");
    }
  }

  if (invoiceData.lineItems?.length > 0) {
    const lineTotal = invoiceData.lineItems.reduce((s, l) => s + (l.amount || 0), 0);
    const tax = invoiceData.tax || 0;
    if (Math.abs(lineTotal + tax - invoiceData.total) > 0.02) {
      errors.push(`Amount mismatch: line items (${lineTotal.toFixed(2)}) + tax (${tax.toFixed(2)}) ≠ total (${invoiceData.total})`);
    }
  }

  if (!invoiceData.poNumber) warnings.push("No PO number — invoice will be unmatched");

  return { valid: errors.length === 0, errors, warnings };
}

// ── PUSH INVOICE TO XERO ─────────────────────────────────────────
async function pushInvoice(teamId, invoiceData) {
  const { accessToken, tenantId } = await getXeroToken(teamId);

  const validation = await validateInvoice(invoiceData);
  if (!validation.valid) {
    throw new Error(`Invoice failed Xero pre-validation:\n${validation.errors.map(e => `• ${e}`).join("\n")}`);
  }

  const xeroBill = {
    Type: "ACCPAY",
    InvoiceNumber: invoiceData.invoiceNumber,
    Reference: invoiceData.poNumber || "",
    Date: invoiceData.invoiceDate,
    DueDate: invoiceData.dueDate || invoiceData.invoiceDate,
    CurrencyCode: invoiceData.currency || "USD",
    Status: "DRAFT",
    Contact: { Name: invoiceData.vendor?.name },
    LineItems: (invoiceData.lineItems || []).map(item => ({
      Description: item.description || "",
      Quantity: item.quantity || 1,
      UnitAmount: item.unitPrice || item.amount || 0,
      LineAmount: item.amount || 0,
      AccountCode: getXeroLineType(item) === "freight" ? "404" : "300", // 404=Freight, 300=Purchases
      TaxType: getXeroLineType(item) === "tax" ? "INPUT" : "NONE",
    })),
  };

  if (invoiceData.tax && invoiceData.tax > 0) {
    const hasTax = (invoiceData.lineItems || []).some(l => getXeroLineType(l) === "tax");
    if (!hasTax) {
      xeroBill.LineItems.push({
        Description: "Tax",
        LineAmount: invoiceData.tax,
        AccountCode: "820",
        TaxType: "INPUT",
      });
    }
  }

  const res = await axios.post(`${XERO_API_URL}/Invoices`, { Invoices: [xeroBill] }, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Xero-Tenant-Id": tenantId,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });

  const xeroInvoice = res.data?.Invoices?.[0];
  if (!xeroInvoice) throw new Error("Xero did not return an invoice ID");

  return {
    success: true,
    erpReference: `XERO-${xeroInvoice.InvoiceID || Date.now()}`,
    erpType: "xero",
    validation,
    details: {
      invoiceId: xeroInvoice.InvoiceID,
      invoiceNumber: xeroInvoice.InvoiceNumber,
      status: xeroInvoice.Status,
      amount: xeroInvoice.Total,
      warnings: validation.warnings,
    }
  };
}

// ── OAUTH FLOW ───────────────────────────────────────────────────
function getAuthUrl(teamId) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.XERO_CLIENT_ID,
    redirect_uri: process.env.XERO_REDIRECT_URI,
    scope: "openid profile email accounting.transactions accounting.contacts offline_access",
    state: teamId,
  });
  return `https://login.xero.com/identity/connect/authorize?${params}`;
}

async function handleCallback(code, teamId) {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: process.env.XERO_REDIRECT_URI,
  });
  const basicAuth = Buffer.from(`${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`).toString("base64");
  const tokenRes = await axios.post(XERO_TOKEN_URL, params.toString(), {
    headers: { Authorization: `Basic ${basicAuth}`, "Content-Type": "application/x-www-form-urlencoded" }
  });

  // Get tenant/organisation
  const tenantsRes = await axios.get("https://api.xero.com/connections", {
    headers: { Authorization: `Bearer ${tokenRes.data.access_token}` }
  });
  const tenant = tenantsRes.data?.[0];

  await supabase.from("erp_connections").upsert({
    team_id: teamId,
    erp_type: "xero",
    status: "connected",
    credentials: {
      accessToken: tokenRes.data.access_token,
      refreshToken: tokenRes.data.refresh_token,
      expiresAt: Date.now() + (tokenRes.data.expires_in * 1000),
      tenantId: tenant?.tenantId,
      tenantName: tenant?.tenantName,
    },
    updated_at: new Date().toISOString(),
  }, { onConflict: "team_id,erp_type" });

  return { success: true, tenantName: tenant?.tenantName };
}

async function getConnectionStatus(teamId) {
  const { data } = await supabase.from("erp_connections").select("status, updated_at, credentials").eq("team_id", teamId).eq("erp_type", "xero").single();
  return data || { status: "disconnected" };
}

async function disconnect(teamId) {
  await supabase.from("erp_connections").update({ status: "disconnected" }).eq("team_id", teamId).eq("erp_type", "xero");
  return { success: true };
}

async function validateOnly(teamId, invoiceData) {
  return await validateInvoice(invoiceData);
}

module.exports = { pushInvoice, getAuthUrl, handleCallback, getConnectionStatus, disconnect, validateOnly };
