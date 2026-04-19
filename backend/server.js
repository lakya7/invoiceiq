const express = require("express");
const cors = require("cors");
const multer = require("multer");
const Anthropic = require("@anthropic-ai/sdk");
const { Resend } = require("resend");
const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");
const fs = require("fs");
const nodemailer = require("nodemailer");
const { runApprovalAgent, sendAgentDecisionEmail } = require("./approvalAgent");
const { runAnomalyAgent, sendAnomalyEmail } = require("./anomalyAgent");
const { notifySupplier, scanAndNotifySuppliers } = require("./supplierAgent");
const { runErpSync, startErpSyncScheduler } = require("./erpSyncAgent");
const { notify, EVENTS, getNotificationSettings, saveNotificationSettings, testWebhook: testNotifWebhook } = require("./notificationAgent");

const app = express();
const upload = multer({ dest: "uploads/" });

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// ── AUDIT LOG HELPER ─────────────────────────────────────────────
async function logAudit({ invoiceId, teamId, userId, userEmail, action, detail, actor = "system" }) {
  try {
    await supabase.from("invoice_audit_log").insert({
      invoice_id: invoiceId,
      team_id: teamId,
      user_id: userId || null,
      user_email: userEmail || null,
      action,
      detail: detail || null,
      actor,
      created_at: new Date().toISOString(),
    });
  } catch (e) { console.error("Audit log error:", e.message); }
}



// Gmail SMTP transporter
const gmailTransport = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

// Smart email sender — tries Gmail first, falls back to Resend
async function sendEmail({ to, subject, html }) {
  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    await gmailTransport.sendMail({
      from: `APFlow <${process.env.GMAIL_USER}>`,
      to, subject, html,
    });
  } else if (resend) {
    await resend.emails.send({ from: "APFlow <notifications@apflow.app>", to, subject, html });
  } else {
    console.log("No email provider configured");
  }
}

app.use(cors({ origin: process.env.FRONTEND_URL || "*", methods: ["GET","POST","PUT","DELETE"] }));
app.use(express.json());
app.get("/health", (req, res) => res.json({ status: "ok" }));

// ── DUPLICATE CHECK ─────────────────────────────────────────────
app.post("/api/check-duplicate", async (req, res) => {
  try {
    const { invoiceNumber, vendorName, total, teamId, userId } = req.body;
    let query = supabase.from("invoices").select("*").eq("user_id", userId);
    if (teamId) query = query.eq("team_id", teamId);
    if (invoiceNumber) query = query.eq("invoice_number", invoiceNumber);

    const { data: existing } = await query;
    if (existing && existing.length > 0) {
      const dup = existing[0];

      // Send duplicate notification email if enabled
      try {
        const { data: settings } = await supabase.from("user_settings").select("*").eq("user_id", userId).single();
        const userEmail = await getUserEmail(userId);
        if (settings?.notify_on_duplicate && userEmail) {
          await sendEmail({
            to: settings.notify_email || userEmail,
            subject: `⚠️ Duplicate Invoice Detected — #${invoiceNumber}`,
            html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
              <div style="background:#0a0f1e;padding:24px 32px;">
                <div style="font-size:20px;font-weight:800;color:#fff;">AP<span style="color:#e8531a;">Flow</span></div>
              </div>
              <div style="padding:32px;">
                <div style="font-size:36px;margin-bottom:12px;">⚠️</div>
                <h2 style="font-size:20px;margin:0 0 12px;color:#0a0f1e;">Duplicate Invoice Detected</h2>
                <p style="font-size:14px;color:#7a7a6e;line-height:1.6;margin:0 0 20px;">
                  Invoice <strong>#${invoiceNumber}</strong> from <strong>${vendorName || "Unknown Vendor"}</strong> 
                  was already processed on <strong>${new Date(dup.created_at).toLocaleDateString()}</strong>.
                </p>
                <table style="width:100%;border-collapse:collapse;font-size:14px;">
                  <tr style="border-bottom:1px solid #f0ede8;">
                    <td style="padding:10px 0;color:#7a7a6e;">Original ERP Ref</td>
                    <td style="padding:10px 0;font-weight:600;text-align:right;">${dup.erp_reference || "N/A"}</td>
                  </tr>
                  <tr style="border-bottom:1px solid #f0ede8;">
                    <td style="padding:10px 0;color:#7a7a6e;">Original Amount</td>
                    <td style="padding:10px 0;font-weight:600;text-align:right;">$${Number(dup.total||0).toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td style="padding:10px 0;color:#7a7a6e;">Processed On</td>
                    <td style="padding:10px 0;font-weight:600;text-align:right;">${new Date(dup.created_at).toLocaleDateString()}</td>
                  </tr>
                </table>
                <div style="margin-top:20px;padding:14px;background:#fff7f4;border-radius:8px;font-size:13px;color:#92400e;">
                  ⚡ A user attempted to process this invoice again. Please verify before approving.
                </div>
                <div style="text-align:center;margin-top:24px;">
                  <a href="${process.env.FRONTEND_URL}" style="display:inline-block;background:#e8531a;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px;">View Dashboard →</a>
                </div>
              </div>
            </div>`
          });
        }
      } catch (e) { console.error("Duplicate email error:", e.message); }

      return res.json({
        isDuplicate: true,
        existing: {
          invoiceNumber: dup.invoice_number,
          vendorName: dup.vendor_name,
          total: dup.total,
          erpReference: dup.erp_reference,
          processedAt: dup.created_at,
        }
      });
    }

    res.json({ isDuplicate: false });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── HELPERS ─────────────────────────────────────────────────────
function readFile(path) { return fs.readFileSync(path); }
function cleanJSON(text) {
  const c = text.replace(/```json\s*/gi,"").replace(/```\s*/g,"").trim();
  try { return JSON.parse(c); } catch {}
  const m = c.match(/\{[\s\S]*\}/); if (m) { try { return JSON.parse(m[0]); } catch {} }
  const a = c.match(/\[[\s\S]*\]/); if (a) { try { return JSON.parse(a[0]); } catch {} }
  return null;
}
async function getUserEmail(userId) {
  const { data } = await supabase.auth.admin.getUserById(userId);
  return data?.user?.email;
}

// ── EXTRACT INVOICE ─────────────────────────────────────────────
app.post("/api/extract", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const b64 = readFile(req.file.path).toString("base64");
    const mt = req.file.mimetype;
    const isPDF = mt === "application/pdf";
    const isImage = ["image/jpeg","image/png","image/webp","image/gif"].includes(mt);
    const finalMt = isImage ? mt : isPDF ? "application/pdf" : "image/jpeg";
    fs.unlinkSync(req.file.path);

    const fileContent = isPDF
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
      : { type: "image", source: { type: "base64", media_type: finalMt, data: b64 } };

    const r = await claude.messages.create({
      model: "claude-opus-4-6", max_tokens: 1500,
      messages: [{ role: "user", content: [
        fileContent,
        { type: "text", text: `The invoice may be in ANY language (French, German, Spanish, Japanese, Chinese, Arabic, Hindi, etc.). Extract all fields and return them in English JSON regardless of the invoice language. Use ISO 4217 currency codes (USD, EUR, GBP, JPY, CNY, AED, SAR, BRL, INR, MXN, CAD, AUD, SGD, CHF, etc.).

Extract all data from this invoice/PO document. Return ONLY valid JSON:
{"invoiceNumber":"","invoiceDate":"YYYY-MM-DD","dueDate":"YYYY-MM-DD","vendor":{"name":"","address":"","email":"","phone":""},"billTo":{"name":"","address":""},"lineItems":[{"description":"","quantity":0,"unitPrice":0,"amount":0}],"subtotal":0,"tax":0,"total":0,"currency":"USD","poNumber":"","paymentTerms":"","notes":"","confidence":0.95}` }
      ]}]
    });
    const extracted = cleanJSON(r.content.find(b=>b.type==="text")?.text || "{}");
    res.json({ success: true, data: extracted || {} });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// ── PO MATCHING ─────────────────────────────────────────────────
app.post("/api/match-po", async (req, res) => {
  try {
    const { invoiceData, teamId } = req.body;

    // Fetch open POs for this team
    const { data: pos, error } = await supabase
      .from("purchase_orders")
      .select("*")
      .eq("team_id", teamId)
      .in("status", ["open","partially_matched"]);

    if (error) throw error;
    if (!pos || pos.length === 0) {
      return res.json({ success: true, match: { status: "no_po", message: "No open POs found for this team.", poId: null, details: [] } });
    }

    // Use Claude to match invoice against POs
    const prompt = `You are an AP matching expert. Match this invoice against the list of open purchase orders and identify the best match.

INVOICE:
- Invoice Number: ${invoiceData.invoiceNumber || "N/A"}
- Vendor: ${invoiceData.vendor?.name || "N/A"}
- PO Number on Invoice: ${invoiceData.poNumber || "none"}
- Total: ${invoiceData.total} ${invoiceData.currency || "USD"}
- Line Items: ${JSON.stringify(invoiceData.lineItems || [])}
- Date: ${invoiceData.invoiceDate}

OPEN PURCHASE ORDERS:
${pos.map((po,i) => `PO ${i+1}: ID=${po.id}, PO#=${po.po_number}, Vendor=${po.vendor_name}, Total=${po.total_amount}, Status=${po.status}, Lines=${JSON.stringify(po.line_items||[])}`).join("\n")}

Analyze and return ONLY valid JSON (no markdown):
{
  "matchedPoId": "uuid or null",
  "matchStatus": "matched|partial|mismatch|unmatched",
  "confidenceScore": 0.0-1.0,
  "summary": "One sentence summary of the match result",
  "variances": [
    { "field": "field name", "invoiceValue": "val", "poValue": "val", "severity": "low|medium|high" }
  ],
  "recommendation": "approve|review|reject",
  "reasoning": "2-3 sentences explaining the decision"
}`;

    const matchRes = await claude.messages.create({
      model: "claude-opus-4-6", max_tokens: 800,
      messages: [{ role: "user", content: prompt }]
    });

    const matchResult = cleanJSON(matchRes.content.find(b=>b.type==="text")?.text || "{}");
    res.json({ success: true, match: matchResult, posChecked: pos.length });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// ── PURCHASE ORDERS CRUD ────────────────────────────────────────
app.get("/api/pos/:teamId", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("purchase_orders")
      .select("*")
      .eq("team_id", req.params.teamId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ success: true, pos: data || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/pos", upload.single("file"), async (req, res) => {
  try {
    const { teamId, userId } = req.body;

    let poData = {};
    if (req.file) {
      const b64 = readFile(req.file.path).toString("base64");
      let mt = req.file.mimetype;
      if (!["image/jpeg","image/png","image/webp","image/gif"].includes(mt)) mt = "image/jpeg";
      fs.unlinkSync(req.file.path);

      const r = await claude.messages.create({
        model: "claude-opus-4-6", max_tokens: 1200,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: mt, data: b64 } },
          { type: "text", text: `Extract purchase order data. Return ONLY valid JSON:
{"poNumber":"","issueDate":"YYYY-MM-DD","expectedDelivery":"YYYY-MM-DD","vendor":{"name":"","email":"","phone":""},"lineItems":[{"description":"","quantity":0,"unitPrice":0,"amount":0}],"totalAmount":0,"currency":"USD","notes":""}` }
        ]}]
      });
      poData = cleanJSON(r.content.find(b=>b.type==="text")?.text || "{}") || {};
    } else {
      poData = JSON.parse(req.body.poData || "{}");
    }

    const { data, error } = await supabase.from("purchase_orders").insert({
      team_id: teamId,
      created_by: userId,
      po_number: poData.poNumber || `PO-${Date.now()}`,
      vendor_name: poData.vendor?.name || poData.vendorName,
      vendor_email: poData.vendor?.email,
      issue_date: poData.issueDate,
      expected_delivery: poData.expectedDelivery,
      total_amount: poData.totalAmount || 0,
      currency: poData.currency || "USD",
      line_items: poData.lineItems || [],
      notes: poData.notes,
      raw_data: poData,
    }).select().single();

    if (error) throw error;
    res.json({ success: true, po: data });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// ── PUSH TO ERP ─────────────────────────────────────────────────
app.post("/api/push-erp", async (req, res) => {
  try {
    const { invoiceData, userId, teamId, matchResult } = req.body;
    await new Promise(r => setTimeout(r, 1000));
    const erpReference = `ERP-${Date.now()}`;
    const timestamp = new Date().toISOString();

    // Check if real ERP is connected for this team
    let erpType = "mock";
    let validationStatus = "mock";
    let validationMessage = "Invoice saved to InvoiceIQ. No real ERP connected.";

    if (teamId) {
      const { data: connections } = await supabase
        .from("erp_connections")
        .select("erp_type, status")
        .eq("team_id", teamId)
        .eq("status", "connected");

      if (connections && connections.length > 0) {
        erpType = connections[0].erp_type;
        validationStatus = "needs_validation";
        validationMessage = erpType === "oracle"
          ? "Invoice submitted to Oracle Fusion Payables. Go to Payables → Invoices → Validate to complete."
          : "Invoice submitted to ERP. Awaiting validation.";
      }
    }

    // ── RUN ANOMALY DETECTION AGENT ────────────────────────────
    let anomalyResult = null;
    if (teamId) {
      try {
        anomalyResult = await runAnomalyAgent({ invoiceData, teamId, userId });

        // Send anomaly email if flags found
        if (anomalyResult.totalFlags > 0) {
          const adminEmail = await getUserEmail(userId);
          if (adminEmail) {
            await sendAnomalyEmail({ anomalyResult, invoiceData, adminEmail, sendEmail });
          }
        }
      } catch (e) { console.error("Anomaly Agent error:", e.message); }
    }

    // ── VENDOR MASTER MATCHING ──────────────────────────────────
    // First check saved vendor mappings (from previous Slack selections)
    // Then match against Oracle vendor master
    if (teamId) {
      try {
        const { data: mapping } = await supabase.from("vendor_mappings")
          .select("oracle_supplier_name, oracle_supplier_id")
          .eq("team_id", teamId)
          .ilike("invoice_vendor_name", `%${invoiceData.vendor?.name?.split(" ")[0] || ""}%`)
          .limit(1)
          .single();
        if (mapping) {
          console.log(`Vendor match from saved mapping: "${mapping.oracle_supplier_name}"`);
          invoiceData.vendor = { ...invoiceData.vendor, name: mapping.oracle_supplier_name, oracleSupplierId: mapping.oracle_supplier_id };
        }
      } catch (e) { /* no saved mapping found */ }
    }
    // Match ambiguous vendor names against Oracle vendor master
    // Sends Slack disambiguation if multiple matches found
    if (teamId && erpType === "oracle") {
      try {
        const { data: conn } = await supabase.from("erp_connections").select("*").eq("team_id", teamId).eq("erp_type", "oracle").single();
        if (conn) {
          const credentials = Buffer.from(`${conn.username}:${conn.password}`).toString("base64");
          const notifySettings = await supabase.from("notification_settings").select("slack_webhook_url,enabled").eq("team_id", teamId).single();
          const vendorMatch = await matchVendor({
            invoiceData,
            teamId,
            credentials,
            baseUrl: conn.base_url,
            senderEmail: invoiceData.senderEmail || null,
            notifySlack: notifySettings.data?.enabled && notifySettings.data?.slack_webhook_url
              ? { webhookUrl: notifySettings.data.slack_webhook_url }
              : null,
          });
          if (vendorMatch.matched) {
            console.log(`Vendor matched: "${vendorMatch.vendor}" via ${vendorMatch.method} (${vendorMatch.confidence}%)`);
            invoiceData.vendor = { ...invoiceData.vendor, name: vendorMatch.vendor, oracleSupplierId: vendorMatch.supplierId };
            invoiceData.vendorMatchMethod = vendorMatch.method;
            invoiceData.vendorMatchConfidence = vendorMatch.confidence;
          } else if (vendorMatch.needsDisambiguation) {
            console.log(`Vendor disambiguation needed — ${vendorMatch.candidates.length} candidates sent to Slack`);
          }
        }
      } catch (e) { console.error("Vendor matching error:", e.message); }
    }

    // ── RUN APPROVAL AGENT ──────────────────────────────────────
    let agentDecision = null;
    if (teamId) {
      try {
        agentDecision = await runApprovalAgent({ invoiceData, matchResult, teamId, userId, sendEmail });

        // ── QUICKBOOKS: Hold for Slack approval ─────────────────
        if (agentDecision?.decision === "pending_approval") {
          // Save invoice as pending
          const { data: pendingInv } = await supabase.from("invoices").insert({
            user_id: userId,
            team_id: teamId,
            invoice_number: invoiceData.invoiceNumber,
            vendor_name: invoiceData.vendor?.name,
            invoice_date: invoiceData.invoiceDate,
            due_date: invoiceData.dueDate,
            total: invoiceData.total,
            currency: invoiceData.currency || "USD",
            status: "pending",
            match_status: matchResult?.matchStatus || "unmatched",
            erp_reference: null,
            raw_data: invoiceData,
            agent_decision: "pending_approval",
            agent_reason: agentDecision.reason,
            agent_rule: agentDecision.rule,
          }).select().single();

          // Send Slack with Approve/Reject buttons
          if (pendingInv) {
            try {
              await notify({ teamId, event: EVENTS.INVOICE_NEEDS_APPROVAL || "invoice_needs_approval", invoice: pendingInv });
            } catch (e) { console.error("Slack approval notify error:", e.message); }
          }

          return res.json({
            success: true,
            status: "pending_approval",
            erpType: agentDecision.erpType || "quickbooks",
            message: "Invoice saved as pending — Slack notification sent for approval",
            agentDecision,
          });
        }

        // Send agent decision email to admin
        const adminEmail = await getUserEmail(userId);
        if (adminEmail) {
          await sendAgentDecisionEmail({
            decision: agentDecision.decision,
            reason: agentDecision.reason,
            rule: agentDecision.rule,
            invoiceData,
            erpReference,
            adminEmail,
            sendEmail
          });
        }

        // Save agent decision to invoice record
        await supabase.from("invoices").update({
          agent_decision: agentDecision.decision,
          agent_reason: agentDecision.reason,
          agent_rule: agentDecision.rule,
        }).eq("erp_reference", erpReference);

      } catch (e) { console.error("Agent error:", e.message); }
    }

    // Update PO status if matched
    if (matchResult?.matchedPoId && matchResult.matchStatus === "matched") {
      await supabase.from("purchase_orders").update({ status: "fully_matched" }).eq("id", matchResult.matchedPoId);
    } else if (matchResult?.matchedPoId && matchResult.matchStatus === "partial") {
      await supabase.from("purchase_orders").update({ status: "partially_matched" }).eq("id", matchResult.matchedPoId);
    }

    // Send approval email
    if (userId) {
      try {
        const { data: settings } = await supabase.from("user_settings").select("*").eq("user_id", userId).single();
        const userEmail = await getUserEmail(userId);
        if (settings?.notify_on_approval && userEmail) {
          await sendApprovalEmail({ to: userEmail, notifyEmail: settings.notify_email || userEmail, invoiceData, erpReference, matchResult });
        }
      } catch (e) { console.error("Email error:", e.message); }
    }

    // ── SAVE INVOICE TO SUPABASE ────────────────────────────────
    let savedInv = null;
    if (teamId) {
      try {
        const { data } = await supabase.from("invoices").insert({
          user_id: userId,
          team_id: teamId,
          invoice_number: invoiceData.invoiceNumber,
          vendor_name: invoiceData.vendor?.name,
          invoice_date: invoiceData.invoiceDate,
          due_date: invoiceData.dueDate,
          total: invoiceData.total,
          currency: invoiceData.currency || "USD",
          status: "pushed",
          match_status: matchResult?.matchStatus || "unmatched",
          erp_reference: erpReference,
          raw_data: invoiceData,
          agent_decision: agentDecision?.decision,
          agent_reason: agentDecision?.reason,
          agent_rule: agentDecision?.rule,
        }).select().single();
        savedInv = data;
      } catch (e) { console.error("Invoice save error:", e.message); }
    }

    // ── NOTIFY BUYER via Teams/Slack ────────────────────────────
    if (teamId && savedInv) {
      try {
        // Only send ONE notification — prioritise anomaly flag over processed
        if (anomalyResult?.totalFlags > 0) {
          // Invoice has real anomalies — show flagged notification with Approve/Reject
          await notify({ teamId, event: EVENTS.INVOICE_FLAGGED, invoice: { ...savedInv, flag_reason: anomalyResult.flags?.[0]?.description, agent_reason: anomalyResult.flags?.[0]?.description } });
          console.log(`Slack/Teams FLAGGED notification sent for invoice #${savedInv.invoice_number}`);
        } else {
          // Invoice processed cleanly — show processed notification (no approve/reject buttons)
          await notify({ teamId, event: EVENTS.INVOICE_PROCESSED, invoice: savedInv });
          console.log(`Slack/Teams PROCESSED notification sent for invoice #${savedInv.invoice_number}`);
          // Also send PO matched notification if applicable
          if (matchResult?.matchStatus === "matched") {
            await notify({ teamId, event: EVENTS.INVOICE_PO_MATCHED, invoice: savedInv });
          }
        }
      } catch (e) { console.error("Notification error:", e.message); }
    }

    res.json({ success: true, erpReference, erpType, validationStatus, validationMessage, timestamp, agentDecision, anomalyResult });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── TEAMS ────────────────────────────────────────────────────────
// Create team
app.post("/api/teams", async (req, res) => {
  try {
    const { name, userId } = req.body;
    const slug = name.toLowerCase().replace(/[^a-z0-9]/g,"-").replace(/-+/g,"-") + "-" + Date.now().toString(36);

    const { data: team, error: teamErr } = await supabase.from("teams").insert({ name, slug, owner_id: userId }).select().single();
    if (teamErr) throw teamErr;

    // Add owner as admin member
    const userEmail = await getUserEmail(userId);
    await supabase.from("team_members").insert({ team_id: team.id, user_id: userId, email: userEmail, role: "admin", status: "active", joined_at: new Date().toISOString() });

    res.json({ success: true, team });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get user's teams
app.get("/api/teams/user/:userId", async (req, res) => {
  try {
    const userEmail = await getUserEmail(req.params.userId);

    // Search by user_id OR email (handles both invite flows)
    let { data: memberships } = await supabase.from("team_members")
      .select("team_id, role, status, email")
      .eq("user_id", req.params.userId)
      .eq("status", "active");

    // If no results by user_id, try by email
    if (!memberships?.length && userEmail) {
      const { data: emailMemberships } = await supabase.from("team_members")
        .select("team_id, role, status, email")
        .eq("email", userEmail)
        .eq("status", "active");

      if (emailMemberships?.length) {
        // Update the records to include user_id for future lookups
        await supabase.from("team_members")
          .update({ user_id: req.params.userId })
          .eq("email", userEmail)
          .eq("status", "active");
        memberships = emailMemberships;
      }
    }

    if (!memberships?.length) return res.json({ success: true, teams: [] });
    const teamIds = memberships.map(m => m.team_id);
    const { data: teams } = await supabase.from("teams").select("*").in("id", teamIds);
    const enriched = (teams || []).map(t => ({ ...t, role: memberships.find(m => m.team_id === t.id)?.role }));
    res.json({ success: true, teams: enriched });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get team members
app.get("/api/teams/:teamId/members", async (req, res) => {
  try {
    const { data, error } = await supabase.from("team_members").select("*").eq("team_id", req.params.teamId).order("joined_at");
    if (error) throw error;
    res.json({ success: true, members: data || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Invite member
app.post("/api/teams/:teamId/invite", async (req, res) => {
  try {
    const { email, role, invitedBy } = req.body;
    const { teamId } = req.params;
    const token = crypto.randomBytes(32).toString("hex");

    // Check if already a member
    const { data: existing } = await supabase.from("team_members").select("id").eq("team_id", teamId).eq("email", email).single();
    if (existing) return res.status(400).json({ error: "User is already a team member" });

    // Get team info
    const { data: team } = await supabase.from("teams").select("name").eq("id", teamId).single();
    const inviterEmail = await getUserEmail(invitedBy);

    // Create invite record
    await supabase.from("team_invites").insert({ team_id: teamId, email, role, token, invited_by: invitedBy });

    // Add as pending member
    await supabase.from("team_members").insert({ team_id: teamId, email, role, status: "pending", invited_by: invitedBy });

    // Send invite email
    const inviteUrl = `${process.env.FRONTEND_URL || "http://localhost:3000"}/login?invite=${token}`;
    await sendEmail({
      to: email,
      subject: `${inviterEmail} invited you to join ${team?.name || "a team"} on APFlow`,
      html: `
<div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:520px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <div style="background:#0a0f1e;padding:24px 32px;">
    <div style="font-size:20px;font-weight:800;color:#fff;">AP<span style="color:#e8531a;">Flow</span></div>
  </div>
  <div style="padding:32px;">
    <h2 style="font-size:20px;margin:0 0 12px;color:#0a0f1e;">You've been invited! 🎉</h2>
    <p style="font-size:15px;color:#7a7a6e;line-height:1.6;margin:0 0 24px;">
      <strong style="color:#0a0f1e;">${inviterEmail}</strong> has invited you to join <strong style="color:#0a0f1e;">${team?.name || "their team"}</strong> on APFlow as a <strong style="color:#e8531a;">${role}</strong>.
    </p>
    <a href="${inviteUrl}" style="display:inline-block;background:#e8531a;color:#fff;text-decoration:none;padding:13px 28px;border-radius:8px;font-weight:600;font-size:15px;">Accept Invitation →</a>
    <p style="font-size:12px;color:#aaa;margin-top:20px;">This invitation expires in 7 days. If you don't have an APFlow account, you'll be asked to create one.</p>
  </div>
</div>`
    });

    res.json({ success: true, message: `Invitation sent to ${email}` });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// Accept invite
app.post("/api/invite/accept", async (req, res) => {
  try {
    const { token, userId } = req.body;
    const { data: invite, error } = await supabase.from("team_invites").select("*").eq("token", token).single();
    if (error || !invite) return res.status(404).json({ error: "Invite not found or expired" });
    if (invite.accepted_at) return res.status(400).json({ error: "Invite already used" });
    if (new Date(invite.expires_at) < new Date()) return res.status(400).json({ error: "Invite has expired" });

    const userEmail = await getUserEmail(userId);
    await supabase.from("team_members").update({ user_id: userId, status: "active", joined_at: new Date().toISOString() }).eq("team_id", invite.team_id).eq("email", invite.email);
    await supabase.from("team_invites").update({ accepted_at: new Date().toISOString() }).eq("token", token);
    res.json({ success: true, teamId: invite.team_id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Update member role
app.put("/api/teams/:teamId/members/:memberId", async (req, res) => {
  try {
    const { role } = req.body;
    const { data, error } = await supabase.from("team_members").update({ role }).eq("id", req.params.memberId).eq("team_id", req.params.teamId).select().single();
    if (error) throw error;
    res.json({ success: true, member: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Remove member
app.delete("/api/teams/:teamId/members/:memberId", async (req, res) => {
  try {
    const { error } = await supabase.from("team_members").delete().eq("id", req.params.memberId).eq("team_id", req.params.teamId);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── SETTINGS ────────────────────────────────────────────────────
app.get("/api/settings/:userId", async (req, res) => {
  try {
    const { data, error } = await supabase.from("user_settings").select("*").eq("user_id", req.params.userId).single();
    if (error && error.code !== "PGRST116") throw error;
    res.json({ success: true, settings: data || { user_id: req.params.userId, notify_on_approval: true, notify_on_rejection: false, notify_on_duplicate: true, notify_email: "", erp_system: "mock", company_name: "", default_currency: "USD", auto_approve_below: 0, require_po_match: true } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/settings", async (req, res) => {
  try {
    const { userId, settings } = req.body;
    const { data, error } = await supabase.from("user_settings").upsert({ user_id: userId, ...settings, updated_at: new Date().toISOString() }, { onConflict: "user_id" }).select().single();
    if (error) throw error;
    res.json({ success: true, settings: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/settings/test-email", async (req, res) => {
  try {
    const { email } = req.body;
    await resend.emails.send({
      from: "APFlow <notifications@apflow.app>", to: email,
      subject: "✅ InvoiceIQ Test Notification",
      html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:40px auto;padding:32px;background:#fff;border-radius:12px;border:1px solid #e2ddd4;"><div style="font-size:20px;font-weight:800;margin-bottom:16px;">Invoice<span style="color:#e8531a;">IQ</span></div><h2 style="font-size:18px;margin-bottom:8px;">Test notification working! 🎉</h2><p style="color:#7a7a6e;font-size:14px;line-height:1.6;">Email notifications are configured correctly.</p></div>`
    });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── EMAIL TEMPLATES ─────────────────────────────────────────────
async function sendApprovalEmail({ to, notifyEmail, invoiceData, erpReference, matchResult }) {
  const recipients = [...new Set([to, notifyEmail].filter(Boolean))];
  const total = new Intl.NumberFormat("en-US", { style:"currency", currency: invoiceData.currency||"USD" }).format(invoiceData.total||0);
  const matchBadge = matchResult ? {
    matched: "✅ PO Matched",
    partial: "⚠️ Partial Match",
    mismatch: "🔴 PO Mismatch",
    unmatched: "➖ No PO Match",
    no_po: "➖ No POs on File",
  }[matchResult.matchStatus] || "" : "";

  await resend.emails.send({
    from: "APFlow <notifications@apflow.app>", to: recipients,
    subject: `✅ Invoice ${invoiceData.invoiceNumber||"N/A"} Approved — ${total}`,
    html: `<div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <div style="background:#0a0f1e;padding:24px 32px;"><div style="font-size:20px;font-weight:800;color:#fff;">Invoice<span style="color:#e8531a;">IQ</span></div></div>
  <div style="padding:32px 32px 16px;">
    <div style="font-size:40px;margin-bottom:12px;">✅</div>
    <h1 style="font-size:20px;font-weight:700;color:#0a0f1e;margin:0 0 8px;">Invoice Approved & Pushed to ERP</h1>
    <p style="font-size:14px;color:#7a7a6e;margin:0;">Invoice <strong>${invoiceData.invoiceNumber||"N/A"}</strong> · ${invoiceData.vendor?.name||"Unknown Vendor"}</p>
  </div>
  <table style="width:100%;border-collapse:collapse;font-size:14px;padding:0 32px;display:block;">
    ${[["Total",total],["PO Match",matchBadge||"—"],["ERP Ref",erpReference],["Due",invoiceData.dueDate||"—"]].map(([l,v])=>`<tr><td style="padding:10px 32px;color:#7a7a6e;border-bottom:1px solid #f0ede8;">${l}</td><td style="padding:10px 32px;font-weight:600;color:#0a0f1e;text-align:right;border-bottom:1px solid #f0ede8;">${v}</td></tr>`).join("")}
  </table>
  ${matchResult?.variances?.length ? `<div style="margin:16px 32px;padding:14px;background:#fff7f4;border-radius:8px;border:1px solid #fcd9cc;font-size:13px;color:#92400e;"><strong>Variances detected:</strong><br/>${matchResult.variances.map(v=>`• ${v.field}: Invoice ${v.invoiceValue} vs PO ${v.poValue}`).join("<br/>")}</div>` : ""}
  <div style="padding:24px 32px;text-align:center;"><a href="${process.env.FRONTEND_URL||"#"}" style="display:inline-block;background:#e8531a;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px;">View Dashboard →</a></div>
</div>`
  });
}

const PORT = process.env.PORT || 4000;
// ── INVOICE COMMENTS ─────────────────────────────────────────────
app.get("/api/invoices/:invoiceId/comments", async (req, res) => {
  try {
    const { data } = await supabase.from("invoice_comments")
      .select("*").eq("invoice_id", req.params.invoiceId)
      .order("created_at", { ascending: true });
    res.json({ success: true, comments: data || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/invoices/:invoiceId/comments", async (req, res) => {
  try {
    const { teamId, userId, userEmail, comment } = req.body;
    const { data } = await supabase.from("invoice_comments").insert({
      invoice_id: req.params.invoiceId,
      team_id: teamId,
      user_id: userId,
      user_email: userEmail,
      comment: comment.trim(),
      created_at: new Date().toISOString(),
    }).select().single();
    res.json({ success: true, comment: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});


// ── AUDIT LOG ROUTES ─────────────────────────────────────────────
app.get("/api/invoices/:invoiceId/audit", async (req, res) => {
  try {
    const { data } = await supabase.from("invoice_audit_log")
      .select("*").eq("invoice_id", req.params.invoiceId)
      .order("created_at", { ascending: false });
    res.json({ success: true, audit: data || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Log comment added to audit trail
app.post("/api/invoices/:invoiceId/audit/comment", async (req, res) => {
  try {
    const { teamId, userId, userEmail, comment } = req.body;
    await logAudit({ invoiceId: req.params.invoiceId, teamId, userId, userEmail, action: "comment_added", detail: `"${comment}"`, actor: userEmail || "AP Team" });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});


app.listen(PORT, () => {
  console.log(`InvoiceIQ backend on port ${PORT}`);
  // Start ERP Sync Agent scheduler
  startErpSyncScheduler().catch(e => console.error("ERP Sync scheduler failed to start:", e.message));
});

// ── BILLING ROUTES ──────────────────────────────────────────────
const billing = require("./billing");
const Stripe = require("stripe");
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

// Get subscription status
app.get("/api/billing/:teamId", async (req, res) => {
  try {
    const sub = await billing.getSubscription(req.params.teamId);
    const usage = await billing.checkUsageLimit(req.params.teamId);
    res.json({ success: true, subscription: sub, usage });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create Stripe Checkout session
app.post("/api/billing/checkout", async (req, res) => {
  try {
    const { teamId, plan, email, teamName } = req.body;
    const ORIGIN = process.env.FRONTEND_URL || "http://localhost:3000";
    const session = await billing.createCheckoutSession({
      teamId, plan, email, teamName,
      successUrl: `${ORIGIN}/?upgraded=true`,
      cancelUrl: `${ORIGIN}/?canceled=true`,
    });
    res.json({ success: true, url: session.url, sessionId: session.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Open Stripe Billing Portal (manage subscription)
app.post("/api/billing/portal", async (req, res) => {
  try {
    const { teamId } = req.body;
    const ORIGIN = process.env.FRONTEND_URL || "http://localhost:3000";
    const session = await billing.createPortalSession({ teamId, returnUrl: ORIGIN });
    res.json({ success: true, url: session.url });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Stripe webhook (raw body needed)
app.post("/api/billing/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      const result = await billing.handleWebhook(req.body, req.headers["stripe-signature"]);
      res.json(result);
    } catch (err) {
      console.error("Webhook error:", err.message);
      res.status(400).json({ error: err.message });
    }
  }
);

// Check usage before processing
app.get("/api/billing/check/:teamId", async (req, res) => {
  try {
    const usage = await billing.checkUsageLimit(req.params.teamId);
    res.json({ success: true, ...usage });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── ERP INTEGRATIONS ────────────────────────────────────────────
const qb = require("./quickbooks");
const oracle = require("./oracle");
const netsuite = require("./netsuite");
const { matchVendor, saveVendorSelection } = require("./vendorMatcher");
const xero = require("./xero");
const zoho = require("./zoho");
const dynamics = require("./dynamics");

// ── QUICKBOOKS ──────────────────────────────────────────────────
// Get QB auth URL
app.get("/api/erp/quickbooks/auth/:teamId", (req, res) => {
  try {
    const url = qb.getAuthUrl(req.params.teamId);
    res.json({ success: true, url });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// QB OAuth callback
app.get("/api/erp/quickbooks/callback", async (req, res) => {
  try {
    const { code, state: teamId, realmId } = req.query;
    await qb.exchangeCode(code, teamId, realmId);
    res.redirect(`${process.env.FRONTEND_URL}/?qb_connected=true`);
  } catch (err) {
    res.redirect(`${process.env.FRONTEND_URL}/?qb_error=${encodeURIComponent(err.message)}`);
  }
});

// QB connection status
app.get("/api/erp/quickbooks/status/:teamId", async (req, res) => {
  try {
    const status = await qb.getConnectionStatus(req.params.teamId);
    res.json({ success: true, ...status });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// QB disconnect
app.post("/api/erp/quickbooks/disconnect", async (req, res) => {
  try {
    await qb.disconnect(req.body.teamId);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── ORACLE FUSION ───────────────────────────────────────────────
// Save Oracle credentials
app.post("/api/erp/oracle/connect", async (req, res) => {
  try {
    const { teamId, baseUrl, username, password } = req.body;
    const result = await oracle.saveConnection(teamId, { baseUrl, username, password });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Oracle connection status
app.get("/api/erp/oracle/status/:teamId", async (req, res) => {
  try {
    const status = await oracle.getConnectionStatus(req.params.teamId);
    res.json({ success: true, ...status });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Oracle disconnect
app.post("/api/erp/oracle/disconnect", async (req, res) => {
  try {
    await oracle.disconnect(req.body.teamId);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Oracle pre-validation endpoint (validate without pushing)
app.post("/api/erp/oracle/validate", async (req, res) => {
  try {
    const { teamId, invoiceData } = req.body;
    const result = await oracle.validateOnly(teamId, invoiceData);
    res.json({ success: true, ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── SMART ERP PUSH (routes to right ERP) ───────────────────────
// ── NETSUITE ROUTES ────────────────────────────────────────────
app.post("/api/erp/netsuite/connect", async (req, res) => {
  try {
    const { teamId, accountId, consumerKey, consumerSecret, tokenId, tokenSecret } = req.body;
    const result = await netsuite.saveConnection(teamId, { accountId, consumerKey, consumerSecret, tokenId, tokenSecret });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/erp/netsuite/status/:teamId", async (req, res) => {
  try {
    const status = await netsuite.getConnectionStatus(req.params.teamId);
    res.json({ success: true, ...status });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/erp/netsuite/disconnect", async (req, res) => {
  try {
    await netsuite.disconnect(req.body.teamId);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/erp/netsuite/validate", async (req, res) => {
  try {
    const { teamId, invoiceData } = req.body;
    const result = await netsuite.validateOnly(teamId, invoiceData);
    res.json({ success: true, ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── XERO ROUTES ────────────────────────────────────────────────
app.get("/api/erp/xero/auth/:teamId", (req, res) => {
  try { res.json({ success: true, url: xero.getAuthUrl(req.params.teamId) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
app.get("/api/erp/xero/callback", async (req, res) => {
  try {
    const { code, state } = req.query;
    const result = await xero.handleCallback(code, state);
    res.redirect(`${process.env.FRONTEND_URL}/login?xero_connected=true`);
  } catch (err) { res.redirect(`${process.env.FRONTEND_URL}/login?xero_error=${encodeURIComponent(err.message)}`); }
});
app.get("/api/erp/xero/status/:teamId", async (req, res) => {
  try { res.json({ success: true, ...(await xero.getConnectionStatus(req.params.teamId)) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
app.post("/api/erp/xero/disconnect", async (req, res) => {
  try { await xero.disconnect(req.body.teamId); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── ZOHO ROUTES ─────────────────────────────────────────────────
app.get("/api/erp/zoho/auth/:teamId", (req, res) => {
  try { res.json({ success: true, url: zoho.getAuthUrl(req.params.teamId) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
app.get("/api/erp/zoho/callback", async (req, res) => {
  try {
    const { code, state } = req.query;
    await zoho.handleCallback(code, state);
    res.redirect(`${process.env.FRONTEND_URL}/login?zoho_connected=true`);
  } catch (err) { res.redirect(`${process.env.FRONTEND_URL}/login?zoho_error=${encodeURIComponent(err.message)}`); }
});
app.get("/api/erp/zoho/status/:teamId", async (req, res) => {
  try { res.json({ success: true, ...(await zoho.getConnectionStatus(req.params.teamId)) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
app.post("/api/erp/zoho/disconnect", async (req, res) => {
  try { await zoho.disconnect(req.body.teamId); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DYNAMICS 365 ROUTES ─────────────────────────────────────────
app.post("/api/erp/dynamics/connect", async (req, res) => {
  try {
    const { teamId, tenantId, clientId, clientSecret, resourceUrl, legalEntity } = req.body;
    const result = await dynamics.saveConnection(teamId, { tenantId, clientId, clientSecret, resourceUrl, legalEntity });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.get("/api/erp/dynamics/status/:teamId", async (req, res) => {
  try { res.json({ success: true, ...(await dynamics.getConnectionStatus(req.params.teamId)) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
app.post("/api/erp/dynamics/disconnect", async (req, res) => {
  try { await dynamics.disconnect(req.body.teamId); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/erp/push", async (req, res) => {
  try {
    const { invoiceData, teamId, erpType } = req.body;

    let result;
    if (erpType === "quickbooks") {
      result = await qb.pushInvoice(teamId, invoiceData);
    } else if (erpType === "oracle") {
      result = await oracle.pushInvoice(teamId, invoiceData);
    } else if (erpType === "netsuite") {
      result = await netsuite.pushInvoice(teamId, invoiceData);
    } else if (erpType === "xero") {
      result = await xero.pushInvoice(teamId, invoiceData);
    } else if (erpType === "zoho") {
      result = await zoho.pushInvoice(teamId, invoiceData);
    } else if (erpType === "dynamics") {
      result = await dynamics.pushInvoice(teamId, invoiceData);
    } else {
      // Mock ERP fallback
      await new Promise(r => setTimeout(r, 1000));
      result = {
        success: true,
        erpReference: `ERP-${Date.now()}`,
        erpType: "mock",
        details: { message: "Pushed to mock ERP (connect QuickBooks or Oracle for real sync)" }
      };
    }

    // Save to Supabase
    if (teamId) {
      const { data: savedInvoice } = await supabase.from("invoices").insert({
        user_id: req.body.userId,
        team_id: teamId,
        invoice_number: invoiceData.invoiceNumber,
        vendor_name: invoiceData.vendor?.name,
        invoice_date: invoiceData.invoiceDate,
        due_date: invoiceData.dueDate,
        total: invoiceData.total,
        currency: invoiceData.currency || "USD",
        status: "pushed",
        erp_reference: result.erpReference,
        raw_data: invoiceData,
      }).select().single();

      // ── FIRE SLACK/TEAMS NOTIFICATION ──────────────────────────
      if (savedInvoice) {
        try {
          await notify({ teamId, event: EVENTS.INVOICE_PROCESSED, invoice: savedInvoice });
          console.log(`Slack/Teams notification sent for invoice ${savedInvoice.invoice_number}`);
        } catch (e) { console.error("Notification error:", e.message); }
      }
    }

    res.json({ success: true, timestamp: new Date().toISOString(), ...result });
  } catch (err) {
    console.error("ERP push error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET ALL ERP CONNECTIONS FOR TEAM ───────────────────────────
app.get("/api/erp/connections/:teamId", async (req, res) => {
  try {
    const { data } = await supabase
      .from("erp_connections")
      .select("erp_type, status, updated_at")
      .eq("team_id", req.params.teamId);
    res.json({ success: true, connections: data || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── APPROVAL AGENT SETTINGS ─────────────────────────────────────
app.get("/api/agent/settings/:teamId", async (req, res) => {
  try {
    const { data } = await supabase.from("agent_settings").select("*").eq("team_id", req.params.teamId).single();
    res.json({ success: true, settings: data || {
      team_id: req.params.teamId,
      agent_enabled: true,
      auto_approve_below: 500,
      escalate_above: 5000,
      require_po_match: false,
      trusted_vendors: [],
    }});
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/agent/settings", async (req, res) => {
  try {
    const { teamId, agentEnabled, autoApproveBelow, escalateAbove, requirePoMatch, trustedVendors } = req.body;
    const { data, error } = await supabase.from("agent_settings").upsert({
      team_id: teamId,
      agent_enabled: agentEnabled,
      auto_approve_below: autoApproveBelow,
      escalate_above: escalateAbove,
      require_po_match: requirePoMatch,
      trusted_vendors: trustedVendors,
      updated_at: new Date().toISOString(),
    }, { onConflict: "team_id" }).select().single();
    if (error) throw error;
    res.json({ success: true, settings: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── MONTHLY REPORT AGENT ────────────────────────────────────────
const { generateMonthlyReport } = require("./reportAgent");

// Generate and send report manually
app.post("/api/agent/report", async (req, res) => {
  try {
    const { teamId, userId } = req.body;

    const { data: team } = await supabase.from("teams").select("name").eq("id", teamId).single();
    const adminEmail = await getUserEmail(userId);

    if (!adminEmail) throw new Error("Could not find admin email");

    const result = await generateMonthlyReport({
      teamId,
      teamName: team?.name || "Your Team",
      sendEmail,
      adminEmail,
    });

    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── EMAIL INVOICE AGENT ─────────────────────────────────────────
const { checkGmailForInvoices, saveEmailAgentConfig, getEmailAgentConfig } = require("./emailAgent");

// Get email agent config
app.get("/api/agent/email/:teamId", async (req, res) => {
  try {
    const config = await getEmailAgentConfig(req.params.teamId);
    res.json({ success: true, config: config || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Save email agent config
app.post("/api/agent/email/config", async (req, res) => {
  try {
    const { teamId, provider, accessToken, refreshToken, email, enabled } = req.body;
    const config = await saveEmailAgentConfig({ teamId, provider, accessToken, refreshToken, email, enabled });
    res.json({ success: true, config });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Manually trigger email check
app.post("/api/agent/email/check", async (req, res) => {
  try {
    const { teamId, userId } = req.body;
    const config = await getEmailAgentConfig(teamId);
    if (!config?.enabled) return res.json({ success: false, message: "Email agent not enabled" });

    if (config.provider === "gmail") {
      const result = await checkGmailForInvoices({
        accessToken: config.access_token,
        refreshToken: config.refresh_token,
        teamId,
        userId,
        lastChecked: config.last_checked,
      });

      // Update last checked
      await supabase.from("email_agent_config").update({ last_checked: new Date().toISOString() }).eq("team_id", teamId);

      // Send summary email if invoices found
      if (result.processed > 0 || result.emails?.some(e => e?.flat?.()?.some(i => i?.skipped))) {
        const skipped = result.emails?.flat?.()?.filter(i => i?.skipped)?.length || 0;
        const adminEmail = await getUserEmail(userId);
        if (adminEmail && result.processed > 0) {
          await sendEmail({
            to: adminEmail,
            subject: `📧 Email Agent: ${result.processed} invoice(s) auto-processed`,
            html: `
<div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:520px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <div style="background:#0a0f1e;padding:24px 32px;">
    <div style="font-size:20px;font-weight:800;color:#fff;">AP<span style="color:#e8531a;">Flow</span></div>
    <div style="margin-left:auto;font-size:11px;color:rgba(255,255,255,0.4);font-family:monospace;margin-top:4px;">EMAIL INVOICE AGENT</div>
  </div>
  <div style="padding:32px;">
    <div style="font-size:36px;margin-bottom:12px;">📧</div>
    <h2 style="font-size:20px;margin:0 0 8px;color:#0a0f1e;">${result.processed} Invoice(s) Auto-Processed</h2>
    <p style="font-size:14px;color:#7a7a6e;margin:0 0 20px;">APFlow automatically detected and processed ${result.processed} invoice(s) from your email inbox.</p>
    <a href="${process.env.FRONTEND_URL}" style="display:inline-block;background:#e8531a;color:#fff;text-decoration:none;padding:13px 28px;border-radius:8px;font-weight:600;">View Dashboard →</a>
  </div>
</div>`
          });
        }
      }

      res.json({ success: true, ...result });
    } else {
      res.json({ success: false, message: "Provider not supported yet" });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Gmail OAuth callback
app.get("/api/agent/email/gmail/callback", async (req, res) => {
  try {
    const { code, state } = req.query;
    const { teamId, userId } = JSON.parse(Buffer.from(state, "base64").toString());

    const { google } = require("googleapis");
    const oauth2Client = new google.auth.OAuth2(
      process.env.GMAIL_CLIENT_ID,
      process.env.GMAIL_CLIENT_SECRET,
      process.env.GMAIL_REDIRECT_URI
    );

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const gmail = google.gmail({ version: "v1", auth: oauth2Client });
    const { data: profile } = await gmail.users.getProfile({ userId: "me" });

    await saveEmailAgentConfig({
      teamId,
      provider: "gmail",
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      email: profile.emailAddress,
      enabled: true,
    });

    res.redirect(`${process.env.FRONTEND_URL}/login?emailAgentConnected=true`);
  } catch (err) {
    console.error("Gmail callback error:", err.message);
    res.redirect(`${process.env.FRONTEND_URL}/login?emailAgentError=true`);
  }
});

// Get Gmail OAuth URL
app.post("/api/agent/email/gmail/auth-url", async (req, res) => {
  try {
    const { teamId, userId } = req.body;
    const { google } = require("googleapis");
    const oauth2Client = new google.auth.OAuth2(
      process.env.GMAIL_CLIENT_ID,
      process.env.GMAIL_CLIENT_SECRET,
      process.env.GMAIL_REDIRECT_URI
    );

    const state = Buffer.from(JSON.stringify({ teamId, userId })).toString("base64");
    const url = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: ["https://www.googleapis.com/auth/gmail.readonly"],
      state,
      prompt: "consent",
    });

    res.json({ success: true, url });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Debug endpoint - check email agent log
app.get("/api/debug/email-log/:teamId", async (req, res) => {
  try {
    const { data: logs } = await supabase.from("email_agent_log").select("*").eq("team_id", req.params.teamId).order("processed_at", { ascending: false }).limit(10);
    const { data: invoices } = await supabase.from("invoices").select("*").like("erp_reference", "EMAIL-%").limit(10);
    res.json({ logs, invoices });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── NOTIFICATION AGENT ROUTES ───────────────────────────────────

// Get notification settings
app.get("/api/notifications/settings/:userId", async (req, res) => {
  try {
    const { data: member } = await supabase.from("team_members").select("team_id").eq("user_id", req.params.userId).eq("status", "active").single();
    if (!member) return res.json({ success: true, settings: null });
    const settings = await getNotificationSettings(member.team_id);
    res.json({ success: true, settings });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Save notification settings
app.post("/api/notifications/settings", async (req, res) => {
  try {
    const { userId, settings } = req.body;
    const { data: member } = await supabase.from("team_members").select("team_id").eq("user_id", userId).eq("status", "active").single();
    if (!member) return res.status(404).json({ error: "Team not found" });
    const saved = await saveNotificationSettings({ teamId: member.team_id, settings });
    res.json({ success: true, settings: saved });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Test webhook
app.post("/api/notifications/test", async (req, res) => {
  try {
    const { platform, webhookUrl } = req.body;
    await testNotifWebhook({ platform, webhookUrl });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── SUPPORT CONTACT FORM ────────────────────────────────────────
app.post("/api/support", async (req, res) => {
  try {
    const { name, email, issueType, message, teamId, teamName } = req.body;
    if (!message || !email) return res.status(400).json({ error: "Email and message required" });

    await sendEmail({
      to: "help@apflow.app",
      subject: `[${issueType}] Support Request from ${name || email}`,
      html: `
<div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <div style="background:#0a0f1e;padding:24px 32px;display:flex;align-items:center;justify-content:space-between;">
    <div style="font-size:20px;font-weight:800;color:#fff;">AP<span style="color:#e8531a;">Flow</span></div>
    <div style="font-size:11px;color:rgba(255,255,255,0.4);font-family:monospace;">SUPPORT REQUEST</div>
  </div>
  <div style="padding:32px;">
    <h2 style="font-size:18px;margin:0 0 20px;color:#0a0f1e;">${issueType}</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;">
      <tr style="border-bottom:1px solid #f0ede8;"><td style="padding:8px 0;color:#9ca3af;">From</td><td style="padding:8px 0;font-weight:600;text-align:right;">${name || "—"}</td></tr>
      <tr style="border-bottom:1px solid #f0ede8;"><td style="padding:8px 0;color:#9ca3af;">Email</td><td style="padding:8px 0;font-weight:600;text-align:right;"><a href="mailto:${email}" style="color:#e8531a;">${email}</a></td></tr>
      <tr style="border-bottom:1px solid #f0ede8;"><td style="padding:8px 0;color:#9ca3af;">Team</td><td style="padding:8px 0;font-weight:600;text-align:right;">${teamName || "—"}</td></tr>
      <tr><td style="padding:8px 0;color:#9ca3af;">Issue type</td><td style="padding:8px 0;font-weight:600;text-align:right;">${issueType}</td></tr>
    </table>
    <div style="background:#f9fafb;border-radius:10px;padding:16px 20px;font-size:14px;color:#374151;line-height:1.7;white-space:pre-wrap;">${message}</div>
    <div style="margin-top:20px;">
      <a href="mailto:${email}?subject=Re: ${encodeURIComponent(issueType)} — APFlow Support" style="display:inline-block;background:#e8531a;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px;">Reply to ${name || email} →</a>
    </div>
  </div>
</div>`
    });

    // Also send confirmation to user
    await sendEmail({
      to: email,
      subject: `We received your support request — APFlow`,
      html: `
<div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:520px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <div style="background:#0a0f1e;padding:24px 32px;">
    <div style="font-size:20px;font-weight:800;color:#fff;">AP<span style="color:#e8531a;">Flow</span></div>
  </div>
  <div style="padding:32px;">
    <div style="font-size:36px;margin-bottom:12px;">✅</div>
    <h2 style="font-size:18px;margin:0 0 8px;color:#0a0f1e;">We got your message, ${name?.split(" ")[0] || "there"}!</h2>
    <p style="font-size:14px;color:#7a7a6e;margin:0 0 20px;line-height:1.7;">Thanks for reaching out. We'll get back to you within 2 hours on business days. Your issue: <strong>${issueType}</strong>.</p>
    <p style="font-size:13px;color:#9ca3af;margin:0;">In the meantime, check our FAQ in the Help & Support page inside APFlow.</p>
    <div style="margin-top:24px;text-align:center;">
      <a href="${process.env.FRONTEND_URL}" style="display:inline-block;background:#e8531a;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px;">Back to APFlow →</a>
    </div>
  </div>
</div>`
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Support email error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── SUPPLIER COMMUNICATION AGENT ────────────────────────────────

// Manually trigger supplier notifications for a team
app.post("/api/agent/supplier/notify", async (req, res) => {
  try {
    const { teamId, userId } = req.body;
    const { data: team } = await supabase.from("teams").select("name").eq("id", teamId).single();
    const adminEmail = await getUserEmail(userId);

    const result = await scanAndNotifySuppliers({
      teamId,
      sendEmail,
      teamName: team?.name || "AP Team",
      replyEmail: adminEmail,
    });

    res.json({ success: true, ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Notify supplier for a specific invoice
app.post("/api/agent/supplier/notify-invoice", async (req, res) => {
  try {
    const { teamId, userId, invoiceId, issueType } = req.body;
    const { data: team } = await supabase.from("teams").select("name").eq("id", teamId).single();
    const adminEmail = await getUserEmail(userId);

    const { data: invoice } = await supabase.from("invoices").select("*").eq("id", invoiceId).single();
    if (!invoice) return res.status(404).json({ error: "Invoice not found" });

    const result = await notifySupplier({
      invoice,
      issueType: issueType || "anomaly",
      sendEmail,
      teamName: team?.name || "AP Team",
      replyEmail: adminEmail,
    });

    res.json({ success: true, ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── ERP SYNC AGENT ───────────────────────────────────────────────

// Manually trigger ERP sync for a team
app.post("/api/agent/erp-sync", async (req, res) => {
  try {
    const { teamId } = req.body;
    const result = await runErpSync({ teamId });

    // Notify for any newly paid invoices
    if (result.totalUpdated > 0) {
      const allDetails = [...(result.oracle?.details || []), ...(result.quickbooks?.details || [])];
      for (const detail of allDetails) {
        if (detail.newStatus === "paid") {
          try {
            const { data: inv } = await supabase.from("invoices").select("*").eq("invoice_number", detail.invoiceNumber).eq("team_id", teamId).single();
            if (inv) await notify({ teamId, event: EVENTS.PAYMENT_CONFIRMED, invoice: inv });
          } catch (e) { console.error("Payment notification error:", e.message); }
        }
      }
    }

    res.json({ success: true, ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── BATCH ZIP PROCESSING ────────────────────────────────────────
const { processZipBuffer } = require("./batchProcessor");

app.post("/api/batch/upload", upload.single("zip"), async (req, res) => {
  try {
    const { teamId, userId } = req.body;
    if (!req.file) return res.status(400).json({ error: "No ZIP file uploaded" });

    const zipBuffer = require("fs").readFileSync(req.file.path);
    const result = await processZipBuffer({ zipBuffer, teamId, userId, source: "manual" });

    // Cleanup temp file
    require("fs").unlinkSync(req.file.path);

    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
