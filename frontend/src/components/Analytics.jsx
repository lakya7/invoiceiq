import { useState, useEffect } from "react";
import { supabase } from "../supabase";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

const ORANGE = "#e8531a";
const BLUE = "#2563eb";
const GREEN = "#16a34a";
const PURPLE = "#7c3aed";
const AMBER = "#d97706";

function KpiCard({ icon, label, value, sub, bg, color, trend }) {
  return (
    <div style={{ background: bg, borderRadius: 16, padding: "24px 22px", position: "relative", overflow: "hidden", flex: 1, minWidth: 160 }}>
      <div style={{ position: "absolute", top: -20, right: -20, width: 80, height: 80, background: `${color}15`, borderRadius: "50%" }} />
      <div style={{ fontSize: 28, marginBottom: 12 }}>{icon}</div>
      <div style={{ fontFamily: "Syne,sans-serif", fontSize: 32, fontWeight: 800, color: "#1a1a2e", lineHeight: 1, marginBottom: 4 }}>{value}</div>
      <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 6 }}>{label}</div>
      {trend && <div style={{ fontSize: 11, color: GREEN, fontWeight: 600, background: "#f0fdf4", padding: "2px 8px", borderRadius: 20, display: "inline-block" }}>↑ {trend}</div>}
      {sub && <div style={{ fontSize: 11, color: "#9ca3af" }}>{sub}</div>}
    </div>
  );
}

function BarChart({ data, color, height = 140 }) {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height, padding: "8px 0 0" }}>
      {data.map((d, i) => (
        <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
          <div style={{ fontSize: 11, color: "#9ca3af", fontWeight: 600, minHeight: 16 }}>{d.value > 0 ? d.value : ""}</div>
          <div style={{ width: "100%", flex: 1, display: "flex", alignItems: "flex-end", background: `${color}10`, borderRadius: "6px 6px 0 0" }}>
            <div style={{
              width: "100%",
              background: `linear-gradient(180deg, ${color}, ${color}cc)`,
              borderRadius: "6px 6px 0 0",
              height: `${Math.max((d.value / max) * 100, d.value > 0 ? 8 : 0)}%`,
              transition: "height 1s cubic-bezier(.4,0,.2,1)",
              boxShadow: d.value > 0 ? `0 4px 12px ${color}40` : "none",
            }} />
          </div>
          <div style={{ fontSize: 10, color: "#9ca3af", textAlign: "center" }}>{d.label}</div>
        </div>
      ))}
    </div>
  );
}

function DonutRing({ value, total, color, label, size = 80 }) {
  const pct = total > 0 ? value / total : 0;
  const r = (size / 2) - 8;
  const circ = 2 * Math.PI * r;
  const dash = circ * pct;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <div style={{ position: "relative", width: size, height: size }}>
        <svg width={size} height={size}>
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#f3f4f6" strokeWidth={8} />
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={8}
            strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
            transform={`rotate(-90 ${size/2} ${size/2})`} />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 16, fontWeight: 800, color: "#1a1a2e", fontFamily: "Syne,sans-serif" }}>{value}</span>
        </div>
      </div>
      <div style={{ fontSize: 11, color: "#6b7280", textAlign: "center" }}>{label}</div>
    </div>
  );
}

function ProgressBar({ label, value, max, color }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 13, color: "#4b5563", fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color }}>{value}</span>
      </div>
      <div style={{ background: "#f3f4f6", borderRadius: 6, height: 8 }}>
        <div style={{ background: `linear-gradient(90deg, ${color}, ${color}aa)`, borderRadius: 6, height: "100%", width: `${pct}%`, transition: "width 1s cubic-bezier(.4,0,.2,1)", boxShadow: `0 2px 8px ${color}40` }} />
      </div>
    </div>
  );
}

export default function Analytics({ user, team, onBack }) {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("month");

  useEffect(() => { fetchData(); }, [team, period]);

  const fetchData = async () => {
    setLoading(true);
    try {
      let query = supabase.from("invoices").select("*");
      if (team) {
        query = query.eq("team_id", team.id);
      } else {
        query = query.eq("user_id", user.id);
      }
      const now = new Date();
      if (period === "week") query = query.gte("created_at", new Date(now - 7*24*60*60*1000).toISOString());
      else if (period === "month") query = query.gte("created_at", new Date(now.getFullYear(), now.getMonth(), 1).toISOString());
      else if (period === "quarter") query = query.gte("created_at", new Date(now.getFullYear(), now.getMonth()-3, 1).toISOString());
      const { data } = await query.order("created_at", { ascending: true });
      setInvoices(data || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const total = invoices.length;
  const totalAmount = invoices.reduce((s, i) => s + (i.total || 0), 0);
  const pushed = invoices.filter(i => i.status === "pushed").length;
  const pending = invoices.filter(i => i.status === "pending").length;
  const rejected = invoices.filter(i => i.status === "rejected").length;
  const matched = invoices.filter(i => i.match_status === "matched").length;
  const autoApproved = invoices.filter(i => i.agent_decision === "auto_approved").length;
  const escalated = invoices.filter(i => i.agent_decision === "escalated").length;
  const timeSaved = Math.round((total * 15) / 60);
  const matchRate = total > 0 ? Math.round((matched / total) * 100) : 0;

  const dailyData = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i));
    const dayStr = d.toISOString().split("T")[0];
    return { label: d.toLocaleDateString("en", { weekday: "short" }), value: invoices.filter(inv => inv.created_at?.startsWith(dayStr)).length };
  });

  const vendorMap = {};
  invoices.forEach(i => { const v = i.vendor_name || "Unknown"; vendorMap[v] = (vendorMap[v] || 0) + 1; });
  const topVendors = Object.entries(vendorMap).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const VCOLORS = [ORANGE, BLUE, GREEN, PURPLE, AMBER];

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px", fontFamily: "DM Sans,sans-serif", background: "#f8f9fc", minHeight: "100vh" }}>
      <button onClick={onBack} style={{ background: "none", border: "none", color: "#9ca3af", fontSize: 13, cursor: "pointer", marginBottom: 20, fontFamily: "DM Sans,sans-serif" }}>← Dashboard</button>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontFamily: "Syne,sans-serif", fontSize: 28, fontWeight: 800, color: "#1a1a2e", margin: 0 }}>📈 Analytics</h1>
          <p style={{ color: "#9ca3af", fontSize: 14, margin: "4px 0 0" }}>{team?.name || "Personal"} · Invoice Intelligence Dashboard</p>
        </div>
        <div style={{ display: "flex", gap: 4, background: "#fff", border: "1px solid #e5e7eb", padding: 4, borderRadius: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
          {["week", "month", "quarter", "all"].map(p => (
            <button key={p} onClick={() => setPeriod(p)} style={{
              background: period === p ? ORANGE : "transparent",
              border: "none", padding: "7px 16px", borderRadius: 8, fontSize: 13,
              fontWeight: 500, color: period === p ? "#fff" : "#6b7280",
              cursor: "pointer", transition: "all 0.2s", fontFamily: "DM Sans,sans-serif"
            }}>{p.charAt(0).toUpperCase() + p.slice(1)}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 80, color: "#9ca3af" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⏳</div>
          <div>Loading analytics...</div>
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div style={{ display: "flex", gap: 14, marginBottom: 20, flexWrap: "wrap" }}>
            <KpiCard icon="📄" label="Total Invoices" value={total} trend={total > 0 ? "Active" : null} bg="#fff7f4" color={ORANGE} />
            <KpiCard icon="💰" label="Amount Processed" value={`$${Number(totalAmount).toFixed(0)}`} sub="This period" bg="#eff6ff" color={BLUE} />
            <KpiCard icon="⏱️" label="Hours Saved" value={`${timeSaved}h`} trend="vs manual" bg="#f0fdf4" color={GREEN} />
            <KpiCard icon="🎯" label="PO Match Rate" value={`${matchRate}%`} sub="Accuracy" bg="#faf5ff" color={PURPLE} />
          </div>

          {/* Charts Row 1 */}
          <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 16, marginBottom: 16 }}>
            {/* Bar Chart */}
            <div style={{ background: "#fff", borderRadius: 16, padding: "24px 24px 16px", boxShadow: "0 2px 12px rgba(0,0,0,0.06)", border: "1px solid #f0f0f0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
                <div>
                  <div style={{ fontFamily: "Syne,sans-serif", fontWeight: 700, fontSize: 16, color: "#1a1a2e" }}>Invoice Volume</div>
                  <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>Daily invoices processed</div>
                </div>
                <div style={{ background: "#fff7f4", color: ORANGE, padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600 }}>Last 7 days</div>
              </div>
              <BarChart data={dailyData} color={ORANGE} height={150} />
            </div>

            {/* Donut Status */}
            <div style={{ background: "#fff", borderRadius: 16, padding: "24px", boxShadow: "0 2px 12px rgba(0,0,0,0.06)", border: "1px solid #f0f0f0" }}>
              <div style={{ fontFamily: "Syne,sans-serif", fontWeight: 700, fontSize: 16, color: "#1a1a2e", marginBottom: 4 }}>Invoice Status</div>
              <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 20 }}>Processing breakdown</div>
              <div style={{ display: "flex", justifyContent: "space-around", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                <DonutRing value={pushed} total={total} color={GREEN} label="Pushed" size={88} />
                <DonutRing value={pending} total={total} color={AMBER} label="Pending" size={88} />
                <DonutRing value={rejected} total={total} color="#ef4444" label="Rejected" size={88} />
              </div>
            </div>
          </div>

          {/* Charts Row 2 */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
            {/* AI Agent */}
            <div style={{ background: "#0f172a", borderRadius: 16, padding: "24px", boxShadow: "0 4px 20px rgba(15,23,42,0.15)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <div style={{ fontSize: 20 }}>🤖</div>
                <div>
                  <div style={{ fontFamily: "Syne,sans-serif", fontWeight: 700, fontSize: 16, color: "#fff" }}>AI Agent Performance</div>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>Automated decisions this period</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 12, margin: "20px 0" }}>
                {[
                  { label: "Auto Approved", value: autoApproved, color: "#22c55e", bg: "rgba(34,197,94,0.1)" },
                  { label: "Escalated", value: escalated, color: "#f59e0b", bg: "rgba(245,158,11,0.1)" },
                  { label: "PO Matched", value: matched, color: "#3b82f6", bg: "rgba(59,130,246,0.1)" },
                ].map((s, i) => (
                  <div key={i} style={{ flex: 1, background: s.bg, borderRadius: 12, padding: "16px 12px", textAlign: "center" }}>
                    <div style={{ fontFamily: "Syne,sans-serif", fontSize: 28, fontWeight: 800, color: s.color }}>{s.value}</div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>{s.label}</div>
                  </div>
                ))}
              </div>
              <ProgressBar label="Auto Approval Rate" value={autoApproved} max={total} color="#22c55e" />
              <ProgressBar label="PO Match Rate" value={matched} max={total} color="#3b82f6" />
              <ProgressBar label="Escalation Rate" value={escalated} max={total} color="#f59e0b" />
            </div>

            {/* Top Vendors */}
            <div style={{ background: "#fff", borderRadius: 16, padding: "24px", boxShadow: "0 2px 12px rgba(0,0,0,0.06)", border: "1px solid #f0f0f0" }}>
              <div style={{ fontFamily: "Syne,sans-serif", fontWeight: 700, fontSize: 16, color: "#1a1a2e", marginBottom: 4 }}>🏆 Top Vendors</div>
              <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 20 }}>By invoice volume</div>
              {topVendors.length > 0 ? topVendors.map(([name, count], i) => (
                <div key={i} style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: VCOLORS[i], flexShrink: 0 }} />
                      <span style={{ fontSize: 13, color: "#1a1a2e", fontWeight: 500 }}>{name}</span>
                    </div>
                    <span style={{ fontSize: 12, color: "#9ca3af", background: "#f3f4f6", padding: "2px 8px", borderRadius: 20 }}>{count} inv</span>
                  </div>
                  <div style={{ background: "#f3f4f6", borderRadius: 6, height: 8 }}>
                    <div style={{ background: VCOLORS[i], borderRadius: 6, height: "100%", width: `${(count / topVendors[0][1]) * 100}%`, transition: "width 1s cubic-bezier(.4,0,.2,1)", boxShadow: `0 2px 6px ${VCOLORS[i]}50` }} />
                  </div>
                </div>
              )) : (
                <div style={{ textAlign: "center", padding: "30px 0", color: "#9ca3af", fontSize: 13 }}>No vendor data yet — process your first invoice!</div>
              )}
            </div>
          </div>

          {/* Savings Banner */}
          <div style={{ background: "linear-gradient(135deg,#1a1a2e,#2d1b69)", borderRadius: 16, padding: "28px 32px", boxShadow: "0 4px 20px rgba(26,26,46,0.2)" }}>
            <div style={{ fontFamily: "Syne,sans-serif", fontSize: 16, fontWeight: 700, color: "#fff", marginBottom: 20 }}>💰 Estimated Savings This Period</div>
            <div style={{ display: "flex", gap: 0, flexWrap: "wrap" }}>
              {[
                { label: "Hours Saved", value: `${timeSaved}h`, icon: "⏱️", color: "#22c55e" },
                { label: "Cost Savings", value: `$${(total * 25).toLocaleString()}`, icon: "💵", color: "#f59e0b" },
                { label: "Approval Rate", value: `${total > 0 ? Math.round((pushed/total)*100) : 0}%`, icon: "✅", color: "#3b82f6" },
                { label: "AI Automated", value: `${autoApproved}`, icon: "🤖", color: ORANGE },
              ].map((s, i, arr) => (
                <div key={i} style={{ flex: 1, minWidth: 140, padding: "0 24px", borderRight: i < arr.length - 1 ? "1px solid rgba(255,255,255,0.08)" : "none", textAlign: "center" }}>
                  <div style={{ fontSize: 24, marginBottom: 8 }}>{s.icon}</div>
                  <div style={{ fontFamily: "Syne,sans-serif", fontSize: 28, fontWeight: 800, color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
