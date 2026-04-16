// reportAgent.js — APFlow Monthly Report Agent
// Generates and emails monthly AP summary to finance team

const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function generateMonthlyReport({ teamId, teamName, sendEmail, adminEmail }) {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();
    const monthName = now.toLocaleString("default", { month: "long", year: "numeric" });

    // ── FETCH MONTH'S INVOICES ──────────────────────────────────
    const { data: invoices } = await supabase
      .from("invoices")
      .select("*")
      .eq("team_id", teamId)
      .gte("created_at", startOfMonth)
      .lte("created_at", endOfMonth);

    const inv = invoices || [];

    // ── CALCULATE STATS ─────────────────────────────────────────
    const totalInvoices = inv.length;
    const totalAmount = inv.reduce((s, i) => s + (i.total || 0), 0);
    const pushed = inv.filter(i => i.status === "pushed").length;
    const pending = inv.filter(i => i.status === "pending").length;
    const rejected = inv.filter(i => i.status === "rejected").length;
    const poMatched = inv.filter(i => i.match_status === "matched").length;
    const duplicates = inv.filter(i => i.agent_decision === "auto_rejected").length;
    const autoApproved = inv.filter(i => i.agent_decision === "auto_approved").length;
    const escalated = inv.filter(i => i.agent_decision === "escalated").length;

    // Top vendors
    const vendorMap = {};
    inv.forEach(i => {
      const v = i.vendor_name || "Unknown";
      if (!vendorMap[v]) vendorMap[v] = { count: 0, total: 0 };
      vendorMap[v].count++;
      vendorMap[v].total += i.total || 0;
    });
    const topVendors = Object.entries(vendorMap)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 5);

    // Time saved (avg 15 min per invoice manually)
    const timeSavedHours = Math.round((totalInvoices * 15) / 60);
    const moneySaved = totalInvoices * 25; // avg $25/invoice saved

    // ── GENERATE REPORT ─────────────────────────────────────────
    const report = {
      month: monthName,
      teamName,
      totalInvoices,
      totalAmount,
      pushed,
      pending,
      rejected,
      poMatched,
      duplicates,
      autoApproved,
      escalated,
      topVendors,
      timeSavedHours,
      moneySaved,
    };

    // ── SEND EMAIL ──────────────────────────────────────────────
    await sendEmail({
      to: adminEmail,
      subject: `📊 APFlow Monthly Report — ${monthName} — ${teamName}`,
      html: generateReportHTML(report),
    });

    return { success: true, report };

  } catch (err) {
    console.error("Report Agent error:", err);
    return { success: false, error: err.message };
  }
}

function generateReportHTML(r) {
  const vendorRows = r.topVendors.map(([name, data]) => `
    <tr style="border-bottom:1px solid #f0ede8;">
      <td style="padding:10px 0;color:#0a0f1e;font-weight:500;">${name}</td>
      <td style="padding:10px 0;text-align:center;color:#7a7a6e;">${data.count}</td>
      <td style="padding:10px 0;text-align:right;font-weight:600;color:#e8531a;">$${Number(data.total).toFixed(2)}</td>
    </tr>
  `).join("");

  return `
<div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  
  <!-- Header -->
  <div style="background:#0a0f1e;padding:32px;text-align:center;">
    <div style="font-size:24px;font-weight:800;color:#fff;margin-bottom:4px;">AP<span style="color:#e8531a;">Flow</span></div>
    <div style="font-size:13px;color:rgba(255,255,255,0.5);font-family:monospace;letter-spacing:1px;">MONTHLY REPORT AGENT</div>
    <div style="font-size:20px;font-weight:700;color:#fff;margin-top:16px;">${r.month}</div>
    <div style="font-size:13px;color:rgba(255,255,255,0.5);">${r.teamName}</div>
  </div>

  <!-- Key Metrics -->
  <div style="padding:32px 32px 0;">
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:32px;">
      <div style="background:#f5f2eb;border-radius:12px;padding:20px;text-align:center;">
        <div style="font-size:32px;font-weight:800;color:#0a0f1e;">${r.totalInvoices}</div>
        <div style="font-size:11px;color:#7a7a6e;text-transform:uppercase;letter-spacing:1px;margin-top:4px;">Invoices</div>
      </div>
      <div style="background:#f5f2eb;border-radius:12px;padding:20px;text-align:center;">
        <div style="font-size:32px;font-weight:800;color:#e8531a;">$${Number(r.totalAmount).toLocaleString()}</div>
        <div style="font-size:11px;color:#7a7a6e;text-transform:uppercase;letter-spacing:1px;margin-top:4px;">Processed</div>
      </div>
      <div style="background:#f5f2eb;border-radius:12px;padding:20px;text-align:center;">
        <div style="font-size:32px;font-weight:800;color:#16a34a;">${r.timeSavedHours}h</div>
        <div style="font-size:11px;color:#7a7a6e;text-transform:uppercase;letter-spacing:1px;margin-top:4px;">Time Saved</div>
      </div>
    </div>

    <!-- AI Agent Stats -->
    <div style="background:linear-gradient(135deg,#0a0f1e,#1a2040);border-radius:12px;padding:24px;margin-bottom:24px;">
      <div style="font-size:13px;font-weight:600;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:1px;margin-bottom:16px;">🤖 AI Agent Performance</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">
        <div style="text-align:center;">
          <div style="font-size:28px;font-weight:800;color:#22c55e;">${r.autoApproved}</div>
          <div style="font-size:11px;color:rgba(255,255,255,0.4);margin-top:2px;">Auto Approved</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:28px;font-weight:800;color:#f59e0b;">${r.escalated}</div>
          <div style="font-size:11px;color:rgba(255,255,255,0.4);margin-top:2px;">Escalated</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:28px;font-weight:800;color:#ef4444;">${r.duplicates}</div>
          <div style="font-size:11px;color:rgba(255,255,255,0.4);margin-top:2px;">Duplicates Caught</div>
        </div>
      </div>
    </div>

    <!-- Invoice Status -->
    <div style="margin-bottom:24px;">
      <div style="font-size:14px;font-weight:600;color:#0a0f1e;margin-bottom:12px;">Invoice Status Breakdown</div>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr style="border-bottom:1px solid #f0ede8;">
          <td style="padding:10px 0;color:#7a7a6e;">✅ Pushed to ERP</td>
          <td style="padding:10px 0;text-align:right;font-weight:600;color:#16a34a;">${r.pushed}</td>
        </tr>
        <tr style="border-bottom:1px solid #f0ede8;">
          <td style="padding:10px 0;color:#7a7a6e;">⏳ Pending Review</td>
          <td style="padding:10px 0;text-align:right;font-weight:600;color:#d97706;">${r.pending}</td>
        </tr>
        <tr style="border-bottom:1px solid #f0ede8;">
          <td style="padding:10px 0;color:#7a7a6e;">🎯 PO Matched</td>
          <td style="padding:10px 0;text-align:right;font-weight:600;color:#1d4ed8;">${r.poMatched}</td>
        </tr>
        <tr>
          <td style="padding:10px 0;color:#7a7a6e;">❌ Rejected</td>
          <td style="padding:10px 0;text-align:right;font-weight:600;color:#dc2626;">${r.rejected}</td>
        </tr>
      </table>
    </div>

    <!-- Top Vendors -->
    ${r.topVendors.length > 0 ? `
    <div style="margin-bottom:24px;">
      <div style="font-size:14px;font-weight:600;color:#0a0f1e;margin-bottom:12px;">Top Vendors by Amount</div>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr style="border-bottom:1px solid #f0ede8;">
          <th style="padding:8px 0;text-align:left;color:#7a7a6e;font-weight:500;font-size:12px;">VENDOR</th>
          <th style="padding:8px 0;text-align:center;color:#7a7a6e;font-weight:500;font-size:12px;">INVOICES</th>
          <th style="padding:8px 0;text-align:right;color:#7a7a6e;font-weight:500;font-size:12px;">TOTAL</th>
        </tr>
        ${vendorRows}
      </table>
    </div>` : ""}

    <!-- Savings -->
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;margin-bottom:32px;">
      <div style="font-size:14px;font-weight:600;color:#16a34a;margin-bottom:8px;">💰 Estimated Savings This Month</div>
      <div style="font-size:13px;color:#15803d;line-height:1.7;">
        • <strong>${r.timeSavedHours} hours</strong> saved vs manual processing<br>
        • <strong>$${Number(r.moneySaved).toLocaleString()}</strong> in staff time saved<br>
        • <strong>${r.duplicates}</strong> duplicate payment${r.duplicates !== 1 ? "s" : ""} prevented
      </div>
    </div>

    <!-- CTA -->
    <div style="text-align:center;padding-bottom:32px;">
      <a href="${process.env.FRONTEND_URL}" style="display:inline-block;background:#e8531a;color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:600;font-size:15px;">View Dashboard →</a>
      <p style="font-size:12px;color:#9ca3af;margin-top:16px;">This report was automatically generated by APFlow's Monthly Report Agent.<br>© 2026 APFlow · hello@apflow.app</p>
    </div>
  </div>
</div>`;
}

module.exports = { generateMonthlyReport };
