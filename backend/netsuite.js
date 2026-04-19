// netsuite.js — NetSuite SuiteAnalytics / REST API Integration
// APFlow → NetSuite Accounts Payable (Vendor Bills)

const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// ── AUTH — NetSuite Token-Based Auth (TBA) ───────────────────────
// NetSuite uses OAuth 1.0a Token-Based Authentication
// Credentials stored: accountId, consumerKey, consumerSecret, tokenId, tokenSecret
async function getNetSuiteConfig(teamId) {
  const { data: conn } = await supabase
    .from("erp_connections")
    .select("*")
    .eq("team_id", teamId)
    .eq("erp_type", "netsuite")
    .single();

  if (!conn) throw new Error("NetSuite not connected for this team");
  if (conn.status !== "connected") throw new Error("NetSuite connection is not active");

  const creds = conn.credentials || {};
  return {
    accountId: creds.accountId || conn.account_id,
    consumerKey: creds.consumerKey,
    consumerSecret: creds.consumerSecret,
    tokenId: creds.tokenId,
    tokenSecret: creds.tokenSecret,
    baseUrl: `https://${(creds.accountId || conn.account_id)?.toLowerCase().replace(/_/g, "-")}.suitetalk.api.netsuite.com`,
    restUrl: `https://${(creds.accountId || conn.account_id)?.toLowerCase().replace(/_/g, "-")}.suitetalk.api.netsuite.com/services/rest/record/v1`,
  };
}

// ── OAUTH 1.0a HEADER GENERATOR ──────────────────────────────────
function generateOAuthHeader({ method, url, accountId, consumerKey, consumerSecret, tokenId, tokenSecret }) {
  const crypto = require("crypto");
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString("hex");
  const realm = accountId;

  const oauthParams = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA256",
    oauth_timestamp: timestamp,
    oauth_token: tokenId,
    oauth_version: "1.0",
  };

  // Build signature base string
  const sortedParams = Object.keys(oauthParams).sort().map(k =>
    `${encodeURIComponent(k)}=${encodeURIComponent(oauthParams[k])}`
  ).join("&");

  const baseString = [
    method.toUpperCase(),
    encodeURIComponent(url),
    encodeURIComponent(sortedParams),
  ].join("&");

  const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`;
  const signature = crypto.createHmac("sha256", signingKey).update(baseString).digest("base64");

  const headerParams = {
    ...oauthParams,
    oauth_signature: signature,
    realm,
  };

  const headerStr = Object.keys(headerParams).map(k =>
    `${k}="${encodeURIComponent(headerParams[k])}"`
  ).join(", ");

  return `OAuth ${headerStr}`;
}

// ── LINE TYPE MAPPER ─────────────────────────────────────────────
// Maps APFlow lineType to NetSuite item types
function getNetSuiteLineType(item) {
  const lt = (item.lineType || "").toUpperCase();
  const desc = (item.description || "").toLowerCase();

  const freightKw = ["freight", "shipping", "delivery", "courier", "carriage", "postage"];
  const miscKw = ["handling", "packing", "insurance", "surcharge", "fuel surcharge"];
  const taxKw = ["tax", "gst", "vat", "sales tax", "hst"];

  if (lt === "FREIGHT" || freightKw.some(k => desc.includes(k))) return "freight";
  if (lt === "TAX" || taxKw.some(k => desc.includes(k))) return "tax";
  if (lt === "MISCELLANEOUS" || miscKw.some(k => desc.includes(k))) return "other";
  if (lt === "DISCOUNT") return "discount";
  return "item";
}

// ── PRE-PUSH VALIDATION ──────────────────────────────────────────
async function validateInvoice({ invoiceData, config }) {
  const errors = [];
  const warnings = [];

  // 1. Required fields
  if (!invoiceData.invoiceNumber) errors.push("Invoice number is required");
  if (!invoiceData.total || invoiceData.total <= 0) errors.push("Invoice total must be greater than zero");
  if (!invoiceData.invoiceDate) errors.push("Invoice date is required");
  if (!invoiceData.vendor?.name) errors.push("Vendor name is required");

  // 2. Date validation
  if (invoiceData.invoiceDate) {
    const invDate = new Date(invoiceData.invoiceDate);
    if (invDate > new Date()) {
      errors.push(`Invoice date ${invoiceData.invoiceDate} is in the future — NetSuite will reject this`);
    }
  }

  // 3. Due date
  if (invoiceData.dueDate && invoiceData.invoiceDate) {
    if (new Date(invoiceData.dueDate) < new Date(invoiceData.invoiceDate)) {
      errors.push(`Due date is before invoice date`);
    }
  }

  // 4. Amount balance
  if (invoiceData.lineItems?.length > 0) {
    const lineTotal = invoiceData.lineItems.reduce((s, l) => s + (l.amount || 0), 0);
    const tax = invoiceData.tax || 0;
    const expected = lineTotal + tax;
    if (Math.abs(expected - invoiceData.total) > 0.02) {
      errors.push(`Amount mismatch: line items (${lineTotal.toFixed(2)}) + tax (${tax.toFixed(2)}) = ${expected.toFixed(2)}, but total is ${invoiceData.total}`);
    }
  }

  // 5. Invoice number format (NetSuite limit: 50 chars)
  if (invoiceData.invoiceNumber?.length > 50) {
    errors.push("Invoice number exceeds 50 characters — NetSuite limit");
  }

  // 6. Duplicate check in NetSuite
  if (config) {
    try {
      const url = `${config.restUrl}/vendorBill?q=tranId IS "${invoiceData.invoiceNumber}"`;
      const authHeader = generateOAuthHeader({
        method: "GET", url,
        accountId: config.accountId,
        consumerKey: config.consumerKey,
        consumerSecret: config.consumerSecret,
        tokenId: config.tokenId,
        tokenSecret: config.tokenSecret,
      });
      const res = await axios.get(url, {
        headers: { Authorization: authHeader, "Content-Type": "application/json", Prefer: "transient" },
        timeout: 8000,
      });
      if (res.data?.totalResults > 0) {
        errors.push(`Invoice #${invoiceData.invoiceNumber} already exists in NetSuite — duplicate will be rejected`);
      }
    } catch (e) {
      warnings.push("Could not verify duplicate status in NetSuite — proceeding with caution");
    }
  }

  // 7. Vendor check in NetSuite
  if (config && invoiceData.vendor?.name) {
    try {
      const vendorName = encodeURIComponent(invoiceData.vendor.name);
      const url = `${config.restUrl}/vendor?q=companyName CONTAIN "${invoiceData.vendor.name}"&limit=5`;
      const authHeader = generateOAuthHeader({
        method: "GET", url,
        accountId: config.accountId,
        consumerKey: config.consumerKey,
        consumerSecret: config.consumerSecret,
        tokenId: config.tokenId,
        tokenSecret: config.tokenSecret,
      });
      const res = await axios.get(url, {
        headers: { Authorization: authHeader, "Content-Type": "application/json" },
        timeout: 8000,
      });
      if (!res.data?.items?.length) {
        warnings.push(`Vendor "${invoiceData.vendor.name}" not found in NetSuite — invoice may need manual vendor assignment`);
      }
    } catch (e) {
      // Vendor check failed — not critical
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ── PUSH INVOICE TO NETSUITE ─────────────────────────────────────
async function pushInvoice(teamId, invoiceData) {
  const config = await getNetSuiteConfig(teamId);

  // Pre-push validation
  console.log(`NetSuite validation: running checks for invoice #${invoiceData.invoiceNumber}`);
  const validation = await validateInvoice({ invoiceData, config });

  if (validation.warnings.length > 0) console.warn("NetSuite warnings:", validation.warnings);

  if (!validation.valid) {
    console.error("NetSuite validation failed:", validation.errors);
    await supabase.from("invoices").update({
      status: "validation_failed",
      agent_decision: "netsuite_validation_failed",
      agent_reason: `NetSuite pre-validation failed: ${validation.errors.join("; ")}`,
    }).eq("invoice_number", invoiceData.invoiceNumber).eq("team_id", teamId);

    throw new Error(`Invoice failed NetSuite pre-validation:\n${validation.errors.map(e => `• ${e}`).join("\n")}`);
  }

  // Build NetSuite Vendor Bill payload
  const nsInvoice = {
    tranId: invoiceData.invoiceNumber,
    tranDate: invoiceData.invoiceDate,
    dueDate: invoiceData.dueDate || null,
    memo: `Processed by APFlow. Vendor: ${invoiceData.vendor?.name || "Unknown"}`,
    currency: { refName: invoiceData.currency || "USD" },
    terms: invoiceData.paymentTerms ? { refName: invoiceData.paymentTerms } : undefined,
    entity: { refName: invoiceData.vendor?.name },
    externalId: `APFLOW-${invoiceData.invoiceNumber}`,
    // Expense lines for FREIGHT, MISC, TAX
    expenseList: {
      items: (invoiceData.lineItems || [])
        .filter(item => ["FREIGHT", "MISCELLANEOUS", "TAX", "DISCOUNT"].includes((item.lineType || "").toUpperCase()) ||
          ["freight", "tax", "other"].includes(getNetSuiteLineType(item)))
        .map((item, i) => ({
          lineNumber: i + 1,
          amount: item.amount || 0,
          memo: item.description || "",
          category: { refName: getNetSuiteLineType(item) === "freight" ? "Freight" : "General" },
        }))
    },
    // Item lines for ITEM type
    itemList: {
      items: (invoiceData.lineItems || [])
        .filter(item => getNetSuiteLineType(item) === "item")
        .map((item, i) => ({
          lineNumber: i + 1,
          quantity: item.quantity || 1,
          rate: item.unitPrice || item.amount || 0,
          amount: item.amount || 0,
          description: item.description || "",
        }))
    },
  };

  // Log freight lines
  const freightLines = (invoiceData.lineItems || []).filter(l => getNetSuiteLineType(l) === "freight");
  if (freightLines.length > 0) {
    console.log(`NetSuite push: ${freightLines.length} freight line(s) — total: ${freightLines.reduce((s, l) => s + (l.amount || 0), 0)}`);
  }

  const url = `${config.restUrl}/vendorBill`;
  const authHeader = generateOAuthHeader({
    method: "POST", url,
    accountId: config.accountId,
    consumerKey: config.consumerKey,
    consumerSecret: config.consumerSecret,
    tokenId: config.tokenId,
    tokenSecret: config.tokenSecret,
  });

  try {
    const res = await axios.post(url, nsInvoice, {
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    const nsId = res.headers?.location?.split("/").pop() || res.data?.id || Date.now();

    if (validation.warnings.length > 0) {
      await supabase.from("invoices").update({
        agent_reason: `Pushed to NetSuite with ${validation.warnings.length} warning(s): ${validation.warnings.join("; ")}`,
      }).eq("invoice_number", invoiceData.invoiceNumber).eq("team_id", teamId);
    }

    return {
      success: true,
      erpReference: `NS-${nsId}`,
      erpType: "netsuite",
      validation,
      details: {
        netSuiteId: nsId,
        invoiceNumber: invoiceData.invoiceNumber,
        status: "Pending Approval",
        amount: invoiceData.total,
        warnings: validation.warnings,
      }
    };
  } catch (err) {
    const msg = err.response?.data?.message || err.response?.data?.title || err.message;
    throw new Error(`NetSuite error: ${msg}`);
  }
}

// ── VALIDATE ONLY ────────────────────────────────────────────────
async function validateOnly(teamId, invoiceData) {
  try {
    const config = await getNetSuiteConfig(teamId);
    return await validateInvoice({ invoiceData, config });
  } catch (err) {
    return await validateInvoice({ invoiceData, config: null });
  }
}

// ── SAVE CONNECTION ──────────────────────────────────────────────
async function saveConnection(teamId, { accountId, consumerKey, consumerSecret, tokenId, tokenSecret }) {
  const baseUrl = `https://${accountId.toLowerCase().replace(/_/g, "-")}.suitetalk.api.netsuite.com`;

  await supabase.from("erp_connections").upsert({
    team_id: teamId,
    erp_type: "netsuite",
    status: "connected",
    credentials: { accountId, consumerKey, consumerSecret, tokenId, tokenSecret },
    updated_at: new Date().toISOString(),
  }, { onConflict: "team_id,erp_type" });

  // Test connection
  try {
    const url = `${baseUrl}/services/rest/record/v1/vendorBill?limit=1`;
    const authHeader = generateOAuthHeader({
      method: "GET", url, accountId, consumerKey, consumerSecret, tokenId, tokenSecret
    });
    await axios.get(url, {
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      timeout: 8000,
    });
    return { success: true, message: "NetSuite connected successfully!" };
  } catch (err) {
    await supabase.from("erp_connections").update({ status: "error" }).eq("team_id", teamId).eq("erp_type", "netsuite");
    throw new Error("Could not connect to NetSuite. Check your Account ID and token credentials.");
  }
}

// ── GET PAYMENT STATUS ───────────────────────────────────────────
async function getPaymentStatus(teamId, invoiceNumber) {
  try {
    const config = await getNetSuiteConfig(teamId);
    const url = `${config.restUrl}/vendorBill?q=tranId IS "${invoiceNumber}"&fields=tranId,status,amountPaid,amountRemaining`;
    const authHeader = generateOAuthHeader({
      method: "GET", url,
      accountId: config.accountId,
      consumerKey: config.consumerKey,
      consumerSecret: config.consumerSecret,
      tokenId: config.tokenId,
      tokenSecret: config.tokenSecret,
    });
    const res = await axios.get(url, {
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      timeout: 8000,
    });
    const bill = res.data?.items?.[0];
    if (!bill) return { status: "not_found" };
    const paid = bill.amountRemaining === 0;
    return { status: paid ? "paid" : "pending", amountPaid: bill.amountPaid, amountRemaining: bill.amountRemaining };
  } catch (err) {
    return { status: "unknown", error: err.message };
  }
}

// ── CONNECTION STATUS ────────────────────────────────────────────
async function getConnectionStatus(teamId) {
  const { data } = await supabase
    .from("erp_connections")
    .select("status, updated_at, credentials")
    .eq("team_id", teamId)
    .eq("erp_type", "netsuite")
    .single();
  return data || { status: "disconnected" };
}

// ── DISCONNECT ───────────────────────────────────────────────────
async function disconnect(teamId) {
  await supabase.from("erp_connections").update({ status: "disconnected" }).eq("team_id", teamId).eq("erp_type", "netsuite");
  return { success: true };
}

module.exports = { pushInvoice, saveConnection, getConnectionStatus, disconnect, validateOnly, getPaymentStatus };
