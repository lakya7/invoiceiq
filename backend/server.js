const express = require("express");
const cors = require("cors");
const multer = require("multer");
const Anthropic = require("@anthropic-ai/sdk");
const { Resend } = require("resend");
const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");
const fs = require("fs");

const app = express();
const upload = multer({ dest: "uploads/" });

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

app.use(cors({ origin: process.env.FRONTEND_URL || "*", methods: ["GET","POST","PUT","DELETE"] }));
app.use(express.json());
app.get("/health", (req, res) => res.json({ status: "ok" }));

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
        { type: "text", text: `Extract all data from this invoice/PO document. Return ONLY valid JSON:
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

    res.json({ success: true, erpReference, timestamp });
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
    const { data: memberships } = await supabase.from("team_members").select("team_id, role, status").eq("user_id", req.params.userId).eq("status", "active");
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
    const inviteUrl = `${process.env.FRONTEND_URL || "http://localhost:3000"}/invite/${token}`;
    await resend.emails.send({
      from: "InvoiceIQ <notifications@invoiceiq.app>",
      to: email,
      subject: `${inviterEmail} invited you to join ${team?.name || "a team"} on InvoiceIQ`,
      html: `
<div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:520px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <div style="background:#0a0f1e;padding:24px 32px;">
    <div style="font-size:20px;font-weight:800;color:#fff;">Invoice<span style="color:#e8531a;">IQ</span></div>
  </div>
  <div style="padding:32px;">
    <h2 style="font-size:20px;margin:0 0 12px;color:#0a0f1e;">You've been invited! 🎉</h2>
    <p style="font-size:15px;color:#7a7a6e;line-height:1.6;margin:0 0 24px;">
      <strong style="color:#0a0f1e;">${inviterEmail}</strong> has invited you to join <strong style="color:#0a0f1e;">${team?.name || "their team"}</strong> on InvoiceIQ as a <strong style="color:#e8531a;">${role}</strong>.
    </p>
    <a href="${inviteUrl}" style="display:inline-block;background:#e8531a;color:#fff;text-decoration:none;padding:13px 28px;border-radius:8px;font-weight:600;font-size:15px;">Accept Invitation →</a>
    <p style="font-size:12px;color:#aaa;margin-top:20px;">This invitation expires in 7 days. If you don't have an InvoiceIQ account, you'll be asked to create one.</p>
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
      from: "InvoiceIQ <notifications@invoiceiq.app>", to: email,
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
    from: "InvoiceIQ <notifications@invoiceiq.app>", to: recipients,
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
app.listen(PORT, () => console.log(`InvoiceIQ backend on port ${PORT}`));

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
