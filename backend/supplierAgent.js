// supplierAgent.js — APFlow Supplier Communication Agent
// Automatically emails suppliers when their invoice has issues

const { createClient } = require("@supabase/supabase-js");
const Anthropic = require("@anthropic-ai/sdk");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── ISSUE TYPES ─────────────────────────────────────────────────
const ISSUE_TEMPLATES = {
  duplicate: {
    subject: (inv) => `Re: Invoice #${inv.invoice_number} — Duplicate Detected`,
    headline: "Duplicate Invoice Detected",
    emoji: "⚠️",
    color: "#d97706",
    bgColor: "#fffbeb",
    borderColor: "#fde68a",
    getMessage: (inv) => `We received invoice <strong>#${inv.invoice_number}</strong> dated <strong>${inv.invoice_date || "N/A"}</strong>, but our system detected that this invoice number was already processed on a previous date. To avoid double payment, we have placed this invoice on hold.`,
    getAction: () => `Please verify this is not a duplicate submission. If this is a new invoice, kindly resubmit with a unique invoice number. If you believe this is an error, please reply to this email with supporting documentation.`,
  },
  extraction_failed: {
    subject: (inv) => `Re: Invoice from ${inv.vendor_name || "your company"} — Unable to Process`,
    headline: "Invoice Could Not Be Processed",
    emoji: "📄",
    color: "#dc2626",
    bgColor: "#fef2f2",
    borderColor: "#fecaca",
    getMessage: (inv) => `We received an invoice from <strong>${inv.vendor_name || "your company"}</strong>, but our automated system was unable to extract the required information from the document. This may be due to a scanned image with low resolution, a password-protected PDF, or a non-standard invoice format.`,
    getAction: () => `Please resubmit your invoice as a clear, text-based PDF. Ensure the document includes: invoice number, invoice date, vendor name, line items, and total amount.`,
  },
  anomaly: {
    subject: (inv) => `Re: Invoice #${inv.invoice_number} — Under Review`,
    headline: "Invoice Flagged for Review",
    emoji: "🔍",
    color: "#7c3aed",
    bgColor: "#f5f3ff",
    borderColor: "#ddd6fe",
    getMessage: (inv) => `Invoice <strong>#${inv.invoice_number}</strong> for <strong>${inv.currency === "INR" ? "₹" : inv.currency === "EUR" ? "€" : inv.currency === "GBP" ? "£" : "$"}${Number(inv.total || 0).toLocaleString()}</strong> has been flagged by our automated review system and is currently under manual review by our AP team.`,
    getAction: () => `No action is required from you at this time. Our AP team will review the invoice within 1-2 business days and contact you if additional information is needed. You will receive a confirmation once the invoice is approved and scheduled for payment.`,
  },
};

// ── GENERATE PERSONALIZED EMAIL WITH CLAUDE ─────────────────────
async function generateSupplierEmail({ issueType, invoice, anomalyFlags }) {
  const template = ISSUE_TEMPLATES[issueType];
  if (!template) return null;

  // Use Claude to write a professional, context-aware email body
  const flagDetails = anomalyFlags?.length
    ? `Anomaly flags detected: ${anomalyFlags.map(f => f.type + ": " + f.description).join("; ")}`
    : "";

  const prompt = `Write a professional, empathetic 2-sentence explanation for a supplier about their invoice issue.
Issue type: ${issueType}
Invoice #: ${invoice.invoice_number || "N/A"}
Vendor: ${invoice.vendor_name || "Unknown"}
Amount: ${invoice.total || 0} ${invoice.currency || "USD"}
${flagDetails}
Keep it concise, professional, and actionable. Do not include greetings or sign-offs. Just the 2-sentence explanation.`;

  let claudeMessage = "";
  try {
    const res = await claude.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 150,
      messages: [{ role: "user", content: prompt }],
    });
    claudeMessage = res.content[0]?.text?.trim() || "";
  } catch (e) {
    console.error("Claude supplier email gen error:", e.message);
  }

  return { template, claudeMessage };
}

// ── BUILD EMAIL HTML ─────────────────────────────────────────────
function buildSupplierEmailHtml({ template, invoice, claudeMessage, teamName, replyEmail }) {
  const cur = invoice.currency || "USD";
  const sym = cur === "INR" ? "₹" : cur === "EUR" ? "€" : cur === "GBP" ? "£" : "$";

  return `
<div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <!-- Header -->
  <div style="background:#0a0f1e;padding:24px 32px;display:flex;align-items:center;justify-content:space-between;">
    <div style="font-size:20px;font-weight:800;color:#fff;">AP<span style="color:#e8531a;">Flow</span></div>
    <div style="font-size:11px;color:rgba(255,255,255,0.4);font-family:monospace;">SUPPLIER COMMUNICATION</div>
  </div>

  <!-- Body -->
  <div style="padding:32px;">
    <div style="font-size:36px;margin-bottom:16px;">${template.emoji}</div>
    <h2 style="font-size:20px;margin:0 0 8px;color:#0a0f1e;">${template.headline}</h2>

    <!-- Invoice details pill -->
    <div style="display:inline-flex;align-items:center;gap:8px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:20px;padding:6px 14px;margin-bottom:20px;">
      <span style="font-size:12px;color:#6b7280;">Invoice</span>
      <span style="font-size:13px;font-weight:700;color:#0a0f1e;">#${invoice.invoice_number || "N/A"}</span>
      <span style="color:#e5e7eb;">·</span>
      <span style="font-size:13px;font-weight:700;color:#0a0f1e;">${sym}${Number(invoice.total || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
    </div>

    <!-- Main message -->
    <div style="background:${template.bgColor};border:1px solid ${template.borderColor};border-radius:10px;padding:16px 20px;margin-bottom:20px;font-size:14px;color:#374151;line-height:1.7;">
      ${claudeMessage || template.getMessage(invoice)}
    </div>

    <!-- Action required -->
    <div style="margin-bottom:24px;">
      <div style="font-size:12px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">What to do next</div>
      <p style="font-size:14px;color:#4b5563;line-height:1.7;margin:0;">${template.getAction()}</p>
    </div>

    <!-- Invoice summary table -->
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px;">
      <tr style="border-bottom:1px solid #f0ede8;">
        <td style="padding:8px 0;color:#9ca3af;">Invoice Number</td>
        <td style="padding:8px 0;text-align:right;font-weight:600;color:#0a0f1e;">#${invoice.invoice_number || "N/A"}</td>
      </tr>
      <tr style="border-bottom:1px solid #f0ede8;">
        <td style="padding:8px 0;color:#9ca3af;">Amount</td>
        <td style="padding:8px 0;text-align:right;font-weight:600;color:#0a0f1e;">${sym}${Number(invoice.total || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })} ${cur}</td>
      </tr>
      <tr style="border-bottom:1px solid #f0ede8;">
        <td style="padding:8px 0;color:#9ca3af;">Invoice Date</td>
        <td style="padding:8px 0;text-align:right;font-weight:600;color:#0a0f1e;">${invoice.invoice_date || "N/A"}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;color:#9ca3af;">Received By</td>
        <td style="padding:8px 0;text-align:right;font-weight:600;color:#0a0f1e;">${teamName || "AP Team"}</td>
      </tr>
    </table>

    <!-- Reply CTA -->
    <div style="background:#f9fafb;border-radius:10px;padding:16px 20px;font-size:13px;color:#6b7280;">
      Questions? Reply directly to this email${replyEmail ? ` or contact us at <a href="mailto:${replyEmail}" style="color:#e8531a;">${replyEmail}</a>` : ""}.
    </div>
  </div>

  <!-- Footer -->
  <div style="background:#f9fafb;padding:16px 32px;font-size:11px;color:#9ca3af;text-align:center;border-top:1px solid #e5e7eb;">
    This is an automated message from APFlow AP Automation · <a href="${process.env.FRONTEND_URL}" style="color:#9ca3af;">apflow.app</a>
  </div>
</div>`;
}

// ── MAIN: NOTIFY SUPPLIER ────────────────────────────────────────
async function notifySupplier({ invoice, issueType, anomalyFlags, sendEmail, teamName, replyEmail }) {
  try {
    // Get supplier email from invoice data
    const supplierEmail = invoice.raw_data?.vendor?.email || invoice.vendor_email;
    if (!supplierEmail) {
      console.log(`Supplier Communication Agent: No supplier email for invoice #${invoice.invoice_number} — skipping`);
      return { sent: false, reason: "No supplier email found" };
    }

    const template = ISSUE_TEMPLATES[issueType];
    if (!template) return { sent: false, reason: "Unknown issue type" };

    // Check if we already notified for this invoice + issue type
    const { data: existing } = await supabase
      .from("supplier_notifications")
      .select("id")
      .eq("invoice_id", invoice.id)
      .eq("issue_type", issueType)
      .single();

    if (existing) {
      console.log(`Already notified supplier for invoice #${invoice.invoice_number} (${issueType})`);
      return { sent: false, reason: "Already notified" };
    }

    // Generate email with Claude
    const { template: tmpl, claudeMessage } = await generateSupplierEmail({ issueType, invoice, anomalyFlags });

    const subject = tmpl.subject(invoice);
    const html = buildSupplierEmailHtml({ template: tmpl, invoice, claudeMessage, teamName, replyEmail });

    // Send email
    await sendEmail({ to: supplierEmail, subject, html });

    // Log notification
    await supabase.from("supplier_notifications").insert({
      invoice_id: invoice.id,
      team_id: invoice.team_id,
      supplier_email: supplierEmail,
      issue_type: issueType,
      subject,
      sent_at: new Date().toISOString(),
    });

    console.log(`✅ Supplier notified: ${supplierEmail} for invoice #${invoice.invoice_number} (${issueType})`);
    return { sent: true, supplierEmail, subject };

  } catch (err) {
    console.error("Supplier Communication Agent error:", err.message);
    return { sent: false, reason: err.message };
  }
}

// ── SCAN: CHECK ALL PROBLEM INVOICES ────────────────────────────
async function scanAndNotifySuppliers({ teamId, sendEmail, teamName, replyEmail }) {
  const results = { notified: 0, skipped: 0, errors: 0, details: [] };

  try {
    // Get all invoices with issues that haven't been notified yet
    const { data: invoices } = await supabase
      .from("invoices")
      .select("*")
      .eq("team_id", teamId)
      .or("agent_decision.eq.duplicate_skipped,agent_decision.eq.extraction_failed,agent_decision.like.anomaly%");

    if (!invoices?.length) return results;

    for (const invoice of invoices) {
      let issueType = null;
      let anomalyFlags = [];

      if (invoice.agent_decision === "duplicate_skipped") issueType = "duplicate";
      else if (invoice.agent_decision === "extraction_failed") issueType = "extraction_failed";
      else if (invoice.agent_decision?.startsWith("anomaly")) {
        issueType = "anomaly";
        anomalyFlags = invoice.raw_data?.anomalyFlags || [];
      }

      if (!issueType) continue;

      const result = await notifySupplier({ invoice, issueType, anomalyFlags, sendEmail, teamName, replyEmail });
      if (result.sent) results.notified++;
      else results.skipped++;
      results.details.push({ invoiceNumber: invoice.invoice_number, ...result });
    }

    return results;
  } catch (err) {
    console.error("Scan supplier notifications error:", err.message);
    return { ...results, error: err.message };
  }
}

module.exports = { notifySupplier, scanAndNotifySuppliers };
