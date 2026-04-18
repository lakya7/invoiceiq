// batchProcessor.js — APFlow Batch ZIP Processing
// Extracts PDFs from ZIP files and processes each as an invoice

const AdmZip = require("adm-zip");
const { createClient } = require("@supabase/supabase-js");
const Anthropic = require("@anthropic-ai/sdk");
const path = require("path");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── ROBUST JSON EXTRACTOR ───────────────────────────────────────
// Finds the first balanced {...} block in a string, ignoring extra text
function extractJSON(text) {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch (e) {
          return null;
        }
      }
    }
  }
  return null;
}

// ── PROCESS ZIP BUFFER ──────────────────────────────────────────
async function processZipBuffer({ zipBuffer, teamId, userId, source = "manual" }) {
  const results = { processed: 0, skipped: 0, failed: 0, invoices: [] };

  try {
    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries();

    // Filter only PDF files
    const pdfEntries = entries.filter(e =>
      !e.isDirectory && e.entryName.toLowerCase().endsWith(".pdf")
    );

    if (!pdfEntries.length) {
      return { ...results, error: "No PDF files found in ZIP" };
    }

    console.log(`Processing ZIP with ${pdfEntries.length} PDFs`);

    for (const entry of pdfEntries) {
      try {
        const pdfBuffer = entry.getData();
        const base64Data = pdfBuffer.toString("base64");
        const filename = path.basename(entry.entryName);

        console.log(`Processing: ${filename}`);

        // Claude pre-check — is this an invoice?
        const preCheck = await claude.messages.create({
          model: "claude-opus-4-6",
          max_tokens: 100,
          messages: [{
            role: "user",
            content: [
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64Data } },
              { type: "text", text: `Is this PDF an invoice, bill, or payment request? Reply with ONLY "YES" or "NO".` }
            ]
          }]
        });

        const isInvoice = preCheck.content[0]?.text?.trim().toUpperCase().startsWith("YES");
        if (!isInvoice) {
          console.log(`Skipping ${filename} — not an invoice`);
          results.skipped++;
          results.invoices.push({ filename, status: "skipped", reason: "Not an invoice" });
          continue;
        }

        // Extract invoice data
        const extracted = await extractInvoiceData(base64Data, filename);
        if (!extracted) {
          results.failed++;
          results.invoices.push({ filename, status: "failed", reason: "Extraction failed" });
          continue;
        }

        // Duplicate check
        if (extracted.invoiceNumber) {
          const { data: duplicates } = await supabase
            .from("invoices")
            .select("id, created_at")
            .eq("invoice_number", extracted.invoiceNumber)
            .eq("team_id", teamId);

          if (duplicates && duplicates.length > 0) {
            const originalDate = new Date(duplicates[0].created_at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
            results.skipped++;
            results.invoices.push({ filename, status: "duplicate", invoiceNumber: extracted.invoiceNumber, originalDate });
            continue;
          }
        }

        // Save to database
        const erpRef = `BATCH-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const { error: insertError } = await supabase.from("invoices").insert({
          user_id: userId,
          team_id: teamId,
          invoice_number: extracted.invoiceNumber,
          vendor_name: extracted.vendor?.name,
          invoice_date: extracted.invoiceDate,
          due_date: extracted.dueDate,
          total: extracted.total,
          currency: extracted.currency || "USD",
          status: "pushed",
          match_status: "unmatched",
          erp_reference: erpRef,
          raw_data: extracted,
          agent_decision: `batch_${source}`,
          agent_reason: `Auto-processed from ZIP batch upload (${filename})`,
        });

        if (insertError) {
          console.error(`Insert error for ${filename}:`, insertError.message);
          results.failed++;
          results.invoices.push({ filename, status: "failed", reason: insertError.message });
          continue;
        }

        results.processed++;
        results.invoices.push({
          filename,
          status: "processed",
          invoiceNumber: extracted.invoiceNumber,
          vendor: extracted.vendor?.name,
          amount: extracted.total,
          currency: extracted.currency,
          erpRef,
        });

      } catch (e) {
        console.error(`Error processing ${entry.entryName}:`, e.message);
        results.failed++;
        results.invoices.push({ filename: entry.entryName, status: "failed", reason: e.message });
      }
    }

    return results;
  } catch (err) {
    console.error("ZIP processing error:", err.message);
    return { ...results, error: err.message };
  }
}

async function extractInvoiceData(base64Data, filename) {
  try {
    const response = await claude.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64Data } },
          {
            type: "text",
            text: `Extract invoice data from this PDF (filename: "${filename}").

IMPORTANT — for each line item set lineType:
- "ITEM" → products, parts, services, labor
- "FREIGHT" → freight, shipping, delivery, courier, carriage, postage
- "MISCELLANEOUS" → handling, packing, insurance, surcharge, fuel surcharge
- "TAX" → tax, GST, VAT, sales tax (if shown as a line item)
- "DISCOUNT" → discounts, rebates, credits (use negative amount)

If freight/shipping appears only as a summary field (not a line item), still include it as a separate lineItem with lineType "FREIGHT".

Return ONLY valid JSON with no extra text before or after:
{
  "invoiceNumber": "string",
  "invoiceDate": "YYYY-MM-DD",
  "dueDate": "YYYY-MM-DD or null",
  "vendor": { "name": "string", "email": "string or null" },
  "total": number,
  "subtotal": number,
  "tax": number,
  "currency": "USD/EUR/GBP/INR",
  "lineItems": [
    {
      "description": "string",
      "quantity": number,
      "unitPrice": number,
      "amount": number,
      "lineType": "ITEM|FREIGHT|MISCELLANEOUS|TAX|DISCOUNT"
    }
  ],
  "hasFreight": true/false,
  "freightAmount": number or null
}`
          }
        ]
      }]
    });

    const text = response.content[0]?.text || "";
    // Use balanced-brace extractor instead of greedy regex
    const parsed = extractJSON(text);
    if (!parsed) {
      console.error(`Could not parse JSON from Claude response for ${filename}. Raw: ${text.slice(0, 200)}`);
      return null;
    }
    return parsed;
  } catch (e) {
    console.error("Extraction error:", e.message);
    return null;
  }
}

module.exports = { processZipBuffer };
