// approvalAgent.js — APFlow Approval Agent
// Automatically approves, escalates or rejects invoices based on rules

const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// ── APPROVAL RULES ENGINE ───────────────────────────────────────
async function runApprovalAgent({ invoiceData, matchResult, teamId, userId, sendEmail }) {
  try {
    // Get team agent settings
    const { data: settings } = await supabase
      .from("agent_settings")
      .select("*")
      .eq("team_id", teamId)
      .single();

    // Default settings if none configured
    const rules = {
      autoApproveBelow: settings?.auto_approve_below || 500,
      requirePOMatch: settings?.require_po_match || false,
      trustedVendors: settings?.trusted_vendors || [],
      escalateAbove: settings?.escalate_above || 5000,
      agentEnabled: settings?.agent_enabled !== false,
    };

    // Skip if agent is disabled
    if (!rules.agentEnabled) {
      return { decision: "manual", reason: "Approval Agent is disabled for this team" };
    }

    const amount = invoiceData.total || 0;
    const vendor = invoiceData.vendor?.name || "";
    const matchStatus = matchResult?.matchStatus || "unmatched";

    // ── RULE 1: Auto-reject duplicates ─────────────────────────
    // (Duplicate check already happens before this)

    // ── RULE 2: Auto-approve if PO matched perfectly ───────────
    if (matchStatus === "matched" && amount <= rules.escalateAbove) {
      return {
        decision: "auto_approved",
        reason: `PO matched perfectly. Amount ${formatAmount(amount, invoiceData.currency)} is within limits.`,
        rule: "po_matched",
        confidence: 95,
      };
    }

    // ── RULE 3: Auto-approve trusted vendors under threshold ───
    const isTrustedVendor = rules.trustedVendors.some(v =>
      vendor.toLowerCase().includes(v.toLowerCase())
    );

    if (isTrustedVendor && amount <= rules.autoApproveBelow) {
      return {
        decision: "auto_approved",
        reason: `Trusted vendor "${vendor}". Amount ${formatAmount(amount, invoiceData.currency)} is below auto-approve threshold.`,
        rule: "trusted_vendor",
        confidence: 90,
      };
    }

    // ── RULE 4: Auto-approve small amounts ────────────────────
    if (amount <= rules.autoApproveBelow && matchStatus !== "mismatch") {
      return {
        decision: "auto_approved",
        reason: `Amount ${formatAmount(amount, invoiceData.currency)} is below auto-approve threshold of ${formatAmount(rules.autoApproveBelow, invoiceData.currency)}.`,
        rule: "below_threshold",
        confidence: 85,
      };
    }

    // ── RULE 5: Escalate high-value invoices ──────────────────
    if (amount > rules.escalateAbove) {
      return {
        decision: "escalated",
        reason: `Amount ${formatAmount(amount, invoiceData.currency)} exceeds escalation threshold of ${formatAmount(rules.escalateAbove, invoiceData.currency)}. Manual review required.`,
        rule: "high_value",
        confidence: 100,
      };
    }

    // ── RULE 6: Escalate PO mismatches ────────────────────────
    if (matchStatus === "mismatch") {
      return {
        decision: "escalated",
        reason: `PO mismatch detected. Invoice details don't match purchase order. Manual review required.`,
        rule: "po_mismatch",
        confidence: 100,
      };
    }

    // ── RULE 7: Escalate partial matches over threshold ────────
    if (matchStatus === "partial" && amount > rules.autoApproveBelow) {
      return {
        decision: "escalated",
        reason: `Partial PO match with amount ${formatAmount(amount, invoiceData.currency)} above threshold. Review recommended.`,
        rule: "partial_match",
        confidence: 80,
      };
    }

    // ── DEFAULT: Escalate for manual review ───────────────────
    return {
      decision: "escalated",
      reason: `No auto-approval rule matched. Amount: ${formatAmount(amount, invoiceData.currency)}, Vendor: ${vendor}, PO Match: ${matchStatus}.`,
      rule: "default",
      confidence: 70,
    };

  } catch (err) {
    console.error("Approval Agent error:", err);
    return { decision: "manual", reason: "Agent error — manual review required" };
  }
}

// ── SEND AGENT DECISION EMAIL ───────────────────────────────────
async function sendAgentDecisionEmail({ decision, reason, rule, invoiceData, erpReference, adminEmail, sendEmail }) {
  const isApproved = decision === "auto_approved";
  const isEscalated = decision === "escalated";

  const color = isApproved ? "#16a34a" : isEscalated ? "#d97706" : "#dc2626";
  const icon = isApproved ? "✅" : isEscalated ? "⚠️" : "🔴";
  const title = isApproved ? "Invoice Auto-Approved" : isEscalated ? "Invoice Needs Your Review" : "Invoice Rejected";
  const amount = invoiceData.total || 0;
  const currency = invoiceData.currency || "USD";
  const sym = currency === "INR" ? "₹" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : "$";

  await sendEmail({
    to: adminEmail,
    subject: `${icon} ${title} — Invoice #${invoiceData.invoiceNumber || "N/A"} from ${invoiceData.vendor?.name || "Unknown"}`,
    html: `
<div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:520px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <div style="background:#0a0f1e;padding:24px 32px;display:flex;align-items:center;gap:12px;">
    <div style="font-size:20px;font-weight:800;color:#fff;">AP<span style="color:#e8531a;">Flow</span></div>
    <div style="margin-left:auto;background:rgba(255,255,255,0.1);padding:4px 12px;border-radius:20px;font-size:11px;color:rgba(255,255,255,0.7);font-family:monospace;">APPROVAL AGENT</div>
  </div>
  <div style="padding:32px;">
    <div style="font-size:40px;margin-bottom:12px;">${icon}</div>
    <h2 style="font-size:22px;margin:0 0 8px;color:#0a0f1e;">${title}</h2>
    <p style="font-size:14px;color:#7a7a6e;line-height:1.6;margin:0 0 24px;">${reason}</p>

    <div style="background:#f5f2eb;border-radius:10px;padding:20px;margin-bottom:24px;">
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr style="border-bottom:1px solid #e2ddd4;">
          <td style="padding:8px 0;color:#7a7a6e;">Invoice #</td>
          <td style="padding:8px 0;font-weight:600;text-align:right;">${invoiceData.invoiceNumber || "N/A"}</td>
        </tr>
        <tr style="border-bottom:1px solid #e2ddd4;">
          <td style="padding:8px 0;color:#7a7a6e;">Vendor</td>
          <td style="padding:8px 0;font-weight:600;text-align:right;">${invoiceData.vendor?.name || "Unknown"}</td>
        </tr>
        <tr style="border-bottom:1px solid #e2ddd4;">
          <td style="padding:8px 0;color:#7a7a6e;">Amount</td>
          <td style="padding:8px 0;font-weight:700;text-align:right;color:${color};">${sym}${Number(amount).toFixed(2)}</td>
        </tr>
        <tr style="border-bottom:1px solid #e2ddd4;">
          <td style="padding:8px 0;color:#7a7a6e;">ERP Reference</td>
          <td style="padding:8px 0;font-weight:600;text-align:right;">${erpReference || "N/A"}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#7a7a6e;">Agent Decision</td>
          <td style="padding:8px 0;text-align:right;">
            <span style="background:${color}20;color:${color};padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600;">${decision.replace("_", " ").toUpperCase()}</span>
          </td>
        </tr>
      </table>
    </div>

    ${isEscalated ? `
    <a href="${process.env.FRONTEND_URL}" style="display:inline-block;background:#e8531a;color:#fff;text-decoration:none;padding:13px 28px;border-radius:8px;font-weight:600;font-size:15px;margin-bottom:16px;">Review Invoice →</a>
    <p style="font-size:12px;color:#9ca3af;">This invoice requires your manual review before it can be processed.</p>
    ` : `
    <p style="font-size:13px;color:#7a7a6e;">This invoice was automatically approved and pushed to your ERP system. No action required.</p>
    `}
  </div>
</div>`
  });
}

function formatAmount(amount, currency) {
  const sym = currency === "INR" ? "₹" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : "$";
  return `${sym}${Number(amount).toFixed(2)}`;
}

module.exports = { runApprovalAgent, sendAgentDecisionEmail };
