// oracle.js — Oracle Fusion Cloud Payables Integration
// Includes pre-push validation to catch errors before they reach Oracle

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

  const credentials = Buffer.from(`${conn.username}:${conn.password}`).toString("base64");
  return { credentials, baseUrl: conn.base_url };
}

// ── ADDRESS NORMALIZER ──────────────────────────────────────────
// Intentionally minimal — we're matching against the customer's own Oracle data,
// not arbitrary addresses. Strict USPS-grade normalization is overkill here.
function normalizeAddress(s) {
  if (!s) return "";
  return String(s)
    .toLowerCase()
    .replace(/[.,#]/g, "")              // remove punctuation
    .replace(/\s+/g, " ")               // collapse whitespace
    .replace(/\bstreet\b/g, "st")       // common abbreviations
    .replace(/\bavenue\b/g, "ave")
    .replace(/\bboulevard\b/g, "blvd")
    .replace(/\broad\b/g, "rd")
    .replace(/\bsuite\b/g, "ste")
    .replace(/\bfloor\b/g, "fl")
    .replace(/\bbuilding\b/g, "bldg")
    .replace(/\bpo box\b/g, "pobox")
    .replace(/\bp o box\b/g, "pobox")
    .trim();
}

// Build a comparable string from Oracle's structured site address
function siteToNormalizedString(site) {
  return normalizeAddress(
    [site.AddressLine1, site.AddressLine2, site.City, site.State, site.PostalCode]
      .filter(Boolean)
      .join(" ")
  );
}

// ── SUPPLIER SITE MATCHER ───────────────────────────────────────
// Given an Oracle SupplierId and an invoice address, find the matching SupplierSite.
// 2-tier strategy (Option 1 — strict):
//   Tier 1 (Strong match): postal code AND street line 1 normalized match → auto-select silently
//   Tier 2 (No match): warn + return primary pay site as fallback
// Returns { match: "strong" | "fallback" | "none", site, warning }
async function findMatchingSupplierSite({ supplierId, invoiceAddress, credentials, baseUrl }) {
  if (!supplierId || !credentials || !baseUrl) {
    return { match: "none", site: null, warning: "Site matching skipped — missing supplier ID or Oracle credentials" };
  }

  let sites = [];
  try {
    const res = await axios.get(
      `${baseUrl}/fscmRestApi/resources/11.13.18.05/suppliers/${supplierId}/child/supplierSites?limit=50`,
      {
        headers: { Authorization: `Basic ${credentials}`, Accept: "application/json" },
        timeout: 8000,
      }
    );
    sites = res.data?.items || [];
  } catch (e) {
    return { match: "none", site: null, warning: `Could not fetch supplier sites from Oracle (${e.message}) — sending without site code` };
  }

  // Filter to active pay sites only — purchasing-only and inactive sites cannot receive invoices
  const today = new Date();
  const paySites = sites.filter(s => {
    const isInactive = s.InactiveDate && new Date(s.InactiveDate) <= today;
    if (isInactive) return false;
    // PaySiteFlag is a string "true"/"false" or boolean depending on Oracle config — handle both
    const isPaySite = s.PaySiteFlag === true || s.PaySiteFlag === "true";
    return isPaySite;
  });

  if (paySites.length === 0) {
    return {
      match: "none",
      site: null,
      warning: `Supplier ${supplierId} has no active pay sites in Oracle — Oracle will likely reject the invoice or require manual site assignment`,
    };
  }

  // If we have no invoice address to match against, fall back to primary pay site
  if (!invoiceAddress || !invoiceAddress.trim()) {
    const primary = paySites.find(s => s.PrimaryPaySiteFlag === true || s.PrimaryPaySiteFlag === "true") || paySites[0];
    return {
      match: "fallback",
      site: primary,
      warning: `No supplier address on invoice — defaulted to primary pay site "${primary.SupplierSiteCode}". Verify before approving.`,
    };
  }

  // Tier 1: Strong match — postal code AND street line 1 normalized match
  const normalizedInvoice = normalizeAddress(invoiceAddress);
  const strongMatches = paySites.filter(site => {
    if (!site.PostalCode) return false;
    // Postal code must appear in the invoice address (any format — full or first 5 chars of US ZIP)
    const zipShort = String(site.PostalCode).split("-")[0].trim();
    if (!normalizedInvoice.includes(zipShort.toLowerCase())) return false;
    // Street line 1 must appear in the invoice address (after normalization)
    const normalizedStreet = normalizeAddress(site.AddressLine1 || "");
    if (!normalizedStreet) return false;
    return normalizedInvoice.includes(normalizedStreet);
  });

  if (strongMatches.length === 1) {
    return { match: "strong", site: strongMatches[0], warning: null };
  }

  if (strongMatches.length > 1) {
    // Multiple sites matched — prefer the primary pay site
    const primary = strongMatches.find(s => s.PrimaryPaySiteFlag === true || s.PrimaryPaySiteFlag === "true") || strongMatches[0];
    return {
      match: "strong",
      site: primary,
      warning: `${strongMatches.length} supplier sites matched the invoice address — selected primary pay site "${primary.SupplierSiteCode}"`,
    };
  }

  // Tier 2: No strong match — fall back to primary pay site with loud warning
  const primary = paySites.find(s => s.PrimaryPaySiteFlag === true || s.PrimaryPaySiteFlag === "true") || paySites[0];
  const allSiteCodes = paySites.map(s => s.SupplierSiteCode).join(", ");
  return {
    match: "fallback",
    site: primary,
    warning: `Invoice address "${invoiceAddress}" did not match any of supplier's ${paySites.length} pay site(s) [${allSiteCodes}]. Pushed to primary site "${primary.SupplierSiteCode}" — please verify this is the correct remit-to.`,
  };
}

// ── PRE-PUSH VALIDATION ─────────────────────────────────────────
// Validates invoice data before sending to Oracle Fusion
// Returns { valid: bool, errors: [], warnings: [] }
async function validateInvoice({ invoiceData, teamId, credentials, baseUrl }) {
  const errors = [];
  const warnings = [];

  // ── 1. REQUIRED FIELDS ────────────────────────────────────────
  if (!invoiceData.invoiceNumber) errors.push("Invoice number is required");
  if (!invoiceData.total || invoiceData.total <= 0) errors.push("Invoice total must be greater than zero");
  if (!invoiceData.invoiceDate) errors.push("Invoice date is required");
  if (!invoiceData.vendor?.name) errors.push("Supplier/vendor name is required");

  // ── 2. INVOICE DATE VALIDATION ────────────────────────────────
  if (invoiceData.invoiceDate) {
    const invDate = new Date(invoiceData.invoiceDate);
    const today = new Date();
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(today.getFullYear() - 2);

    if (invDate > today) {
      errors.push(`Invoice date ${invoiceData.invoiceDate} is in the future — Oracle will reject this`);
    }
    if (invDate < twoYearsAgo) {
      warnings.push(`Invoice date ${invoiceData.invoiceDate} is over 2 years old — verify this is correct`);
    }
  }

  // ── 3. DUE DATE VALIDATION ────────────────────────────────────
  if (invoiceData.dueDate && invoiceData.invoiceDate) {
    const dueDate = new Date(invoiceData.dueDate);
    const invDate = new Date(invoiceData.invoiceDate);
    if (dueDate < invDate) {
      errors.push(`Due date ${invoiceData.dueDate} is before invoice date ${invoiceData.invoiceDate}`);
    }
  }

  // ── 4. CURRENCY VALIDATION ────────────────────────────────────
  const validCurrencies = ["USD", "EUR", "GBP", "INR", "CAD", "AUD", "SGD", "JPY", "CHF", "CNY"];
  if (invoiceData.currency && !validCurrencies.includes(invoiceData.currency.toUpperCase())) {
    warnings.push(`Currency "${invoiceData.currency}" may not be configured in your Oracle instance`);
  }

  // ── 5. AMOUNT BALANCE VALIDATION ─────────────────────────────
  if (invoiceData.lineItems?.length > 0) {
    const lineTotal = invoiceData.lineItems.reduce((sum, l) => sum + (l.amount || 0), 0);
    const tax = invoiceData.tax || 0;
    const expectedTotal = lineTotal + tax;
    const tolerance = 0.02; // 2 cents tolerance for rounding

    if (Math.abs(expectedTotal - invoiceData.total) > tolerance) {
      errors.push(
        `Amount mismatch: line items (${lineTotal.toFixed(2)}) + tax (${tax.toFixed(2)}) = ${expectedTotal.toFixed(2)}, ` +
        `but invoice total is ${invoiceData.total}. Oracle requires these to balance.`
      );
    }
  }

  // ── 6. DUPLICATE CHECK IN ORACLE ─────────────────────────────
  if (credentials && baseUrl && invoiceData.invoiceNumber && invoiceData.vendor?.name) {
    try {
      const dupRes = await axios.get(
        `${baseUrl}/fscmRestApi/resources/11.13.18.05/invoices?q=InvoiceNumber=${encodeURIComponent(invoiceData.invoiceNumber)}`,
        {
          headers: { Authorization: `Basic ${credentials}`, Accept: "application/json" },
          timeout: 8000,
        }
      );
      const existing = dupRes.data?.items || [];
      if (existing.length > 0) {
        errors.push(
          `Invoice #${invoiceData.invoiceNumber} already exists in Oracle Fusion ` +
          `(Oracle Invoice ID: ${existing[0].InvoiceId}). Oracle will reject duplicates.`
        );
      }
    } catch (e) {
      warnings.push("Could not verify duplicate status in Oracle — proceeding with caution");
    }
  }

  // ── 7. SUPPLIER VALIDATION IN ORACLE ─────────────────────────
  let matchedSupplier = null;  // captured here, used later for site matching
  if (credentials && baseUrl && invoiceData.vendor?.name) {
    try {
      const supplierRes = await axios.get(
        `${baseUrl}/fscmRestApi/resources/11.13.18.05/suppliers?q=Supplier=${encodeURIComponent(invoiceData.vendor.name)}&limit=5`,
        {
          headers: { Authorization: `Basic ${credentials}`, Accept: "application/json" },
          timeout: 8000,
        }
      );
      const suppliers = supplierRes.data?.items || [];
      if (suppliers.length === 0) {
        warnings.push(
          `Supplier "${invoiceData.vendor.name}" not found in Oracle Fusion. ` +
          `Invoice will be created but may need manual supplier assignment.`
        );
      } else {
        // Check for close name match
        const exactMatch = suppliers.find(s =>
          s.Supplier?.toLowerCase() === invoiceData.vendor.name.toLowerCase()
        );
        if (!exactMatch) {
          warnings.push(
            `Supplier name "${invoiceData.vendor.name}" has a partial match in Oracle: "${suppliers[0].Supplier}". ` +
            `Verify the correct supplier before approving.`
          );
          matchedSupplier = suppliers[0];  // partial match, but we have something to work with
        } else {
          matchedSupplier = exactMatch;
        }
      }
    } catch (e) {
      // Supplier lookup failed — not critical, continue
    }
  }

  // ── 8. PO VALIDATION ─────────────────────────────────────────
  if (invoiceData.poNumber && credentials && baseUrl) {
    try {
      const poRes = await axios.get(
        `${baseUrl}/fscmRestApi/resources/11.13.18.05/purchaseOrders?q=POHeaderId=${encodeURIComponent(invoiceData.poNumber)}&limit=1`,
        {
          headers: { Authorization: `Basic ${credentials}`, Accept: "application/json" },
          timeout: 8000,
        }
      );
      const pos = poRes.data?.items || [];
      if (pos.length === 0) {
        warnings.push(
          `PO "${invoiceData.poNumber}" not found in Oracle Fusion. ` +
          `Invoice will be unmatched — verify PO number is correct.`
        );
      } else {
        const po = pos[0];
        // Check PO amount tolerance (±10%)
        if (po.OrderedAmount) {
          const tolerance = po.OrderedAmount * 0.1;
          if (invoiceData.total > po.OrderedAmount + tolerance) {
            errors.push(
              `Invoice total (${invoiceData.total}) exceeds PO amount (${po.OrderedAmount}) ` +
              `by more than 10%. Oracle will block this for review.`
            );
          }
        }
      }
    } catch (e) {
      // PO lookup failed — not critical
    }
  }

  // ── 9. LINE ITEMS VALIDATION ──────────────────────────────────
  if (invoiceData.lineItems?.length > 0) {
    invoiceData.lineItems.forEach((line, i) => {
      if (!line.amount || line.amount <= 0) {
        errors.push(`Line item ${i + 1}: amount must be greater than zero`);
      }
      if (line.quantity && line.unitPrice) {
        const expected = line.quantity * line.unitPrice;
        if (Math.abs(expected - line.amount) > 0.02) {
          warnings.push(
            `Line item ${i + 1}: quantity (${line.quantity}) × unit price (${line.unitPrice}) = ${expected.toFixed(2)}, ` +
            `but line amount is ${line.amount}`
          );
        }
      }
    });
  }

  // ── 10. INVOICE NUMBER FORMAT ─────────────────────────────────
  if (invoiceData.invoiceNumber) {
    if (invoiceData.invoiceNumber.length > 50) {
      errors.push("Invoice number exceeds 50 characters — Oracle Fusion limit");
    }
    if (/[<>'"&]/.test(invoiceData.invoiceNumber)) {
      errors.push("Invoice number contains invalid characters (<, >, ', \", &)");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    matchedSupplier,  // null if no Oracle match found, else the Oracle supplier object with SupplierId
    summary: `${errors.length} error(s), ${warnings.length} warning(s)`,
  };
}

// ── LINE TYPE MAPPER ────────────────────────────────────────────
// Maps extracted lineType to Oracle Fusion LineType field
// Falls back to keyword detection if lineType not set by Claude
function getOracleLineType(item) {
  if (item.lineType) {
    const lt = item.lineType.toUpperCase();
    if (lt === "FREIGHT") return "FREIGHT";
    if (lt === "TAX") return "TAX";
    if (lt === "MISCELLANEOUS") return "MISCELLANEOUS";
    if (lt === "DISCOUNT") return "ITEM"; // Oracle uses negative ITEM amount for discounts
    return "ITEM";
  }
  // Fallback keyword detection
  const desc = (item.description || "").toLowerCase();
  const freightKw = ["freight", "shipping", "delivery", "courier", "carriage", "postage", "transport", "haulage"];
  const miscKw = ["handling", "packing", "packaging", "insurance", "surcharge", "fuel surcharge", "admin fee", "processing fee"];
  const taxKw = ["tax", "gst", "vat", "sales tax", "hst", "duty", "excise"];
  if (freightKw.some(k => desc.includes(k))) return "FREIGHT";
  if (taxKw.some(k => desc.includes(k))) return "TAX";
  if (miscKw.some(k => desc.includes(k))) return "MISCELLANEOUS";
  return "ITEM";
}

// ── PUSH INVOICE TO ORACLE PAYABLES ────────────────────────────
async function pushInvoice(teamId, invoiceData) {
  const { credentials, baseUrl } = await getOracleToken(teamId);

  // ── RUN PRE-PUSH VALIDATION ────────────────────────────────
  console.log(`Oracle validation: running pre-push checks for invoice #${invoiceData.invoiceNumber}`);
  const validation = await validateInvoice({ invoiceData, teamId, credentials, baseUrl });

  // Log validation results
  if (validation.warnings.length > 0) {
    console.warn("Oracle validation warnings:", validation.warnings);
  }

  // Block push if errors found
  if (!validation.valid) {
    console.error("Oracle validation failed:", validation.errors);

    // Save validation failure to Supabase
    await supabase.from("invoices").update({
      status: "validation_failed",
      agent_decision: "oracle_validation_failed",
      agent_reason: `Oracle pre-validation failed: ${validation.errors.join("; ")}`,
    }).eq("invoice_number", invoiceData.invoiceNumber).eq("team_id", teamId);

    throw new Error(
      `Invoice failed Oracle pre-validation:\n${validation.errors.map(e => `• ${e}`).join("\n")}`
    );
  }

  // Oracle Fusion Payables REST API endpoint
  const endpoint = `${baseUrl}/fscmRestApi/resources/11.13.18.05/invoices`;

  // ── SUPPLIER SITE MATCHING ──────────────────────────────────
  // If we matched a supplier in Oracle, find the right SupplierSite (remit-to)
  // by matching invoice address against the supplier's pay sites.
  let siteMatch = { match: "none", site: null, warning: null };
  if (validation.matchedSupplier?.SupplierId) {
    siteMatch = await findMatchingSupplierSite({
      supplierId: validation.matchedSupplier.SupplierId,
      invoiceAddress: invoiceData.vendor?.address,
      credentials,
      baseUrl,
    });
    if (siteMatch.warning) {
      validation.warnings.push(siteMatch.warning);
      console.warn("Site matching:", siteMatch.warning);
    }
    if (siteMatch.match === "strong") {
      console.log(`Site matched (strong): ${siteMatch.site.SupplierSiteCode}`);
    }
  }

  // Map invoice data to Oracle Fusion format
  const oracleInvoice = {
    InvoiceNumber: invoiceData.invoiceNumber || `INV-${Date.now()}`,
    InvoiceCurrency: invoiceData.currency || "USD",
    InvoiceAmount: invoiceData.total || 0,
    InvoiceDate: invoiceData.invoiceDate || new Date().toISOString().split("T")[0],
    DueDate: invoiceData.dueDate,
    PaymentTerms: invoiceData.paymentTerms || "NET30",
    Description: `Processed by APFlow. Vendor: ${invoiceData.vendor?.name || "Unknown"}`,
    PurchaseOrder: invoiceData.poNumber,
    SupplierName: invoiceData.vendor?.name,
    // SupplierSite expects Oracle's SiteCode (a string identifier), NOT raw address text.
    // Falls back to address text only if site matching couldn't find anything (legacy behavior).
    SupplierSite: siteMatch.site?.SupplierSiteCode || invoiceData.vendor?.address,
    InvoiceType: "STANDARD",
    Source: "APFlow",
    invoiceLines: (invoiceData.lineItems || []).map((item, i) => {
      const lineType = getOracleLineType(item);
      console.log(`  Line ${i+1}: "${item.description}" → Oracle LineType: ${lineType} (${item.amount})`);
      return {
        LineNumber: i + 1,
        LineType: lineType,
        LineAmount: item.amount || 0,
        Description: item.description,
        Quantity: lineType === "ITEM" ? (item.quantity || 1) : undefined,
        UnitPrice: lineType === "ITEM" ? (item.unitPrice || 0) : undefined,
      };
    }),
  };

  // Add tax line only if not already in line items
  const hasTaxLine = (invoiceData.lineItems || []).some(l => getOracleLineType(l) === "TAX");
  if (invoiceData.tax && invoiceData.tax > 0 && !hasTaxLine) {
    oracleInvoice.invoiceLines.push({
      LineNumber: (invoiceData.lineItems?.length || 0) + 1,
      LineType: "TAX",
      LineAmount: invoiceData.tax,
      Description: "Tax",
    });
  }

  // Log freight summary
  const freightLines = oracleInvoice.invoiceLines.filter(l => l.LineType === "FREIGHT");
  if (freightLines.length > 0) {
    const freightTotal = freightLines.reduce((s, l) => s + (l.LineAmount || 0), 0);
    console.log(`Oracle push: ${freightLines.length} FREIGHT line(s) detected — total: ${freightTotal}`);
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

    // Save validation warnings to invoice record
    if (validation.warnings.length > 0) {
      await supabase.from("invoices").update({
        agent_reason: `Pushed to Oracle with ${validation.warnings.length} warning(s): ${validation.warnings.join("; ")}`,
      }).eq("invoice_number", invoiceData.invoiceNumber).eq("team_id", teamId);
    }

    // ── ATTACH PDF TO ORACLE INVOICE HEADER ────────────────────
    let pdfAttachment = null;
    if (pdfBase64 && oracle.InvoiceId) {
      pdfAttachment = await attachPDFToInvoice({
        invoiceId: oracle.InvoiceId,
        pdfBase64,
        filename: pdfFilename || `Invoice_${invoiceData.invoiceNumber || Date.now()}.pdf`,
        credentials,
        baseUrl,
      });
      if (pdfAttachment?.success) {
        console.log(`PDF attached to Oracle Invoice ${oracle.InvoiceId}`);
      }
    }

    return {
      success: true,
      erpReference: `ORA-${oracle.InvoiceId || Date.now()}`,
      erpType: "oracle",
      validation,
      pdfAttached: pdfAttachment?.success || false,
      details: {
        invoiceId: oracle.InvoiceId,
        invoiceNumber: oracle.InvoiceNumber,
        status: oracle.InvoiceStatus,
        amount: oracle.InvoiceAmount,
        warnings: validation.warnings,
        pdfAttachment,
        siteMatch: {
          quality: siteMatch.match,                          // "strong" | "fallback" | "none"
          siteCode: siteMatch.site?.SupplierSiteCode || null,
          siteId: siteMatch.site?.SupplierSiteId || null,
        },
      }
    };
  } catch (err) {
    const msg = err.response?.data?.detail || err.response?.data?.title || err.message;
    throw new Error(`Oracle Fusion error: ${msg}`);
  }
}

// ── VALIDATE ONLY (without pushing) ────────────────────────────
async function validateOnly(teamId, invoiceData) {
  try {
    const { credentials, baseUrl } = await getOracleToken(teamId);
    return await validateInvoice({ invoiceData, teamId, credentials, baseUrl });
  } catch (err) {
    // If Oracle not connected, run local validation only
    return await validateInvoice({ invoiceData, teamId, credentials: null, baseUrl: null });
  }
}

// ── SAVE ORACLE CONNECTION ──────────────────────────────────────
async function saveConnection(teamId, { baseUrl, username, password }) {
  await supabase.from("erp_connections").upsert({
    team_id: teamId,
    erp_type: "oracle",
    base_url: baseUrl,
    username,
    password,
    status: "connected",
    updated_at: new Date().toISOString(),
  }, { onConflict: "team_id,erp_type" });

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


// ── ATTACH PDF TO ORACLE INVOICE HEADER ─────────────────────────
async function attachPDFToInvoice({ invoiceId, pdfBase64, filename, credentials, baseUrl }) {
  if (!invoiceId || !pdfBase64 || !credentials || !baseUrl) return null;
  try {
    const endpoint = `${baseUrl}/fscmRestApi/resources/11.13.18.05/invoices/${invoiceId}/child/attachments`;
    const safeFilename = (filename || "invoice.pdf").replace(/[^a-zA-Z0-9._-]/g, "_");

    const payload = {
      CategoryName: "MISC",
      Title: safeFilename,
      ContentRepositoryFileShared: false,
      DatatypeCode: "FILE",
      FileName: safeFilename,
      FileContents: pdfBase64,
    };

    await axios.post(endpoint, payload, {
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      timeout: 15000,
    });

    console.log(`PDF attached to Oracle Invoice ID ${invoiceId}: ${safeFilename}`);
    return { success: true, invoiceId, filename: safeFilename };
  } catch (err) {
    const msg = err.response?.data?.detail || err.response?.data?.title || err.message;
    console.error(`Oracle PDF attachment failed: ${msg}`);
    return { success: false, error: msg };
  }
}

module.exports = { pushInvoice, attachPDFToInvoice, saveConnection, getConnectionStatus, disconnect, validateOnly };
