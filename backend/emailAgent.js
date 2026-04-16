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

async function checkGmailForInvoices({ accessToken, refreshToken, teamId, userId, lastChecked }) {
  try {
    const gmail = await createGmailClient(accessToken, refreshToken);
    const after = lastChecked ? Math.floor(new Date(lastChecked).getTime() / 1000) : Math.floor(Date.now() / 1000) - 3600;

    // Search for emails with PDF attachments - broad search, Claude pre-check handles filtering
    const query = `has:attachment filename:pdf after:${after}`;

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

        if (!hasInvoiceKeyword) {
          console.log(`Skipping email - no invoice keyword in subject: "${subject}"`);
          continue;
        }

        const result = await processGmailMessage({ gmail, messageId: msg.id, teamId, userId });
        if (result) results.push(result);
      } catch (e) {
        console.error(`Error processing email ${msg.id}:`, e.message);
      }
    }

    return { processed: results.flat().filter(r => !r?.skipped).length, emails: results.flat().filter(Boolean) };
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

  // Find PDF attachments
  const attachments = [];
  const findParts = (parts) => {
    if (!parts) return;
    for (const part of parts) {
      if (part.mimeType === "application/pdf" || part.filename?.endsWith(".pdf")) {
        attachments.push(part);
      }
      if (part.parts) findParts(part.parts);
    }
  };
  findParts(msg.payload.parts || [msg.payload]);

  if (!attachments.length) return null;

  // Check if already processed by gmail_message_id
  const { data: existingLogs } = await supabase
    .from("email_agent_log")
    .select("id")
    .eq("gmail_message_id", messageId)
    .not("erp_reference", "like", "DUPLICATE%");

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
      const extracted = await extractInvoiceFromBase64(base64Data, subject, from);
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
      const { data: savedInvoice, error: insertError } = await supabase.from("invoices").insert({
        user_id: userId,
        team_id: teamId,
        invoice_number: extracted.invoiceNumber,
        vendor_name: extracted.vendor?.name,
        invoice_date: extracted.invoiceDate,
        total: extracted.total,
        status: "pushed",
        match_status: "unmatched",
        erp_reference: erpRef,
        raw_data: extracted,
        agent_decision: "email_auto_processed",
        agent_reason: `Auto-processed from email: "${subject}" from ${from}`,
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

  return results.length ? results : null;
}

async function extractInvoiceFromBase64(base64Data, subject, from) {
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
            text: `Extract invoice data from this PDF. Email subject: "${subject}", From: "${from}".
Return ONLY valid JSON with these fields:
{
  "invoiceNumber": "string",
  "invoiceDate": "YYYY-MM-DD",
  "dueDate": "YYYY-MM-DD or null",
  "vendor": { "name": "string", "email": "string or null" },
  "total": number,
  "currency": "USD/EUR/GBP/INR",
  "lineItems": []
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
