// vendorMatcher.js — APFlow Vendor Master Matching
// Resolves ambiguous vendor names against ERP vendor master
// Uses 4 layers: PO match → Claude fuzzy → email domain → Slack disambiguation

const axios = require("axios");
const Anthropic = require("@anthropic-ai/sdk");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── FETCH ORACLE VENDOR MASTER ───────────────────────────────────
async function fetchOracleVendors({ credentials, baseUrl, searchName }) {
  try {
    const encoded = encodeURIComponent(searchName.split(" ")[0]); // use first word for broad search
    const url = `${baseUrl}/fscmRestApi/resources/11.13.18.05/suppliers?q=Supplier LIKE '%25${encoded}%25'&limit=20&fields=SupplierId,Supplier,SupplierNumber,Status`;
    const res = await axios.get(url, {
      headers: { Authorization: `Basic ${credentials}`, Accept: "application/json" },
      timeout: 8000,
    });
    return res.data?.items || [];
  } catch (e) {
    console.error("Oracle vendor fetch error:", e.message);
    return [];
  }
}

// ── LAYER 1: PO-BASED VENDOR MATCH ──────────────────────────────
async function matchByPO({ poNumber, teamId, credentials, baseUrl }) {
  if (!poNumber || !credentials || !baseUrl) return null;
  try {
    const url = `${baseUrl}/fscmRestApi/resources/11.13.18.05/purchaseOrders?q=POHeaderId=${encodeURIComponent(poNumber)}&fields=SupplierId,Supplier&limit=1`;
    const res = await axios.get(url, {
      headers: { Authorization: `Basic ${credentials}`, Accept: "application/json" },
      timeout: 8000,
    });
    const po = res.data?.items?.[0];
    if (po?.Supplier) {
      console.log(`Vendor match Layer 1 (PO): "${po.Supplier}" from PO ${poNumber}`);
      return { vendor: po.Supplier, supplierId: po.SupplierId, confidence: 100, method: "po_match" };
    }
  } catch (e) { /* PO lookup failed */ }
  return null;
}

// ── LAYER 2: CLAUDE FUZZY MATCH ──────────────────────────────────
async function matchByClaude({ invoiceVendorName, oracleVendors }) {
  if (!invoiceVendorName || !oracleVendors.length) return null;
  try {
    const vendorList = oracleVendors.map((v, i) => `${i + 1}. ${v.Supplier} (ID: ${v.SupplierId})`).join("\n");
    const response = await claude.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 200,
      messages: [{
        role: "user",
        content: `Invoice vendor name: "${invoiceVendorName}"

Oracle Fusion vendor master:
${vendorList}

Which vendor number (1-${oracleVendors.length}) best matches the invoice vendor name?
Consider abbreviations, legal entity suffixes (Inc, LLC, Ltd, International, Corp), and common variations.

Reply ONLY with JSON: {"match": <number or null>, "confidence": <0-100>, "reason": "<brief reason>"}
If no good match (confidence < 70), set match to null.`
      }]
    });

    const text = response.content[0]?.text || "";
    const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || "{}");

    if (parsed.match && parsed.confidence >= 70) {
      const matched = oracleVendors[parsed.match - 1];
      console.log(`Vendor match Layer 2 (Claude): "${matched.Supplier}" confidence=${parsed.confidence}% reason="${parsed.reason}"`);
      return {
        vendor: matched.Supplier,
        supplierId: matched.SupplierId,
        confidence: parsed.confidence,
        method: "claude_fuzzy",
        reason: parsed.reason,
      };
    }
    return null;
  } catch (e) {
    console.error("Claude vendor match error:", e.message);
    return null;
  }
}

// ── LAYER 3: EMAIL DOMAIN MATCH ──────────────────────────────────
async function matchByEmail({ senderEmail, teamId, oracleVendors }) {
  if (!senderEmail) return null;
  try {
    const domain = senderEmail.split("@")[1]?.toLowerCase();
    if (!domain) return null;

    // Check if any team member/supplier is registered with this email domain
    const { data: members } = await supabase
      .from("team_members")
      .select("supplier_company, email")
      .eq("team_id", teamId)
      .eq("role", "supplier")
      .ilike("email", `%@${domain}`);

    if (members?.length === 1 && members[0].supplier_company) {
      // Find matching oracle vendor
      const supplierCompany = members[0].supplier_company.toLowerCase();
      const matched = oracleVendors.find(v => v.Supplier?.toLowerCase().includes(supplierCompany) || supplierCompany.includes(v.Supplier?.toLowerCase()));
      if (matched) {
        console.log(`Vendor match Layer 3 (Email domain): "${matched.Supplier}" from domain ${domain}`);
        return { vendor: matched.Supplier, supplierId: matched.SupplierId, confidence: 88, method: "email_domain" };
      }
    }
  } catch (e) { /* email match failed */ }
  return null;
}

// ── LAYER 4: SLACK DISAMBIGUATION ───────────────────────────────
async function sendVendorDisambiguationSlack({ webhookUrl, invoiceId, teamId, invoiceVendorName, invoiceNumber, amount, currency, candidates, backendUrl }) {
  if (!webhookUrl || !candidates.length) return;

  const sym = currency === "EUR" ? "€" : currency === "GBP" ? "£" : currency === "INR" ? "₹" : "$";
  backendUrl = backendUrl || "https://invoiceiq-backend-w42q.onrender.com";

  const payload = {
    attachments: [{
      color: "#f59e0b",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `🔍 *Vendor disambiguation needed*\n\nInvoice *#${invoiceNumber}* (${sym}${Number(amount).toLocaleString()}) was received from *"${invoiceVendorName}"* — multiple matching vendors found in Oracle. Which one is correct?`,
          },
        },
        {
          type: "actions",
          elements: candidates.slice(0, 5).map(v => ({
            type: "button",
            text: { type: "plain_text", text: v.Supplier },
            action_id: "vendor_select",
            value: JSON.stringify({ invoiceId, teamId, supplierId: v.SupplierId, supplierName: v.Supplier }),
          })),
        },
        {
          type: "context",
          elements: [{ type: "mrkdwn", text: `Invoice #${invoiceNumber} · ${invoiceVendorName} · APFlow Vendor Matcher` }],
        },
      ],
    }],
  };

  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

// ── MAIN: MATCH VENDOR ───────────────────────────────────────────
async function matchVendor({ invoiceData, teamId, credentials, baseUrl, senderEmail, notifySlack }) {
  const invoiceVendorName = invoiceData.vendor?.name || "";
  const poNumber = invoiceData.poNumber;
  const result = { matched: false, vendor: null, supplierId: null, confidence: 0, method: null, needsDisambiguation: false, candidates: [] };

  if (!invoiceVendorName) return result;

  // Layer 1: PO match
  if (poNumber && credentials && baseUrl) {
    const poMatch = await matchByPO({ poNumber, teamId, credentials, baseUrl });
    if (poMatch) return { ...result, matched: true, ...poMatch };
  }

  // Fetch Oracle vendor master for remaining layers
  let oracleVendors = [];
  if (credentials && baseUrl) {
    oracleVendors = await fetchOracleVendors({ credentials, baseUrl, searchName: invoiceVendorName });
  }

  // Layer 2: Claude fuzzy match
  if (oracleVendors.length > 0) {
    const claudeMatch = await matchByClaude({ invoiceVendorName, oracleVendors });
    if (claudeMatch) return { ...result, matched: true, ...claudeMatch };
  }

  // Layer 3: Email domain match
  if (senderEmail && oracleVendors.length > 0) {
    const emailMatch = await matchByEmail({ senderEmail, teamId, oracleVendors });
    if (emailMatch) return { ...result, matched: true, ...emailMatch };
  }

  // Layer 4: Multiple candidates — send Slack disambiguation
  if (oracleVendors.length > 0) {
    result.needsDisambiguation = true;
    result.candidates = oracleVendors;

    if (notifySlack?.webhookUrl) {
      await sendVendorDisambiguationSlack({
        webhookUrl: notifySlack.webhookUrl,
        invoiceId: invoiceData.id,
        teamId,
        invoiceVendorName,
        invoiceNumber: invoiceData.invoiceNumber,
        amount: invoiceData.total,
        currency: invoiceData.currency || "USD",
        candidates: oracleVendors,
      });
      console.log(`Vendor disambiguation Slack sent — ${oracleVendors.length} candidates for "${invoiceVendorName}"`);
    }
  }

  return result;
}

// ── SAVE VENDOR SELECTION (from Slack button click) ──────────────
async function saveVendorSelection({ invoiceId, teamId, supplierId, supplierName }) {
  await supabase.from("invoices").update({
    agent_reason: `Vendor resolved to "${supplierName}" (Oracle ID: ${supplierId}) by AP Manager via Slack`,
  }).eq("id", invoiceId).eq("team_id", teamId);

  // Save to vendor mapping table for future auto-resolution
  await supabase.from("vendor_mappings").upsert({
    team_id: teamId,
    invoice_vendor_name: supplierName,
    oracle_supplier_id: supplierId,
    oracle_supplier_name: supplierName,
    updated_at: new Date().toISOString(),
  }, { onConflict: "team_id,invoice_vendor_name" });

  console.log(`Vendor selection saved: "${supplierName}" (ID: ${supplierId}) for invoice ${invoiceId}`);
}

module.exports = { matchVendor, saveVendorSelection, sendVendorDisambiguationSlack };
