import { useState, useEffect } from "react";
import { supabase } from "../supabase";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

function StatCard({ label, value, sub, color, icon }) {
  return (
    <div style={{ background:"#fff", border:"1px solid #e5e7eb", borderRadius:14, padding:"20px 22px", flex:1 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
        <div style={{ fontSize:20 }}>{icon}</div>
        <div style={{ background:`${color}15`, color, padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:600 }}>{sub}</div>
      </div>
      <div style={{ fontFamily:"Syne,sans-serif", fontSize:32, fontWeight:800, color:"#1a1a2e", lineHeight:1 }}>{value}</div>
      <div style={{ fontSize:12, color:"#9ca3af", marginTop:6, textTransform:"uppercase", letterSpacing:"0.5px" }}>{label}</div>
    </div>
  );
}

function BarChart({ data, color }) {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div style={{ display:"flex", alignItems:"flex-end", gap:8, height:120, paddingTop:8 }}>
      {data.map((d, i) => (
        <div key={i} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
          <div style={{ fontSize:10, color:"#9ca3af", fontWeight:600 }}>{d.value || ""}</div>
          <div style={{ width:"100%", background:`${color}20`, borderRadius:"4px 4px 0 0", position:"relative", height:90 }}>
            <div style={{
              position:"absolute", bottom:0, left:0, right:0,
              background:color, borderRadius:"4px 4px 0 0",
              height:`${(d.value / max) * 100}%`,
              transition:"height 0.8s ease",
              minHeight: d.value > 0 ? 4 : 0,
            }} />
          </div>
          <div style={{ fontSize:10, color:"#9ca3af", textAlign:"center", whiteSpace:"nowrap" }}>{d.label}</div>
        </div>
      ))}
    </div>
  );
}

function DonutChart({ segments, size = 120 }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return (
    <div style={{ width:size, height:size, borderRadius:"50%", background:"#f3f4f6", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, color:"#9ca3af" }}>No data</div>
  );

  let cumulative = 0;
  const r = size / 2 - 10;
  const cx = size / 2;
  const cy = size / 2;

  const paths = segments.map(seg => {
    const pct = seg.value / total;
    const startAngle = (cumulative * 360 - 90) * (Math.PI / 180);
    const endAngle = ((cumulative + pct) * 360 - 90) * (Math.PI / 180);
    cumulative += pct;

    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy + r * Math.sin(endAngle);
    const largeArc = pct > 0.5 ? 1 : 0;

    return { path: `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`, color: seg.color };
  });

  return (
    <svg width={size} height={size}>
      {paths.map((p, i) => <path key={i} d={p.path} fill={p.color} />)}
      <circle cx={cx} cy={cy} r={r * 0.55} fill="white" />
      <text x={cx} y={cy + 5} textAnchor="middle" fontSize="14" fontWeight="bold" fill="#1a1a2e">{total}</text>
    </svg>
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
      let query = supabase.from("invoices").select("*").eq("user_id", user.id);
      if (team) query = query.eq("team_id", team.id);

      const now = new Date();
      if (period === "week") {
        const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
        query = query.gte("created_at", weekAgo);
      } else if (period === "month") {
        const monthAgo = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        query = query.gte("created_at", monthAgo);
      } else if (period === "quarter") {
        const quarterAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1).toISOString();
        query = query.gte("created_at", quarterAgo);
      }

      const { data } = await query.order("created_at", { ascending: true });
      setInvoices(data || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  // Computed stats
  const total = invoices.length;
  const totalAmount = invoices.reduce((s, i) => s + (i.total || 0), 0);
  const pushed = invoices.filter(i => i.status === "pushed").length;
  const pending = invoices.filter(i => i.status === "pending").length;
  const matched = invoices.filter(i => i.match_status === "matched").length;
  const autoApproved = invoices.filter(i => i.agent_decision === "auto_approved").length;
  const escalated = invoices.filter(i => i.agent_decision === "escalated").length;
  const timeSaved = Math.round((total * 15) / 60);
  const matchRate = total > 0 ? Math.round((matched / total) * 100) : 0;
  const approvalRate = total > 0 ? Math.round((pushed / total) * 100) : 0;

  // Daily chart data (last 7 days)
  const dailyData = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const dayStr = d.toISOString().split("T")[0];
    const count = invoices.filter(inv => inv.created_at?.startsWith(dayStr)).length;
    return { label: d.toLocaleDateString("en", { weekday: "short" }), value: count };
  });

  // Vendor breakdown
  const vendorMap = {};
  invoices.forEach(i => {
    const v = i.vendor_name || "Unknown";
    vendorMap[v] = (vendorMap[v] || 0) + 1;
  });
  const topVendors = Object.entries(vendorMap).sort((a, b) => b[1] - a[1]).slice(0, 5);

  // Currency breakdown
  const currencyMap = {};
  invoices.forEach(i => {
    const c = i.raw_data?.currency || "USD";
    currencyMap[c] = (currencyMap[c] || 0) + (i.total || 0);
  });

  const COLORS = ["#e8531a", "#1d4ed8", "#16a34a", "#d97706", "#7c3aed"];

  return (
    <div style={{ maxWidth:1100, margin:"0 auto", padding:"32px 24px", fontFamily:"DM Sans,sans-serif" }}>
      <button onClick={onBack} style={{ background:"none", border:"none", color:"#9ca3af", fontSize:13, cursor:"pointer", marginBottom:20 }}>← Dashboard</button>

      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:28, flexWrap:"wrap", gap:12 }}>
        <div>
          <h1 style={{ fontFamily:"Syne,sans-serif", fontSize:26, fontWeight:800, marginBottom:4, color:"#1a1a2e" }}>📊 Analytics</h1>
          <p style={{ color:"#9ca3af", fontSize:14 }}>Invoice processing insights · {team?.name || "Personal"}</p>
        </div>
        <div style={{ display:"flex", gap:6, background:"#f3f4f6", padding:4, borderRadius:10 }}>
          {["week","month","quarter","all"].map(p => (
            <button key={p} onClick={() => setPeriod(p)} style={{
              background: period === p ? "#fff" : "transparent",
              border: "none", padding:"6px 14px", borderRadius:8, fontSize:13,
              fontWeight: period === p ? 600 : 400,
              color: period === p ? "#1a1a2e" : "#9ca3af",
              cursor:"pointer", boxShadow: period === p ? "0 1px 4px rgba(0,0,0,0.1)" : "none",
              fontFamily:"DM Sans,sans-serif"
            }}>{p.charAt(0).toUpperCase() + p.slice(1)}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign:"center", padding:60, color:"#9ca3af" }}>Loading analytics...</div>
      ) : (
        <>
          {/* Stat Cards */}
          <div style={{ display:"flex", gap:14, marginBottom:20, flexWrap:"wrap" }}>
            <StatCard icon="📄" label="Total Invoices" value={total} sub="All time" color="#e8531a" />
            <StatCard icon="💰" label="Total Processed" value={`$${Number(totalAmount).toFixed(0)}`} sub="Amount" color="#1d4ed8" />
            <StatCard icon="⏱️" label="Time Saved" value={`${timeSaved}h`} sub="vs manual" color="#16a34a" />
            <StatCard icon="🎯" label="PO Match Rate" value={`${matchRate}%`} sub="Accuracy" color="#7c3aed" />
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:16 }}>
            {/* Daily Invoice Chart */}
            <div style={{ background:"#fff", border:"1px solid #e5e7eb", borderRadius:14, padding:"22px 24px" }}>
              <div style={{ fontFamily:"Syne,sans-serif", fontWeight:700, fontSize:15, marginBottom:4, color:"#1a1a2e" }}>Invoice Volume</div>
              <div style={{ fontSize:12, color:"#9ca3af", marginBottom:16 }}>Daily invoices — last 7 days</div>
              <BarChart data={dailyData} color="#e8531a" />
            </div>

            {/* Status Breakdown */}
            <div style={{ background:"#fff", border:"1px solid #e5e7eb", borderRadius:14, padding:"22px 24px" }}>
              <div style={{ fontFamily:"Syne,sans-serif", fontWeight:700, fontSize:15, marginBottom:4, color:"#1a1a2e" }}>Status Breakdown</div>
              <div style={{ fontSize:12, color:"#9ca3af", marginBottom:16 }}>Invoice processing status</div>
              <div style={{ display:"flex", alignItems:"center", gap:24 }}>
                <DonutChart segments={[
                  { value: pushed, color: "#16a34a" },
                  { value: pending, color: "#d97706" },
                  { value: invoices.filter(i => i.status === "rejected").length, color: "#dc2626" },
                ]} />
                <div style={{ flex:1, display:"flex", flexDirection:"column", gap:10 }}>
                  {[
                    { label:"Pushed to ERP", value: pushed, color:"#16a34a" },
                    { label:"Pending", value: pending, color:"#d97706" },
                    { label:"Rejected", value: invoices.filter(i => i.status === "rejected").length, color:"#dc2626" },
                  ].map((s, i) => (
                    <div key={i} style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <div style={{ width:10, height:10, borderRadius:"50%", background:s.color, flexShrink:0 }} />
                      <div style={{ flex:1, fontSize:13, color:"#6b7280" }}>{s.label}</div>
                      <div style={{ fontSize:13, fontWeight:700, color:"#1a1a2e" }}>{s.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:16 }}>
            {/* AI Agent Performance */}
            <div style={{ background:"#0a0f1e", border:"1px solid rgba(255,255,255,0.08)", borderRadius:14, padding:"22px 24px" }}>
              <div style={{ fontFamily:"Syne,sans-serif", fontWeight:700, fontSize:15, marginBottom:4, color:"#fff" }}>🤖 AI Agent Performance</div>
              <div style={{ fontSize:12, color:"rgba(255,255,255,0.3)", marginBottom:20 }}>Automated decision making</div>
              <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
                {[
                  { label:"Auto Approved", value: autoApproved, total, color:"#22c55e" },
                  { label:"Escalated", value: escalated, total, color:"#f59e0b" },
                  { label:"PO Matched", value: matched, total, color:"#3b82f6" },
                ].map((item, i) => (
                  <div key={i}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                      <span style={{ fontSize:13, color:"rgba(255,255,255,0.6)" }}>{item.label}</span>
                      <span style={{ fontSize:13, fontWeight:700, color:item.color }}>{item.value}</span>
                    </div>
                    <div style={{ background:"rgba(255,255,255,0.08)", borderRadius:4, height:6 }}>
                      <div style={{ background:item.color, borderRadius:4, height:"100%", width:`${item.total > 0 ? (item.value / item.total) * 100 : 0}%`, transition:"width 0.8s ease" }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Top Vendors */}
            <div style={{ background:"#fff", border:"1px solid #e5e7eb", borderRadius:14, padding:"22px 24px" }}>
              <div style={{ fontFamily:"Syne,sans-serif", fontWeight:700, fontSize:15, marginBottom:4, color:"#1a1a2e" }}>🏆 Top Vendors</div>
              <div style={{ fontSize:12, color:"#9ca3af", marginBottom:16 }}>By invoice count</div>
              {topVendors.length > 0 ? (
                <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                  {topVendors.map(([name, count], i) => (
                    <div key={i}>
                      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                        <span style={{ fontSize:13, color:"#1a1a2e", fontWeight:500 }}>{name}</span>
                        <span style={{ fontSize:13, color:"#9ca3af" }}>{count} inv</span>
                      </div>
                      <div style={{ background:"#f3f4f6", borderRadius:4, height:6 }}>
                        <div style={{ background:COLORS[i % COLORS.length], borderRadius:4, height:"100%", width:`${(count / (topVendors[0][1])) * 100}%`, transition:"width 0.8s ease" }} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ textAlign:"center", padding:20, color:"#9ca3af", fontSize:13 }}>No vendor data yet</div>
              )}
            </div>
          </div>

          {/* Savings Summary */}
          <div style={{ background:"linear-gradient(135deg,#f0fdf4,#dcfce7)", border:"1px solid #bbf7d0", borderRadius:14, padding:"24px 28px" }}>
            <div style={{ fontFamily:"Syne,sans-serif", fontWeight:700, fontSize:15, color:"#16a34a", marginBottom:16 }}>💰 Estimated Savings</div>
            <div style={{ display:"flex", gap:32, flexWrap:"wrap" }}>
              {[
                { label:"Hours Saved vs Manual", value:`${timeSaved}h` },
                { label:"Staff Cost Saved", value:`$${(total * 25).toLocaleString()}` },
                { label:"Approval Rate", value:`${approvalRate}%` },
                { label:"Invoices Automated", value:`${autoApproved}` },
              ].map((s, i) => (
                <div key={i}>
                  <div style={{ fontFamily:"Syne,sans-serif", fontSize:24, fontWeight:800, color:"#16a34a" }}>{s.value}</div>
                  <div style={{ fontSize:12, color:"#15803d", marginTop:2 }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
