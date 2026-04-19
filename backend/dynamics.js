// dynamics.js — Microsoft Dynamics 365 Finance & Operations Integration
// APFlow → Dynamics 365 Vendor Invoices (Accounts Payable)

const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const MS_TOKEN_URL = "https://login.microsoftonline.com";

// ── LINE TYPE MAPPER ─────────────────────────────────────────────
function getDynamicsLineType(item) {
  const lt = (item.lineType || "").toUpperCase();
  const desc = (item.description || "").toLowerCase();
  const freightKw = ["freight", "shipping", "delivery", "courier", "carriage", "postage"];
  const miscKw = ["handling", "packing", "insurance", "surcharge"];
  if (lt === "FREIGHT" || freightKw.some(k => desc.includes(k))) return "FreightCharge";
  if (lt === "MISCELLANEOUS" || miscKw.some(k => desc.includes(k))) return "MiscCharge";
  if (lt === "DISCOUNT") return "Discount";
  return "Item";
}

// ── GET ACCESS TOKEN (OAuth 2.0 Client Credentials) ──────────────
async function getDynamicsToken(teamId) {
  const { data: conn } = await supabase
    .from("erp_connections")
    .select("*")
    .eq("team_id", teamId)
    .eq("erp_type", "dynamics")
    .single();

  if (!conn) throw new Error("Microsoft Dynamics 365 not connected for this team");

  const creds = conn.credentials || {};

  // Refresh token if expired
  if (!creds.accessToken || Date.now() > (creds.expiresAt || 0)) {
    const params = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      resource: creds.resourceUrl,
    });
    const res = await axios.post(
      `${MS_TOKEN_URL}/${creds.tenantId}/oauth2/token`,
      params.toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    creds.accessToken = res.data.access_token;
    creds.expiresAt = Date.now() + (res.data.expires_in * 1000);
    await supabase.from("erp_connections").update({ credentials: creds }).eq("team_id", teamId).eq("erp_type", "dynamics");
  }

  return {
    accessToken: creds.accessToken,
    resourceUrl: creds.resourceUrl,
    legalEntity: creds.legalEntity || "USMF",
  };
}

// ── PRE-PUSH VALIDATION ──────────────────────────────────────────
async function validateInvoice(invoiceData) {
  const errors = [];
  const warnings = [];

  if (!invoiceData.invoiceNumber) errors.push("Invoice number is required");
  if (!invoiceData.total || invoiceData.total <= 0) errors.push("Invoice total must be greater than zero");
  if (!invoiceData.invoiceDate) errors.push("Invoice date is required");
  if (!invoiceData.vendor?.name) errors.push("Vendor account is required");

  if (invoiceData.invoiceDate && new Date(invoiceData.invoiceDate) > new Date()) {
    errors.push("Invoice date is in the future — Dynamics will reject this");
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
      errors.push(`Amount mismatch: lines (${lineTotal.toFixed(2)}) + tax (${tax.toFixed(2)}) ≠ total (${invoiceData.total})`);
    }
  }

  if (!invoiceData.poNumber) warnings.push("No PO number — invoice will be unmatched in Dynamics");
  if (invoiceData.invoiceNumber?.length > 20) errors.push("Invoice number exceeds 20 characters — Dynamics limit");

  return { valid: errors.length === 0, errors, warnings };
}

// ── PUSH INVOICE TO DYNAMICS 365 ─────────────────────────────────
async function pushInvoice(teamId, invoiceData) {
  const { accessToken, resourceUrl, legalEntity } = await getDynamicsToken(teamId);

  const validation = await validateInvoice(invoiceData);
  if (!validation.valid) {
    throw new Error(`Invoice failed Dynamics pre-validation:\n${validation.errors.map(e => `• ${e}`).join("\n")}`);
  }

  const baseUrl = `${resourceUrl}/data`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "OData-MaxVersion": "4.0",
    "OData-Version": "4.0",
  };

  // Create Vendor Invoice Header
  const invoiceHeader = {
    InvoiceNumber: invoiceData.invoiceNumber,
    InvoiceDate: invoiceData.invoiceDate,
    DueDate: invoiceData.dueDate || invoiceData.invoiceDate,
    VendorAccountNumber: invoiceData.vendor?.name,
    DocumentDate: invoiceData.invoiceDate,
    CurrencyCode: invoiceData.currency || "USD",
    DefaultDimensionDisplayValue: "",
    PaymentTermsName: invoiceData.paymentTerms || "Net30",
    DataAreaId: legalEntity,
    Description: `APFlow: ${invoiceData.vendor?.name} - ${invoiceData.invoiceNumber}`,
    PurchaseOrderNumber: invoiceData.poNumber || "",
  };

  const res = await axios.post(
    `${baseUrl}/VendorInvoiceHeaders`,
    invoiceHeader,
    { headers }
  );

  const headerId = res.data?.InvoiceNumber || invoiceData.invoiceNumber;

  // Create invoice lines
  for (let i = 0; i < (invoiceData.lineItems || []).length; i++) {
    const item = invoiceData.lineItems[i];
    const lineType = getDynamicsLineType(item);

    await axios.post(`${baseUrl}/VendorInvoiceLines`, {
      InvoiceNumber: headerId,
      DataAreaId: legalEntity,
      LineNumber: i + 1,
      ItemNumber: lineType === "Item" ? (item.itemCode || "MISC") : undefined,
      LineDescription: item.description || "",
      InvoiceQuantity: item.quantity || 1,
      UnitPrice: item.unitPrice || 0,
      LineAmount: item.amount || 0,
      ChargeCategory: lineType !== "Item" ? lineType : undefined,
    }, { headers });

    console.log(`Dynamics line ${i+1}: "${item.description}" → ${lineType} ($${item.amount})`);
  }

  // Add tax line if needed
  if (invoiceData.tax && invoiceData.tax > 0) {
    const hasTax = (invoiceData.lineItems || []).some(l => (l.lineType || "").toUpperCase() === "TAX");
    if (!hasTax) {
      await axios.post(`${baseUrl}/VendorInvoiceLines`, {
        InvoiceNumber: headerId,
        DataAreaId: legalEntity,
        LineNumber: (invoiceData.lineItems?.length || 0) + 1,
        LineDescription: "Tax",
        LineAmount: invoiceData.tax,
        ChargeCategory: "TaxCharge",
      }, { headers });
    }
  }

  return {
    success: true,
    erpReference: `DYN-${headerId}`,
    erpType: "dynamics",
    validation,
    details: {
      invoiceNumber: headerId,
      status: "Posted",
      legalEntity,
      amount: invoiceData.total,
      warnings: validation.warnings,
    }
  };
}

// ── SAVE CONNECTION (Client Credentials flow) ────────────────────
async function saveConnection(teamId, { tenantId, clientId, clientSecret, resourceUrl, legalEntity }) {
  // Test connection by getting token
  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    resource: resourceUrl,
  });

  try {
    const res = await axios.post(
      `${MS_TOKEN_URL}/${tenantId}/oauth2/token`,
      params.toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 10000 }
    );

    await supabase.from("erp_connections").upsert({
      team_id: teamId,
      erp_type: "dynamics",
      status: "connected",
      credentials: {
        tenantId, clientId, clientSecret, resourceUrl,
        legalEntity: legalEntity || "USMF",
        accessToken: res.data.access_token,
        expiresAt: Date.now() + (res.data.expires_in * 1000),
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: "team_id,erp_type" });

    return { success: true, message: "Microsoft Dynamics 365 connected successfully!" };
  } catch (err) {
    await supabase.from("erp_connections").update({ status: "error" }).eq("team_id", teamId).eq("erp_type", "dynamics");
    throw new Error("Could not connect to Dynamics 365. Check your Tenant ID, Client ID, and Client Secret.");
  }
}

async function getConnectionStatus(teamId) {
  const { data } = await supabase.from("erp_connections").select("status, updated_at, credentials").eq("team_id", teamId).eq("erp_type", "dynamics").single();
  return data || { status: "disconnected" };
}

async function disconnect(teamId) {
  await supabase.from("erp_connections").update({ status: "disconnected" }).eq("team_id", teamId).eq("erp_type", "dynamics");
  return { success: true };
}

async function validateOnly(teamId, invoiceData) {
  return await validateInvoice(invoiceData);
}

module.exports = { pushInvoice, saveConnection, getConnectionStatus, disconnect, validateOnly };
