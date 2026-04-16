// reportAgent.js — APFlow Monthly Report Agent
const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function generateMonthlyReport({ teamId, teamName, sendEmail, adminEmail }) {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();
    const monthName = now.toLocaleString("default", { month: "long", year: "numeric" });

    const { data: invoices } = await supabase
      .from("invoices").select("*").eq("team_id", teamId)
      .gte("created_at", startOfMonth).lte("created_at", endOfMonth);

    const inv = invoices || [];
    const totalInvoices = inv.length;
    const totalAmount = inv.reduce((s, i) => s + (i.total || 0), 0);
    const pushed = inv.filter(i => i.status === "pushed").length;
    const pending = inv.filter(i => i.status === "pending").length;
    const rejected = inv.filter(i => i.status === "rejected").length;
    const poMatched = inv.filter(i => i.match_status === "matched").length;
    const duplicates = inv.filter(i => i.agent_decision === "auto_rejected").length;
    const autoApproved = inv.filter(i => i.agent_decision === "auto_approved").length;
    const escalated = inv.filter(i => i.agent_decision === "escalated").length;
    const timeSavedHours = Math.round((totalInvoices * 15) / 60);
    const moneySaved = totalInvoices * 25;

    const vendorMap = {};
    inv.forEach(i => {
      const v = i.vendor_name || "Unknown";
      if (!vendorMap[v]) vendorMap[v] = { count: 0, total: 0 };
      vendorMap[v].count++;
      vendorMap[v].total += i.total || 0;
    });
    const topVendors = Object.entries(vendorMap).sort((a, b) => b[1].total - a[1].total).slice(0, 5);

    await sendEmail({
      to: adminEmail,
      subject: `📊 APFlow Monthly Report — ${monthName} — ${teamName}`,
      html: generateReportHTML({ month: monthName, teamName, totalInvoices, totalAmount, pushed, pending, rejected, poMatched, duplicates, autoApproved, escalated, topVendors, timeSavedHours, moneySaved }),
    });

    return { success: true };
  } catch (err) {
    console.error("Report Agent error:", err);
    return { success: false, error: err.message };
  }
}

function fmt(n) { return `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }

function generateReportHTML(r) {
  const vendorRows = r.topVendors.length > 0 ? r.topVendors.map(([name, data], i) => `
    <tr style="background:${i % 2 === 0 ? "#ffffff" : "#f9f9f9"};">
      <td style="padding:12px 16px;font-size:14px;color:#1a1a2e;border-bottom:1px solid #f0ede8;">${name}</td>
      <td style="padding:12px 16px;font-size:14px;color:#6b7280;text-align:center;border-bottom:1px solid #f0ede8;">${data.count}</td>
      <td style="padding:12px 16px;font-size:14px;color:#e8531a;font-weight:700;text-align:right;border-bottom:1px solid #f0ede8;">${fmt(data.total)}</td>
    </tr>`).join("") : `<tr><td colspan="3" style="padding:16px;text-align:center;color:#9ca3af;font-size:14px;">No vendor data this month</td></tr>`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.1);max-width:600px;">

  <!-- Header -->
  <tr>
    <td style="background:#0a0f1e;padding:36px 40px;text-align:center;">
      <p style="margin:0 0 4px;font-size:26px;font-weight:800;color:#ffffff;">AP<span style="color:#e8531a;">Flow</span></p>
      <p style="margin:0 0 20px;font-size:11px;color:rgba(255,255,255,0.4);letter-spacing:2px;font-family:monospace;">MONTHLY REPORT AGENT</p>
      <p style="margin:0 0 4px;font-size:22px;font-weight:700;color:#ffffff;">${r.month}</p>
      <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.5);">${r.teamName}</p>
    </td>
  </tr>

  <!-- Key Metrics -->
  <tr>
    <td style="padding:32px 40px 0;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td width="33%" style="text-align:center;padding:0 8px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f2eb;border-radius:12px;">
              <tr><td style="padding:24px 16px;text-align:center;">
                <p style="margin:0 0 6px;font-size:36px;font-weight:800;color:#1a1a2e;">${r.totalInvoices}</p>
                <p style="margin:0;font-size:11px;color:#7a7a6e;text-transform:uppercase;letter-spacing:1px;">Invoices</p>
              </td></tr>
            </table>
          </td>
          <td width="33%" style="text-align:center;padding:0 8px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff4f0;border-radius:12px;border:1px solid #fcd3c0;">
              <tr><td style="padding:24px 16px;text-align:center;">
                <p style="margin:0 0 6px;font-size:28px;font-weight:800;color:#e8531a;">${fmt(r.totalAmount)}</p>
                <p style="margin:0;font-size:11px;color:#7a7a6e;text-transform:uppercase;letter-spacing:1px;">Processed</p>
              </td></tr>
            </table>
          </td>
          <td width="33%" style="text-align:center;padding:0 8px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border-radius:12px;border:1px solid #bbf7d0;">
              <tr><td style="padding:24px 16px;text-align:center;">
                <p style="margin:0 0 6px;font-size:36px;font-weight:800;color:#16a34a;">${r.timeSavedHours}h</p>
                <p style="margin:0;font-size:11px;color:#7a7a6e;text-transform:uppercase;letter-spacing:1px;">Time Saved</p>
              </td></tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Divider -->
  <tr><td style="padding:28px 40px 0;"><hr style="border:none;border-top:1px solid #f0ede8;margin:0;"></td></tr>

  <!-- AI Agent Performance -->
  <tr>
    <td style="padding:28px 40px 0;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0f1e;border-radius:12px;">
        <tr>
          <td style="padding:24px 28px;">
            <p style="margin:0 0 20px;font-size:12px;font-weight:600;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1.5px;">🤖 AI Agent Performance</p>
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td width="33%" style="text-align:center;">
                  <p style="margin:0 0 4px;font-size:32px;font-weight:800;color:#22c55e;">${r.autoApproved}</p>
                  <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.4);">Auto Approved</p>
                </td>
                <td width="33%" style="text-align:center;border-left:1px solid rgba(255,255,255,0.08);border-right:1px solid rgba(255,255,255,0.08);">
                  <p style="margin:0 0 4px;font-size:32px;font-weight:800;color:#f59e0b;">${r.escalated}</p>
                  <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.4);">Escalated</p>
                </td>
                <td width="33%" style="text-align:center;">
                  <p style="margin:0 0 4px;font-size:32px;font-weight:800;color:#ef4444;">${r.duplicates}</p>
                  <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.4);">Duplicates Caught</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Invoice Status -->
  <tr>
    <td style="padding:28px 40px 0;">
      <p style="margin:0 0 16px;font-size:15px;font-weight:700;color:#1a1a2e;">Invoice Status Breakdown</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #f0ede8;border-radius:10px;overflow:hidden;">
        <tr style="background:#faf9f7;">
          <td style="padding:12px 16px;font-size:13px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Status</td>
          <td style="padding:12px 16px;font-size:13px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;text-align:right;">Count</td>
        </tr>
        <tr><td style="padding:14px 16px;font-size:14px;color:#1a1a2e;border-top:1px solid #f0ede8;">✅ Pushed to ERP</td><td style="padding:14px 16px;font-size:14px;font-weight:700;color:#16a34a;text-align:right;border-top:1px solid #f0ede8;">${r.pushed}</td></tr>
        <tr style="background:#faf9f7;"><td style="padding:14px 16px;font-size:14px;color:#1a1a2e;">⏳ Pending Review</td><td style="padding:14px 16px;font-size:14px;font-weight:700;color:#d97706;text-align:right;">${r.pending}</td></tr>
        <tr><td style="padding:14px 16px;font-size:14px;color:#1a1a2e;border-top:1px solid #f0ede8;">🎯 PO Matched</td><td style="padding:14px 16px;font-size:14px;font-weight:700;color:#1d4ed8;text-align:right;border-top:1px solid #f0ede8;">${r.poMatched}</td></tr>
        <tr style="background:#faf9f7;"><td style="padding:14px 16px;font-size:14px;color:#1a1a2e;">❌ Rejected</td><td style="padding:14px 16px;font-size:14px;font-weight:700;color:#dc2626;text-align:right;">${r.rejected}</td></tr>
      </table>
    </td>
  </tr>

  <!-- Top Vendors -->
  <tr>
    <td style="padding:28px 40px 0;">
      <p style="margin:0 0 16px;font-size:15px;font-weight:700;color:#1a1a2e;">Top Vendors by Amount</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #f0ede8;border-radius:10px;overflow:hidden;">
        <tr style="background:#faf9f7;">
          <td style="padding:12px 16px;font-size:13px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Vendor</td>
          <td style="padding:12px 16px;font-size:13px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;text-align:center;">Invoices</td>
          <td style="padding:12px 16px;font-size:13px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;text-align:right;">Total</td>
        </tr>
        ${vendorRows}
      </table>
    </td>
  </tr>

  <!-- Savings Banner -->
  <tr>
    <td style="padding:28px 40px 0;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;">
        <tr><td style="padding:24px 28px;">
          <p style="margin:0 0 12px;font-size:15px;font-weight:700;color:#16a34a;">💰 Estimated Savings This Month</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td width="33%" style="text-align:center;padding:8px;">
                <p style="margin:0 0 4px;font-size:22px;font-weight:800;color:#16a34a;">${r.timeSavedHours}h</p>
                <p style="margin:0;font-size:12px;color:#15803d;">Staff Time Saved</p>
              </td>
              <td width="33%" style="text-align:center;padding:8px;border-left:1px solid #bbf7d0;border-right:1px solid #bbf7d0;">
                <p style="margin:0 0 4px;font-size:22px;font-weight:800;color:#16a34a;">${fmt(r.moneySaved)}</p>
                <p style="margin:0;font-size:12px;color:#15803d;">Cost Savings</p>
              </td>
              <td width="33%" style="text-align:center;padding:8px;">
                <p style="margin:0 0 4px;font-size:22px;font-weight:800;color:#16a34a;">${r.duplicates}</p>
                <p style="margin:0;font-size:12px;color:#15803d;">Duplicates Prevented</p>
              </td>
            </tr>
          </table>
        </td></tr>
      </table>
    </td>
  </tr>

  <!-- CTA -->
  <tr>
    <td style="padding:32px 40px;text-align:center;">
      <a href="${process.env.FRONTEND_URL || 'https://www.apflow.app'}" style="display:inline-block;background:#e8531a;color:#ffffff;text-decoration:none;padding:15px 36px;border-radius:10px;font-weight:700;font-size:15px;">View Dashboard →</a>
    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="background:#f9f9f9;padding:20px 40px;text-align:center;border-top:1px solid #f0ede8;">
      <p style="margin:0;font-size:12px;color:#9ca3af;">This report was automatically generated by APFlow's Monthly Report Agent</p>
      <p style="margin:4px 0 0;font-size:12px;color:#9ca3af;">© 2026 APFlow · <a href="mailto:hello@apflow.app" style="color:#e8531a;text-decoration:none;">hello@apflow.app</a></p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

module.exports = { generateMonthlyReport };
