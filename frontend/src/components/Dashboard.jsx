import { useEffect, useState } from "react";
import { supabase } from "../supabase";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

const STATUS_COLORS = {
  pending:  { bg:"#fef9c3", color:"#92400e" },
  approved: { bg:"#dcfce7", color:"#16a34a" },
  rejected: { bg:"#fee2e2", color:"#dc2626" },
  pushed:   { bg:"#dbeafe", color:"#1d4ed8" },
};

const MATCH_COLORS = {
  matched:   { bg:"#dcfce7", color:"#16a34a" },
  partial:   { bg:"#fef9c3", color:"#92400e" },
  mismatch:  { bg:"#fee2e2", color:"#dc2626" },
  unmatched: { bg:"#f3f4f6", color:"#6b7280" },
  no_po:     { bg:"#f3f4f6", color:"#6b7280" },
};

function StatCard({ icon, label, value, sub, accent }) {
  return (
    <div className="stat-card">
      <div className="stat-card-icon" style={{ background:accent+"18", color:accent }}>{icon}</div>
      <div className="stat-card-body">
        <div className="stat-card-value">{value}</div>
        <div className="stat-card-label">{label}</div>
        {sub && <div className="stat-card-sub">{sub}</div>}
      </div>
    </div>
  );
}

export default function Dashboard({ user, team, teams, onTeamChange, onNewInvoice, onSignOut, onSettings, onTeam, onPOs, onBilling, onERP }) {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");

  const firstName = user.user_metadata?.full_name?.split(" ")[0] || user.email?.split("@")[0];

  useEffect(() => { fetchInvoices(); }, [team]);

  const fetchInvoices = async () => {
    setLoading(true);
    let query = supabase.from("invoices").select("*").eq("user_id", user.id);
    if (team) query = query.eq("team_id", team.id);
    const { data } = await query.order("created_at", { ascending: false });
    setInvoices(data || []);
    setLoading(false);
  };

  const createTeam = async (e) => {
    e.preventDefault();
    if (!newTeamName.trim()) return;
    try {
      const res = await fetch(`${API}/api/teams`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newTeamName, userId: user.id }),
      });
      const data = await res.json();
      if (data.success) { window.location.reload(); }
    } catch (e) { alert("Error creating team: " + e.message); }
  };

  const filtered = filter === "all" ? invoices : invoices.filter(i => i.status === filter);
  const totalAmount = invoices.reduce((s,i) => s+(i.total||0), 0);
  const pending = invoices.filter(i=>i.status==="pending").length;
  const pushed = invoices.filter(i=>i.status==="pushed").length;
  const matched = invoices.filter(i=>i.match_status==="matched").length;

  return (
    <div className="dashboard">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">Invoice<span>IQ</span></div>

        {/* Team selector */}
        {teams?.length > 0 && (
          <div className="team-selector">
            <div className="team-selector-label">Workspace</div>
            <select className="team-select" value={team?.id || ""} onChange={e => onTeamChange(teams?.find(t=>t.id===e.target.value))}>
              {(teams || []).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        )}

        <nav className="sidebar-nav">
          <div className="nav-item active">📊 Dashboard</div>
          <div className="nav-item" onClick={onNewInvoice}>📄 New Invoice</div>
          <div className="nav-item" onClick={onPOs}>📋 Purchase Orders</div>
          {team && <div className="nav-item" onClick={onTeam}>👥 Team</div>}
          <div className="nav-item" onClick={onERP}>🔗 ERP Connections</div>
          <div className="nav-item" onClick={onBilling}>💳 Billing</div>
          <div className="nav-item" onClick={onSettings}>⚙️ Settings</div>
        </nav>

        <div className="sidebar-user">
          <div className="sidebar-avatar">{firstName?.[0]?.toUpperCase()}</div>
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">{firstName}</div>
            <div className="sidebar-user-email">{user.email}</div>
          </div>
        <button className="signout-btn" onClick={onSignOut} title="Sign out">
            Sign out
          </button>
        </div>
      </aside>

      <main className="dash-main">
        {/* Header */}
        <div className="dash-header">
          <div>
            <h1 className="dash-title">Good morning, {firstName} 👋</h1>
            <p className="dash-sub">{team ? `${team.name} workspace` : "Your invoice processing overview"}</p>
          </div>
          <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
            {!team && (
              <button className="btn-secondary-action" onClick={() => setCreatingTeam(true)}>+ Create Team</button>
            )}
            <button className="btn-approve" onClick={onNewInvoice}>+ Process Invoice</button>
          </div>
        </div>

        {/* Create team prompt */}
        {!team && !creatingTeam && (
          <div className="onboarding-card">
            <div style={{ fontSize:36, marginBottom:12 }}>👥</div>
            <div style={{ fontFamily:"Syne,sans-serif", fontWeight:700, fontSize:18, marginBottom:6 }}>Create a Team Workspace</div>
            <p style={{ color:"var(--muted)", fontSize:14, marginBottom:16, lineHeight:1.6 }}>Collaborate with your finance team, share purchase orders, and manage invoices together.</p>
            <button className="btn-approve" onClick={() => setCreatingTeam(true)}>Create Team →</button>
          </div>
        )}

        {creatingTeam && (
          <div className="settings-card" style={{ marginBottom:24 }}>
            <div className="settings-card-title">Create New Team</div>
            <div className="settings-card-body">
              <form onSubmit={createTeam} style={{ display:"flex", gap:10 }}>
                <input className="settings-input" style={{ flex:1 }} type="text" placeholder="e.g. Acme Finance Team" value={newTeamName} onChange={e=>setNewTeamName(e.target.value)} required />
                <button className="btn-approve" type="submit">Create</button>
                <button className="btn-secondary-action" type="button" onClick={()=>setCreatingTeam(false)}>Cancel</button>
              </form>
            </div>
          </div>
        )}

        {/* Stats */}
        <div className="stats-grid">
          <StatCard icon="📄" label="Total Invoices" value={invoices.length} sub="All time" accent="#e8531a" />
          <StatCard icon="💰" label="Total Processed" value={`$${totalAmount.toLocaleString("en-US",{minimumFractionDigits:0})}`} sub="This month" accent="#1a6be8" />
          <StatCard icon="✅" label="PO Matched" value={matched} sub={`of ${invoices.length} invoices`} accent="#16a34a" />
          <StatCard icon="⏳" label="Pending Review" value={pending} sub={pending>0?"Needs attention":"All clear!"} accent="#f59e0b" />
        </div>

        {/* Invoice table */}
        <div className="invoices-section">
          <div className="invoices-header">
            <div className="invoices-title">Recent Invoices</div>
            <div className="filter-tabs">
              {["all","pending","pushed","rejected"].map(f => (
                <button key={f} className={`filter-tab ${filter===f?"active":""}`} onClick={() => setFilter(f)}>
                  {f.charAt(0).toUpperCase()+f.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="table-loading">Loading invoices...</div>
          ) : filtered.length === 0 ? (
            <div className="table-empty">
              <div className="table-empty-icon">📭</div>
              <div className="table-empty-title">{filter==="all"?"No invoices yet":`No ${filter} invoices`}</div>
              <div className="table-empty-sub">{filter==="all"?"Upload your first invoice to get started":"Try a different filter"}</div>
              {filter==="all" && <button className="btn-approve" style={{marginTop:16}} onClick={onNewInvoice}>Process First Invoice →</button>}
            </div>
          ) : (
            <div className="invoices-table-wrap">
              <table className="invoices-table">
                <thead>
                  <tr>
                    <th>Invoice #</th>
                    <th>Vendor</th>
                    <th>Date</th>
                    <th>Amount</th>
                    <th>PO Match</th>
                    <th>Status</th>
                    <th>ERP Ref</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(inv => {
                    const sc = STATUS_COLORS[inv.status] || STATUS_COLORS.pending;
                    const mc = MATCH_COLORS[inv.match_status] || MATCH_COLORS.unmatched;
                    return (
                      <tr key={inv.id}>
                        <td className="inv-num">{inv.invoice_number||"—"}</td>
                        <td className="inv-vendor">{inv.vendor_name||"—"}</td>
                        <td className="inv-date">{inv.invoice_date||"—"}</td>
                        <td className="inv-amount">${Number(inv.total||0).toLocaleString("en-US",{minimumFractionDigits:2})}</td>
                        <td><span className="status-badge" style={{background:mc.bg,color:mc.color}}>{(inv.match_status||"unmatched").replace(/_/g," ")}</span></td>
                        <td><span className="status-badge" style={{background:sc.bg,color:sc.color}}>{inv.status}</span></td>
                        <td className="inv-erp">{inv.erp_reference||"—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
