// emailAgent.js — APFlow Email Invoice Agent
// Monitors Gmail/Outlook inbox for invoice emails and auto-processes them

const { createClient } = require("@supabase/supabase-js");
const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── GMAIL POLLING ───────────────────────────────────────────────
async function createGmailClient(accessToken, refreshToken) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI
  );
  oauth2Client.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
  return google.gmail({ version: "v1", auth: oauth2Client });
}

// ── EXTRACT PLAIN TEXT BODY FROM EMAIL ─────────────────────────
function extractEmailBody(payload) {
  let body = "";
  const decode = (data) => {
    if (!data) return "";
    return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
  };
  const walk = (part) => {
    if (!part) return;
    if (part.mimeType === "text/plain" && part.body?.data) {
      body += decode(part.body.data) + "\n";
    }
    if (part.parts) part.parts.forEach(walk);
  };
  walk(payload);
  return body.trim().slice(0, 1000); // limit to 1000 chars
}

async function checkGmailForInvoices({ accessToken, refreshToken, teamId, userId, lastChecked }) {
  try {
    const gmail = await createGmailClient(accessToken, refreshToken);
    const after = lastChecked ? Math.floor(new Date(lastChecked).getTime() / 1000) : Math.floor(Date.now() / 1000) - 3600;

    // Search for emails with PDF or ZIP attachments
    const query = `has:attachment (filename:pdf OR filename:zip) after:${after}`;

    const { data } = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: 20,
    });

    if (!data.messages?.length) return { processed: 0, emails: [] };

    // Filter by subject keywords in JS (more reliable than Gmail query syntax)
    const invoiceKeywords = ["invoice", "bill", "payment", "receipt", "purchase order", "statement", "remittance", "due", "tax"];

    const results = [];
    for (const msg of data.messages) {
      try {
        // Get just headers first to check subject
        const { data: headers } = await gmail.users.messages.get({
          userId: "me", id: msg.id, format: "metadata",
          metadataHeaders: ["Subject", "From"],
        });

        const subject = headers.payload.headers.find(h => h.name === "Subject")?.value?.toLowerCase() || "";
        const hasInvoiceKeyword = invoiceKeywords.some(k => subject.includes(k));

        // ── FIX: If no invoice keyword in subject, check if email actually has a ZIP attachment ──
        if (!hasInvoiceKeyword) {
          const { data: fullMsg } = await gmail.users.messages.get({
            userId: "me", id: msg.id, format: "full",
          });

          // Recursively walk message parts to find any ZIP attachment
          const hasZipAttachment = (function findZip(parts) {
            if (!parts) return false;
            for (const part of parts) {
              if (
                part.mimeType === "application/zip" ||
                part.mimeType === "application/x-zip-compressed" ||
                part.mimeType === "application/octet-stream" ||
                part.filename?.toLowerCase().endsWith(".zip")
              ) return true;
              if (part.parts && findZip(part.parts)) return true;
            }
            return false;
          })(fullMsg.payload.parts || [fullMsg.payload]);

          if (!hasZipAttachment) {
            console.log(`Skipping email - no invoice keyword and no ZIP attachment: "${subject}"`);
            continue;
          }

          // Has ZIP — process directly using the already-fetched full message
          console.log(`ZIP email detected (no invoice keyword in subject): "${subject}" — processing`);
          const result = await processGmailMessage({ gmail, messageId: msg.id, teamId, userId });
          if (result) results.push(result);
          continue;
        }

        const result = await processGmailMessage({ gmail, messageId: msg.id, teamId, userId });
        if (result) results.push(result);
      } catch (e) {
        console.error(`Error processing email ${msg.id}:`, e.message);
      }
    }

    const flat = results.flat().filter(Boolean);
    const processedCount = flat.filter(r => !r?.skipped && r?.erpRef).length;
    return { processed: processedCount, emails: flat };
  } catch (err) {
    console.error("Gmail check error:", err.message);
    throw err;
  }
}

async function processGmailMessage({ gmail, messageId, teamId, userId }) {
  const { data: msg } = await gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });

  const headers = msg.payload.headers;
  const subject = headers.find(h => h.name === "Subject")?.value || "No Subject";
  const from = headers.find(h => h.name === "From")?.value || "Unknown";
  const date = headers.find(h => h.name === "Date")?.value;

  // ── EXTRACT EMAIL BODY for PO number detection ──────────────
  const emailBody = extractEmailBody(msg.payload);
  if (emailBody) console.log(`Email body snippet: "${emailBody.slice(0, 100)}..."`);

  // Find PDF and ZIP attachments
  const attachments = [];
  const zipAttachments = [];
  const findParts = (parts) => {
    if (!parts) return;
    for (const part of parts) {
      if (part.mimeType === "application/pdf" || part.filename?.toLowerCase().endsWith(".pdf")) {
        attachments.push({ ...part, type: "pdf" });
      }
      if (
        part.mimeType === "application/zip" ||
        part.mimeType === "application/x-zip-compressed" ||
        part.mimeType === "application/octet-stream" ||
        part.filename?.toLowerCase().endsWith(".zip")
      ) {
        zipAttachments.push({ ...part, type: "zip" });
      }
      if (part.parts) findParts(part.parts);
    }
  };
  findParts(msg.payload.parts || [msg.payload]);

  if (!attachments.length && !zipAttachments.length) return null;

  // Check if already processed — but only block if a non-ZIP non-duplicate log exists
  const { data: existingLogs } = await supabase
    .from("email_agent_log")
    .select("id, erp_reference")
    .eq("gmail_message_id", messageId)
    .not("erp_reference", "like", "DUPLICATE%")
    .not("erp_reference", "like", "ZIP-BATCH%");

  if (existingLogs && existingLogs.length > 0) {
    console.log(`Email ${messageId} already processed — skipping`);
    return null;
  }

  const results = [];
  for (const att of attachments) {
    try {
      // Download attachment
      const { data: attData } = await gmail.users.messages.attachments.get({
        userId: "me",
        messageId,
        id: att.body.attachmentId,
      });

      const base64Data = attData.data.replace(/-/g, "+").replace(/_/g, "/");

      // Extract invoice data with Claude
      const extracted = await extractInvoiceFromBase64(base64Data, subject, from, emailBody);
      if (!extracted) continue;

      // Save to database
      const erpRef = `EMAIL-${Date.now()}`;

      // ── DUPLICATE CHECK ──────────────────────────────────────
      if (extracted.invoiceNumber) {
        const { data: duplicates } = await supabase
          .from("invoices")
          .select("id, erp_reference, created_at")
          .eq("invoice_number", extracted.invoiceNumber)
          .eq("team_id", teamId);

        if (duplicates && duplicates.length > 0) {
          const originalDate = new Date(duplicates[0].created_at).toLocaleDateString("en-US", { year:"numeric", month:"short", day:"numeric" });
          console.log(`Duplicate invoice detected: #${extracted.invoiceNumber} already processed on ${originalDate}`);
          await supabase.from("email_agent_log").insert({
            team_id: teamId,
            gmail_message_id: messageId + `-dup-${Date.now()}`,
            from_email: from,
            subject,
            filename: att.filename,
            invoice_number: extracted.invoiceNumber,
            vendor_name: extracted.vendor?.name,
            amount: extracted.total,
            erp_reference: `DUPLICATE-SKIPPED`,
            processed_at: new Date().toISOString(),
          });
          results.push({ subject, from, invoiceNumber: extracted.invoiceNumber, skipped: true, reason: "Duplicate invoice", originalDate });
          continue;
        }
      }

      // ── PO MATCH: if PO number found in email body or PDF ───────
      let matchStatus = "unmatched";
      let matchedPoId = null;
      const poNumber = extracted.poNumber || null;
      if (poNumber) {
        const { data: matchedPo } = await supabase
          .from("purchase_orders")
          .select("id, po_number, status")
          .eq("team_id", teamId)
          .eq("po_number", poNumber)
          .single();
        if (matchedPo) {
          matchStatus = "matched";
          matchedPoId = matchedPo.id;
          console.log(`PO Match found: Invoice #${extracted.invoiceNumber} → PO ${poNumber}`);
          // Update PO status
          await supabase.from("purchase_orders").update({ status: "fully_matched" }).eq("id", matchedPo.id);
        }
      }

      const { data: savedInvoice, error: insertError } = await supabase.from("invoices").insert({
        user_id: userId,
        team_id: teamId,
        invoice_number: extracted.invoiceNumber,
        vendor_name: extracted.vendor?.name,
        invoice_date: extracted.invoiceDate,
        total: extracted.total,
        status: "pushed",
        match_status: matchStatus,
        erp_reference: erpRef,
        raw_data: extracted,
        agent_decision: "email_auto_processed",
        agent_reason: `Auto-processed from email: "${subject}" from ${from}${poNumber ? ` | PO: ${poNumber}` : ""}`,
      });

      if (insertError) {
        console.error("Invoice insert error:", JSON.stringify(insertError));
        continue;
      }

      console.log("Invoice saved successfully:", erpRef);

      // Log processed email
      await supabase.from("email_agent_log").insert({
        team_id: teamId,
        gmail_message_id: messageId,
        from_email: from,
        subject,
        filename: att.filename,
        invoice_number: extracted.invoiceNumber,
        vendor_name: extracted.vendor?.name,
        amount: extracted.total,
        erp_reference: erpRef,
        processed_at: new Date().toISOString(),
      });

      results.push({ subject, from, invoiceNumber: extracted.invoiceNumber, amount: extracted.total, erpRef });
    } catch (e) {
      console.error("Attachment processing error:", e.message);
    }
  }

  // ── PROCESS ZIP ATTACHMENTS ─────────────────────────────────
  for (const zip of zipAttachments) {
    try {
      const { data: attData } = await gmail.users.messages.attachments.get({
        userId: "me", messageId, id: zip.body.attachmentId,
      });
      const zipBuffer = Buffer.from(attData.data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
      const { processZipBuffer } = require("./batchProcessor");
      const batchResult = await processZipBuffer({ zipBuffer, teamId, userId, source: "email" });

      // Log the ZIP processing
      await supabase.from("email_agent_log").insert({
        team_id: teamId,
        gmail_message_id: messageId + `-zip-${Date.now()}`,
        from_email: from,
        subject,
        filename: zip.filename,
        invoice_number: `BATCH:${batchResult.processed}`,
        vendor_name: `ZIP: ${batchResult.processed} processed, ${batchResult.skipped} skipped`,
        amount: 0,
        erp_reference: `ZIP-BATCH`,
        processed_at: new Date().toISOString(),
      });

      batchResult.invoices?.forEach(inv => {
        if (inv.status === "processed") {
          results.push({ subject, from, invoiceNumber: inv.invoiceNumber, amount: inv.amount, erpRef: inv.erpRef });
        }
      });
    } catch (e) {
      console.error("ZIP processing error:", e.message);
    }
  }

  return results.length ? results : null;
}

async function extractInvoiceFromBase64(base64Data, subject, from, emailBody = "") {
  try {
    // ── STEP 1: Claude pre-check — is this actually an invoice? ──
    const preCheck = await claude.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 100,
      messages: [{
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: base64Data }
          },
          {
            type: "text",
            text: `Is this PDF an invoice, bill, or payment request? Reply with ONLY "YES" or "NO".`
          }
        ]
      }]
    });

    const isInvoice = preCheck.content[0]?.text?.trim().toUpperCase().startsWith("YES");
    if (!isInvoice) {
      console.log(`Skipping non-invoice PDF from "${from}" — subject: "${subject}"`);
      return null;
    }

    // ── STEP 2: Full extraction ──────────────────────────────────
    const response = await claude.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: base64Data }
          },
          {
            type: "text",
            text: `Extract invoice data from this PDF.
Email subject: "${subject}"
From: "${from}"
${emailBody ? `Email body: "${emailBody}"` : ""}

The invoice may be in ANY language (French, German, Spanish, Japanese, Chinese, Arabic, Hindi, etc.). Extract all fields and return them in English JSON regardless of the invoice language. Use ISO 4217 currency codes (USD, EUR, GBP, JPY, CNY, AED, SAR, BRL, INR, MXN, CAD, AUD, SGD, CHF, etc.).

IMPORTANT: If the email body mentions a PO number, purchase order number, or reference like "PO-123", "PO#456", "Purchase Order 789", extract it as poNumber even if it's not on the PDF itself.

For each line item, set lineType:
- "ITEM" for products, parts, services, labor
- "FREIGHT" for freight, shipping, delivery, courier, carriage, postage
- "MISCELLANEOUS" for handling, packing, insurance, surcharges, fuel surcharge
- "TAX" for tax, GST, VAT, sales tax shown as a line item
- "DISCOUNT" for discounts or rebates (use negative amount)
If freight appears only as a summary field (not a line item), include it as a separate lineItem with lineType "FREIGHT".

Return ONLY valid JSON with these fields:
{
  "invoiceNumber": "string",
  "invoiceDate": "YYYY-MM-DD",
  "dueDate": "YYYY-MM-DD or null",
  "vendor": { "name": "string", "email": "string or null" },
  "total": number,
  "subtotal": number or null,
  "tax": number or null,
  "currency": "ISO 4217 code e.g. USD/EUR/GBP/JPY/CNY/AED/INR/etc",
  "lineItems": [
    {
      "description": "string",
      "quantity": number or null,
      "unitPrice": number or null,
      "amount": number,
      "lineType": "ITEM|FREIGHT|MISCELLANEOUS|TAX|DISCOUNT"
    }
  ],
  "poNumber": "string or null",
  "hasFreight": true or false,
  "freightAmount": number or null
}`
          }
        ]
      }]
    });

    const text = response.content[0]?.text || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error("Claude extraction error:", e.message);
    return null;
  }
}

// ── SAVE/GET EMAIL AGENT CONFIG ─────────────────────────────────
async function saveEmailAgentConfig({ teamId, provider, accessToken, refreshToken, email, enabled }) {
  const { data, error } = await supabase.from("email_agent_config").upsert({
    team_id: teamId,
    provider,
    access_token: accessToken,
    refresh_token: refreshToken,
    email,
    enabled,
    updated_at: new Date().toISOString(),
  }, { onConflict: "team_id" }).select().single();

  if (error) throw error;
  return data;
}

async function getEmailAgentConfig(teamId) {
  const { data } = await supabase.from("email_agent_config").select("*").eq("team_id", teamId).single();
  return data;
}

module.exports = { checkGmailForInvoices, saveEmailAgentConfig, getEmailAgentConfig };

// ── IMAP CONNECTOR ───────────────────────────────────────────────
// Supports any email provider: Outlook, Yahoo, corporate IMAP servers
// Install: npm install imap mailparser (add to package.json)

async function checkImapForInvoices({ host, port, email, password, teamId, userId, lastChecked }) {
  const Imap = require("imap");
  const { simpleParser } = require("mailparser");

  return new Promise((resolve, reject) => {
    const results = { processed: 0, skipped: 0, failed: 0, emails: [] };

    const imap = new Imap({
      user: email,
      password,
      host,
      port: port || 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 15000,
      authTimeout: 10000,
    });

    imap.once("ready", () => {
      imap.openBox("INBOX", false, async (err, box) => {
        if (err) { imap.end(); return resolve(results); }

        // Search for unseen emails since last checked
        const sinceDate = lastChecked
          ? new Date(lastChecked).toLocaleDateString("en-US", { day:"2-digit", month:"short", year:"numeric" })
          : new Date(Date.now() - 24 * 60 * 60 * 1000).toLocaleDateString("en-US", { day:"2-digit", month:"short", year:"numeric" });

        imap.search(["UNSEEN", ["SINCE", sinceDate]], async (err, uids) => {
          if (err || !uids?.length) { imap.end(); return resolve(results); }

          console.log(`IMAP: Found ${uids.length} unseen emails for ${email}`);

          const fetch = imap.fetch(uids, { bodies: "", markSeen: false });
          const emails = [];

          fetch.on("message", (msg) => {
            let buffer = "";
            msg.on("body", (stream) => {
              stream.on("data", (chunk) => buffer += chunk.toString("utf8"));
            });
            msg.once("end", () => emails.push(buffer));
          });

          fetch.once("end", async () => {
            for (const rawEmail of emails) {
              try {
                const parsed = await simpleParser(rawEmail);
                const from = parsed.from?.text || "";
                const subject = parsed.subject || "";
                const attachments = parsed.attachments || [];

                // Check for PDF or ZIP attachments
                const pdfAttachments = attachments.filter(a =>
                  a.filename?.toLowerCase().endsWith(".pdf") ||
                  a.filename?.toLowerCase().endsWith(".zip")
                );

                if (!pdfAttachments.length) { results.skipped++; continue; }

                // Extract email body for PO number context
                const emailBody = parsed.text || parsed.html?.replace(/<[^>]*>/g, "") || "";

                for (const attachment of pdfAttachments) {
                  const isZip = attachment.filename?.toLowerCase().endsWith(".zip");

                  if (isZip) {
                    // Process ZIP via existing batch processor
                    const { processZipBuffer } = require("./batchProcessor");
                    const zipResult = await processZipBuffer({
                      zipBuffer: attachment.content,
                      teamId, userId, source: "imap_email"
                    });
                    results.processed += zipResult.processed || 0;
                    results.skipped += zipResult.skipped || 0;
                    results.failed += zipResult.failed || 0;
                    results.emails.push({ from, subject, filename: attachment.filename, status: "zip_processed", ...zipResult });
                  } else {
                    // Process PDF
                    const base64Data = attachment.content.toString("base64");
                    const result = await processImapPDF({ base64Data, from, subject, emailBody, teamId, userId, filename: attachment.filename });
                    if (result.success) {
                      results.processed++;
                      results.emails.push({ from, subject, filename: attachment.filename, status: "processed", erpRef: result.erpRef });
                    } else {
                      results.failed++;
                      results.emails.push({ from, subject, filename: attachment.filename, status: "failed", reason: result.error });
                    }
                  }
                }
              } catch (e) {
                console.error("IMAP email parse error:", e.message);
                results.failed++;
              }
            }
            imap.end();
            resolve(results);
          });

          fetch.once("error", (err) => { console.error("IMAP fetch error:", err); imap.end(); resolve(results); });
        });
      });
    });

    imap.once("error", (err) => {
      console.error("IMAP connection error:", err.message);
      resolve({ ...results, error: err.message });
    });

    imap.once("end", () => console.log("IMAP connection closed"));
    imap.connect();
  });
}

async function processImapPDF({ base64Data, from, subject, emailBody, teamId, userId, filename }) {
  const Anthropic = require("@anthropic-ai/sdk");
  const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    // Claude pre-check
    const preCheck = await claude.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 100,
      messages: [{ role: "user", content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64Data } },
        { type: "text", text: `Is this PDF an invoice, bill, or payment request? Reply ONLY "YES" or "NO".` }
      ]}]
    });

    if (!preCheck.content[0]?.text?.trim().toUpperCase().startsWith("YES")) {
      return { success: false, error: "Not an invoice" };
    }

    // Extract invoice data
    const response = await claude.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 1500,
      messages: [{ role: "user", content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64Data } },
        { type: "text", text: `Extract invoice data from this PDF. Email subject: "${subject}", From: "${from}"
Email body: "${emailBody?.slice(0, 500)}"

The invoice may be in ANY language. Extract all fields and return in English JSON.

IMPORTANT: For each line item set lineType: ITEM/FREIGHT/MISCELLANEOUS/TAX/DISCOUNT
If freight appears only in summary, include as separate lineItem with lineType "FREIGHT".

Return ONLY valid JSON:
{
  "invoiceNumber": "string",
  "invoiceDate": "YYYY-MM-DD",
  "dueDate": "YYYY-MM-DD or null",
  "vendor": { "name": "string", "email": "string or null" },
  "total": number,
  "subtotal": number or null,
  "tax": number or null,
  "currency": "ISO 4217 code",
  "lineItems": [{ "description": "string", "quantity": number, "unitPrice": number, "amount": number, "lineType": "ITEM|FREIGHT|MISCELLANEOUS|TAX|DISCOUNT" }],
  "poNumber": "string or null",
  "hasFreight": boolean,
  "freightAmount": number or null
}` }
      ]}]
    });

    const text = response.content[0]?.text || "";
    const start = text.indexOf("{");
    const extracted = start !== -1 ? JSON.parse(text.slice(start, text.lastIndexOf("}") + 1)) : null;
    if (!extracted) return { success: false, error: "Extraction failed" };

    // Save to Supabase
    const erpRef = `IMAP-${Date.now()}`;
    const { error } = await supabase.from("invoices").insert({
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
      raw_data: { ...extracted, source: "imap", from, subject },
      agent_decision: "imap_auto",
      agent_reason: `Auto-processed from IMAP email (${filename})`,
    });

    if (error) return { success: false, error: error.message };
    return { success: true, erpRef };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ── SAVE IMAP CONFIG ─────────────────────────────────────────────
async function saveImapConfig({ teamId, host, port, email, password, enabled }) {
  const { data, error } = await supabase.from("email_agent_config").upsert({
    team_id: teamId,
    provider: "imap",
    email,
    enabled,
    imap_host: host,
    imap_port: port || 993,
    imap_password: password, // In production: encrypt this
    updated_at: new Date().toISOString(),
  }, { onConflict: "team_id" }).select().single();
  if (error) throw error;
  return data;
}

// ── TEST IMAP CONNECTION ─────────────────────────────────────────
async function testImapConnection({ host, port, email, password }) {
  const Imap = require("imap");
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: email, password, host,
      port: port || 993, tls: true,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 10000, authTimeout: 8000,
    });
    imap.once("ready", () => { imap.end(); resolve({ success: true }); });
    imap.once("error", (err) => resolve({ success: false, error: err.message }));
    imap.connect();
  });
}

module.exports = {
  checkGmailForInvoices, saveEmailAgentConfig, getEmailAgentConfig,
  checkImapForInvoices, saveImapConfig, testImapConnection
};
