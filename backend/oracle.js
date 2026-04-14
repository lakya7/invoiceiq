// oracle.js — Oracle Fusion Cloud Payables Integration
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// ── AUTH ────────────────────────────────────────────────────────
async function getOracleToken(teamId) {
  const { data: conn } = await supabase
    .from("erp_connections")
    .select("*")
    .eq("team_id", teamId)
    .eq("erp_type", "oracle")
    .single();

  if (!conn) throw new Error("Oracle Fusion not connected for this team");

  // Oracle Fusion uses Basic Auth or OAuth depending on setup
  // Basic Auth: base64(username:password)
  const credentials = Buffer.from(`${conn.username}:${conn.password}`).toString("base64");
  return { credentials, baseUrl: conn.base_url };
}

// ── PUSH INVOICE TO ORACLE PAYABLES ────────────────────────────
async function pushInvoice(teamId, invoiceData) {
  const { credentials, baseUrl } = await getOracleToken(teamId);

  // Oracle Fusion Payables REST API endpoint
  const endpoint = `${baseUrl}/fscmRestApi/resources/11.13.18.05/invoices`;

  // Map invoice data to Oracle Fusion format
  const oracleInvoice = {
    InvoiceNumber: invoiceData.invoiceNumber || `INV-${Date.now()}`,
    InvoiceCurrency: invoiceData.currency || "USD",
    InvoiceAmount: invoiceData.total || 0,
    InvoiceDate: invoiceData.invoiceDate || new Date().toISOString().split("T")[0],
    DueDate: invoiceData.dueDate,
    PaymentTerms: invoiceData.paymentTerms || "NET30",
    Description: `Processed by InvoiceIQ. Vendor: ${invoiceData.vendor?.name || "Unknown"}`,
    PurchaseOrder: invoiceData.poNumber,
    SupplierName: invoiceData.vendor?.name,
    SupplierSite: invoiceData.vendor?.address,
    InvoiceType: "STANDARD",
    Source: "InvoiceIQ",
    invoiceLines: (invoiceData.lineItems || []).map((item, i) => ({
      LineNumber: i + 1,
      LineType: "ITEM",
      LineAmount: item.amount || 0,
      Description: item.description,
      Quantity: item.quantity || 1,
      UnitPrice: item.unitPrice || 0,
    })),
  };

  // Add tax line if present
  if (invoiceData.tax && invoiceData.tax > 0) {
    oracleInvoice.invoiceLines.push({
      LineNumber: (invoiceData.lineItems?.length || 0) + 1,
      LineType: "TAX",
      LineAmount: invoiceData.tax,
      Description: "Tax",
    });
  }

  try {
    const res = await axios.post(endpoint, oracleInvoice, {
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    const oracle = res.data;
    return {
      success: true,
      erpReference: `ORA-${oracle.InvoiceId || Date.now()}`,
      erpType: "oracle",
      details: {
        invoiceId: oracle.InvoiceId,
        invoiceNumber: oracle.InvoiceNumber,
        status: oracle.InvoiceStatus,
        amount: oracle.InvoiceAmount,
      }
    };
  } catch (err) {
    const msg = err.response?.data?.detail || err.response?.data?.title || err.message;
    throw new Error(`Oracle Fusion error: ${msg}`);
  }
}

// ── SAVE ORACLE CONNECTION ──────────────────────────────────────
async function saveConnection(teamId, { baseUrl, username, password }) {
  await supabase.from("erp_connections").upsert({
    team_id: teamId,
    erp_type: "oracle",
    base_url: baseUrl,
    username,
    password, // In production: encrypt this!
    status: "connected",
    updated_at: new Date().toISOString(),
  }, { onConflict: "team_id,erp_type" });

  // Test connection
  try {
    const credentials = Buffer.from(`${username}:${password}`).toString("base64");
    await axios.get(`${baseUrl}/fscmRestApi/resources/11.13.18.05/invoices?limit=1`, {
      headers: { Authorization: `Basic ${credentials}`, Accept: "application/json" }
    });
    return { success: true, message: "Oracle Fusion connected successfully!" };
  } catch (err) {
    await supabase.from("erp_connections").update({ status: "error" }).eq("team_id", teamId).eq("erp_type", "oracle");
    throw new Error("Could not connect to Oracle Fusion. Check your credentials and URL.");
  }
}

// ── GET CONNECTION STATUS ───────────────────────────────────────
async function getConnectionStatus(teamId) {
  const { data } = await supabase
    .from("erp_connections")
    .select("status, base_url, updated_at")
    .eq("team_id", teamId)
    .eq("erp_type", "oracle")
    .single();

  return data || { status: "disconnected" };
}

// ── DISCONNECT ──────────────────────────────────────────────────
async function disconnect(teamId) {
  await supabase.from("erp_connections").update({ status: "disconnected" }).eq("team_id", teamId).eq("erp_type", "oracle");
  return { success: true };
}

module.exports = { pushInvoice, saveConnection, getConnectionStatus, disconnect };
