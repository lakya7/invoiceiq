// anomalyAgent.js — APFlow Anomaly Detection Agent
// Detects suspicious patterns in invoices before approval

const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function runAnomalyAgent({ invoiceData, teamId, userId }) {
  const anomalies = [];
  const warnings = [];

  try {
    const amount = invoiceData.total || 0;
    const vendor = invoiceData.vendor?.name || "";
    const invoiceDate = invoiceData.invoiceDate;
    const invoiceNumber = invoiceData.invoiceNumber;

    // ── GET HISTORICAL DATA FOR THIS VENDOR ─────────────────────
    const { data: history } = await supabase
      .from("invoices")
      .select("total, invoice_date, vendor_name, invoice_number, raw_data, created_at")
      .ilike("vendor_name", `%${vendor}%`)
      .eq("team_id", teamId)
      .order("created_at", { ascending: false })
      .limit(20);

    const pastInvoices = history || [];

    // ── ANOMALY 0: Same invoice number already exists ────────────
    if (invoiceNumber) {
      const { data: sameInvNum } = await supabase
        .from("invoices")
        .select("id, vendor_name, total, created_at")
        .eq("invoice_number", invoiceNumber)
        .eq("team_id", teamId);

      if (sameInvNum && sameInvNum.length > 0) {
        anomalies.push({
          type: "duplicate_invoice_number",
          severity: "high",
          message: `Invoice #${invoiceNumber} was already processed on ${new Date(sameInvNum[0].created_at).toLocaleDateString()}. This is a duplicate!`,
        });
      }
    }

    // ── ANOMALY 1: Amount spike (3x average) ────────────────────
    if (pastInvoices.length >= 3) {
      const avgAmount = pastInvoices.reduce((s, i) => s + (i.total || 0), 0) / pastInvoices.length;
      if (avgAmount > 0 && amount > avgAmount * 3) {
        anomalies.push({
          type: "amount_spike",
          severity: "high",
          message: `Invoice amount ${formatAmt(amount)} is ${Math.round(amount / avgAmount)}x the average (${formatAmt(avgAmount)}) for ${vendor}`,
        });
      } else if (avgAmount > 0 && amount > avgAmount * 1.5) {
        warnings.push({
          type: "amount_increase",
          severity: "medium",
          message: `Invoice amount is 50%+ above average for ${vendor}. Average: ${formatAmt(avgAmount)}, This invoice: ${formatAmt(amount)}`,
        });
      }
    }

    // ── ANOMALY 2: Round number (fraud indicator) ────────────────
    if (amount > 1000 && amount % 1000 === 0) {
      warnings.push({
        type: "round_number",
        severity: "low",
        message: `Invoice amount ${formatAmt(amount)} is a round number — common in fraudulent invoices. Verify with vendor.`,
      });
    }

    // ── ANOMALY 3: Future invoice date ───────────────────────────
    if (invoiceDate) {
      const invDate = new Date(invoiceDate);
      const today = new Date();
      const diffDays = (invDate - today) / (1000 * 60 * 60 * 24);

      if (diffDays > 7) {
        anomalies.push({
          type: "future_date",
          severity: "high",
          message: `Invoice date (${invoiceDate}) is ${Math.round(diffDays)} days in the future. This is unusual.`,
        });
      }

      // Very old invoice (over 90 days)
      if (diffDays < -90) {
        warnings.push({
          type: "old_invoice",
          severity: "medium",
          message: `Invoice date (${invoiceDate}) is over 90 days old. Verify this is not a duplicate or stale invoice.`,
        });
      }
    }

    // ── ANOMALY 4: New vendor (first time) ──────────────────────
    if (pastInvoices.length === 0 && amount > 1000) {
      warnings.push({
        type: "new_vendor",
        severity: "low",
        message: `First invoice from "${vendor}" for ${formatAmt(amount)}. Verify vendor details before approving.`,
      });
    }

    // ── ANOMALY 5: Same amount different invoice number ──────────
    const sameAmount = pastInvoices.filter(i =>
      Math.abs((i.total || 0) - amount) < 0.01 &&
      i.invoice_number !== invoiceNumber
    );

    if (sameAmount.length >= 2) {
      anomalies.push({
        type: "repeated_amount",
        severity: "high",
        message: `${sameAmount.length} previous invoices from ${vendor} have the exact same amount (${formatAmt(amount)}). High risk of duplicate payment!`,
      });
    } else if (sameAmount.length === 1) {
      warnings.push({
        type: "same_amount",
        severity: "medium",
        message: `1 previous invoice from ${vendor} has the exact same amount (${formatAmt(amount)}). Verify this is not a duplicate.`,
      });
    }

    // ── ANOMALY 6: Missing vendor details ────────────────────────
    if (!invoiceData.vendor?.name || invoiceData.vendor?.name === "Your Company Name") {
      warnings.push({
        type: "missing_vendor",
        severity: "medium",
        message: `Vendor name is missing or generic. Please verify vendor details before approving.`,
      });
    }

    // ── DETERMINE OVERALL RISK LEVEL ────────────────────────────
    let riskLevel = "low";
    let riskScore = 0;

    anomalies.forEach(a => {
      riskScore += a.severity === "high" ? 40 : a.severity === "medium" ? 20 : 10;
    });
    warnings.forEach(w => {
      riskScore += w.severity === "high" ? 20 : w.severity === "medium" ? 10 : 5;
    });

    if (riskScore >= 40) riskLevel = "high";
    else if (riskScore >= 20) riskLevel = "medium";
    else riskLevel = "low";

    return {
      anomalies,
      warnings,
      riskLevel,
      riskScore,
      totalFlags: anomalies.length + warnings.length,
      summary: anomalies.length > 0
        ? `${anomalies.length} anomaly${anomalies.length > 1 ? "ies" : ""} detected — manual review strongly recommended`
        : warnings.length > 0
        ? `${warnings.length} warning${warnings.length > 1 ? "s" : ""} — review before approving`
        : "No anomalies detected — invoice looks normal",
    };

  } catch (err) {
    console.error("Anomaly Agent error:", err);
    return { anomalies: [], warnings: [], riskLevel: "unknown", riskScore: 0, totalFlags: 0, summary: "Anomaly check failed" };
  }
}

async function sendAnomalyEmail({ anomalyResult, invoiceData, adminEmail, sendEmail }) {
  if (anomalyResult.totalFlags === 0) return; // No anomalies — no email needed

  const { anomalies, warnings, riskLevel, summary } = anomalyResult;
  const riskColor = riskLevel === "high" ? "#dc2626" : riskLevel === "medium" ? "#d97706" : "#16a34a";
  const riskIcon = riskLevel === "high" ? "🔴" : riskLevel === "medium" ? "⚠️" : "✅";

  const flagsHtml = [
    ...anomalies.map(a => `<div style="background:#fee2e2;border-left:3px solid #dc2626;padding:10px 14px;border-radius:0 8px 8px 0;margin-bottom:8px;font-size:13px;">
      <strong style="color:#dc2626;">🔴 ${a.type.replace(/_/g, " ").toUpperCase()}</strong><br>
      <span style="color:#4a4a42;">${a.message}</span>
    </div>`),
    ...warnings.map(w => `<div style="background:#fef9c3;border-left:3px solid #d97706;padding:10px 14px;border-radius:0 8px 8px 0;margin-bottom:8px;font-size:13px;">
      <strong style="color:#d97706;">⚠️ ${w.type.replace(/_/g, " ").toUpperCase()}</strong><br>
      <span style="color:#4a4a42;">${w.message}</span>
    </div>`),
  ].join("");

  await sendEmail({
    to: adminEmail,
    subject: `${riskIcon} Anomaly Detected — Invoice #${invoiceData.invoiceNumber || "N/A"} from ${invoiceData.vendor?.name || "Unknown"}`,
    html: `
<div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:520px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <div style="background:#0a0f1e;padding:24px 32px;display:flex;align-items:center;">
    <div style="font-size:20px;font-weight:800;color:#fff;">AP<span style="color:#e8531a;">Flow</span></div>
    <div style="margin-left:auto;background:rgba(255,255,255,0.1);padding:4px 12px;border-radius:20px;font-size:11px;color:rgba(255,255,255,0.7);font-family:monospace;">ANOMALY AGENT</div>
  </div>
  <div style="padding:32px;">
    <div style="font-size:40px;margin-bottom:12px;">${riskIcon}</div>
    <h2 style="font-size:22px;margin:0 0 8px;color:#0a0f1e;">Anomaly Detected</h2>
    <p style="font-size:14px;color:#7a7a6e;margin:0 0 20px;">${summary}</p>

    <div style="background:#f5f2eb;border-radius:10px;padding:16px;margin-bottom:20px;">
      <div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:8px;">
        <span style="color:#7a7a6e;">Invoice #</span><strong>${invoiceData.invoiceNumber || "N/A"}</strong>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:8px;">
        <span style="color:#7a7a6e;">Vendor</span><strong>${invoiceData.vendor?.name || "Unknown"}</strong>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:8px;">
        <span style="color:#7a7a6e;">Amount</span><strong style="color:${riskColor};">$${Number(invoiceData.total || 0).toFixed(2)}</strong>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:14px;">
        <span style="color:#7a7a6e;">Risk Level</span>
        <span style="background:${riskColor}20;color:${riskColor};padding:2px 10px;border-radius:20px;font-size:12px;font-weight:600;">${riskLevel.toUpperCase()}</span>
      </div>
    </div>

    <div style="margin-bottom:24px;">${flagsHtml}</div>

    <a href="${process.env.FRONTEND_URL}" style="display:inline-block;background:#e8531a;color:#fff;text-decoration:none;padding:13px 28px;border-radius:8px;font-weight:600;font-size:15px;">Review Invoice →</a>
  </div>
</div>`
  });
}

function formatAmt(amount) {
  return `$${Number(amount).toFixed(2)}`;
}

module.exports = { runAnomalyAgent, sendAnomalyEmail };
