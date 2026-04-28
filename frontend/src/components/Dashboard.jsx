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
  matched:   { bg:"#dcfce7", color:"#16a34a", label:"Matched" },
  partial:   { bg:"#fef9c3", color:"#92400e", label:"Partial" },
  mismatch:  { bg:"#fee2e2", color:"#dc2626", label:"Mismatch" },
  unmatched: { bg:"#fee2e2", color:"#dc2626", label:"Unmatched" },
  non_po:    { bg:"#e0e7ff", color:"#4338ca", label:"Non-PO" },
  no_po:     { bg:"#e0e7ff", color:"#4338ca", label:"Non-PO" },
};

const PAYMENT_COLORS = {
  unpaid:    { bg:"#ffedd5", color:"#c2410c", label:"Unpaid" },
  scheduled: { bg:"#dbeafe", color:"#1d4ed8", label:"Scheduled" },
  partial:   { bg:"#fef9c3", color:"#92400e", label:"Partial" },
  paid:      { bg:"#dcfce7", color:"#16a34a", label:"Paid" },
  overdue:   { bg:"#fee2e2", color:"#dc2626", label:"Overdue" },
  cancelled: { bg:"#f3f4f6", color:"#6b7280", label:"Cancelled" },
};

function StatCard({ icon, label, value, sub, accent, multiLine }) {
  return (
    <div className="stat-card">
      <div className="stat-card-icon" style={{ background:accent+"18", color:accent }}>{icon}</div>
      <div className="stat-card-body">
        {multiLine ? (
          <div style={{ display:"flex", flexDirection:"column", gap:2 }}>
            {value.map((v, i) => (
              <div key={i} style={{ fontSize: value.length > 2 ? 16 : 20, fontWeight:800, color:"var(--ink)", lineHeight:1.2 }}>{v}</div>
            ))}
          </div>
        ) : (
          <div className="stat-card-value">{value}</div>
        )}
        <div className="stat-card-label">{label}</div>
        {sub && <div className="stat-card-sub">{sub}</div>}
      </div>
    </div>
  );
}

export default function Dashboard({ user, team, teams, onTeamChange, onNewInvoice, onSignOut, onSettings, onTeam, onPOs, onBilling, onERP, onPrivacy, onTerms, onReport, onAnalytics, onEmailAgent, onBatchUpload, onSupport, onOnboarding }) {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [sortBy, setSortBy] = useState("created_at"); // default: newest first
  const [sortDir, setSortDir] = useState("desc"); // asc | desc

  const handleSort = (field) => {
    if (sortBy === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortDir("desc");
    }
  };

  const sortIcon = (field) => {
    if (sortBy !== field) return <span style={{ opacity: 0.3, marginLeft: 4, fontSize: 11 }}>↕</span>;
    return <span style={{ marginLeft: 4, fontSize: 11 }}>{sortDir === "asc" ? "↑" : "↓"}</span>;
  };
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [search, setSearch] = useState("");
  const [commentInvoice, setCommentInvoice] = useState(null); // invoice being commented on
  const [commentText, setCommentText] = useState("");
  const [comments, setComments] = useState({}); // { invoiceId: [comments] }
  const [savingComment, setSavingComment] = useState(false);
  const [auditInvoice, setAuditInvoice] = useState(null);
  const [auditLog, setAuditLog] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);

  // Mark-paid modal state
  const [paidInvoice, setPaidInvoice] = useState(null);
  const [paidForm, setPaidForm] = useState({ paymentDate: "", paymentMethod: "ACH", paymentReference: "", paidAmount: "" });
  const [savingPaid, setSavingPaid] = useState(false);

  const firstName = user.user_metadata?.full_name?.split(" ")[0] || user.email?.split("@")[0];

  useEffect(() => { fetchInvoices(); }, [team]);

  const fetchInvoices = async () => {
    setLoading(true);
    let query = supabase.from("invoices").select("*");
    if (team) {
      query = query.eq("team_id", team.id);
    } else {
      query = query.eq("user_id", user.id);
    }
    const { data } = await query.order("created_at", { ascending: false });
    setInvoices(data || []);
    setLoading(false);
  };

  const approveInvoice = async (invoiceId) => {
    try {
      const res = await fetch(`${API}/api/invoices/${invoiceId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: team?.id }),
      });
      const data = await res.json();
      if (data.success) fetchInvoices();
      else alert("Approval failed: " + data.error);
    } catch (e) { alert("Error: " + e.message); }
  };

  const rejectInvoice = async (invoiceId) => {
    if (!window.confirm("Reject this invoice? The supplier will be notified.")) return;
    try {
      const res = await fetch(`${API}/api/invoices/${invoiceId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: team?.id }),
      });
      const data = await res.json();
      if (data.success) fetchInvoices();
      else alert("Rejection failed: " + data.error);
    } catch (e) { alert("Error: " + e.message); }
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

  // ── SEARCH FILTER ─────────────────────────────────────────────
  const filtered = invoices.filter(inv => {
    const matchesFilter = filter === "all" || inv.status === filter;
    if (!search.trim()) return matchesFilter;
    const q = search.toLowerCase();
    return matchesFilter && (
      inv.invoice_number?.toLowerCase().includes(q) ||
      inv.vendor_name?.toLowerCase().includes(q) ||
      inv.erp_reference?.toLowerCase().includes(q) ||
      String(inv.total || "").includes(q)
    );
  }).sort((a, b) => {
    let aVal = a[sortBy];
    let bVal = b[sortBy];

    // Numeric sort for total
    if (sortBy === "total") {
      aVal = Number(aVal) || 0;
      bVal = Number(bVal) || 0;
      return sortDir === "asc" ? aVal - bVal : bVal - aVal;
    }

    // Date sort
    if (sortBy === "invoice_date" || sortBy === "created_at") {
      aVal = aVal ? new Date(aVal).getTime() : 0;
      bVal = bVal ? new Date(bVal).getTime() : 0;
      return sortDir === "asc" ? aVal - bVal : bVal - aVal;
    }

    // String sort (invoice_number, vendor_name, erp_reference, status, match_status)
    aVal = (aVal || "").toString().toLowerCase();
    bVal = (bVal || "").toString().toLowerCase();
    if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
    if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
    return 0;
  });

  // ── CSV EXPORT ─────────────────────────────────────────────────
  const exportCSV = () => {
    const rows = [
      ["Invoice #","Vendor","Date","Amount","Currency","PO Match","Status","ERP Reference","Created At"],
      ...invoices.map(inv => [
        inv.invoice_number || "",
        inv.vendor_name || "",
        inv.invoice_date || "",
        inv.total || 0,
        inv.raw_data?.currency || "USD",
        inv.match_status || "unmatched",
        inv.status || "",
        inv.erp_reference || "",
        inv.created_at ? new Date(inv.created_at).toLocaleDateString() : "",
      ])
    ];
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `billtiq-invoices-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── COMMENTS ───────────────────────────────────────────────────
  const loadComments = async (invoiceId) => {
    try {
      const { data } = await supabase.from("invoice_comments")
        .select("*").eq("invoice_id", invoiceId).order("created_at", { ascending: true });
      setComments(prev => ({ ...prev, [invoiceId]: data || [] }));
    } catch (e) { console.error("Load comments error:", e); }
  };

  const saveComment = async () => {
    if (!commentText.trim() || !commentInvoice) return;
    setSavingComment(true);
    try {
      const { data } = await supabase.from("invoice_comments").insert({
        invoice_id: commentInvoice.id,
        team_id: team?.id,
        user_id: user.id,
        user_email: user.email,
        comment: commentText.trim(),
        created_at: new Date().toISOString(),
      }).select().single();
      if (data) {
        setComments(prev => ({ ...prev, [commentInvoice.id]: [...(prev[commentInvoice.id] || []), data] }));
        setCommentText("");
      }
    } catch (e) { alert("Error saving comment: " + e.message); }
    setSavingComment(false);
  };

  const loadAudit = async (invoiceId) => {
    setAuditLoading(true);
    try {
      const res = await fetch(`${API}/api/invoices/${invoiceId}/audit`);
      const data = await res.json();
      setAuditLog(data.audit || []);
    } catch (e) { console.error("Audit load error:", e); }
    setAuditLoading(false);
  };

  const openAudit = (inv) => {
    setAuditInvoice(inv);
    setAuditLog([]);
    loadAudit(inv.id);
  };

  const openComments = (inv) => {
    setCommentInvoice(inv);
    setCommentText("");
    loadComments(inv.id);
  };

  // Mark-paid handlers
  const openMarkPaid = (inv) => {
    setPaidInvoice(inv);
    setPaidForm({
      paymentDate: new Date().toISOString().slice(0, 10),
      paymentMethod: "ACH",
      paymentReference: "",
      paidAmount: inv.total || "",
    });
  };

  const submitMarkPaid = async () => {
    if (!paidInvoice) return;
    setSavingPaid(true);
    try {
      const res = await fetch(`${API}/api/invoices/${paidInvoice.id}/mark-paid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamId: team.id,
          userId: user.id,
          userEmail: user.email,
          paymentDate: paidForm.paymentDate,
          paymentMethod: paidForm.paymentMethod,
          paymentReference: paidForm.paymentReference,
          paidAmount: parseFloat(paidForm.paidAmount) || paidInvoice.total,
        }),
      });
      const data = await res.json();
      if (data.success) {
        // Update local state
        setInvoices(prev => prev.map(i => i.id === paidInvoice.id ? { ...i, ...data.invoice } : i));
        setPaidInvoice(null);
      } else {
        alert(data.error || "Failed to mark as paid");
      }
    } catch (e) {
      alert("Error: " + e.message);
    }
    setSavingPaid(false);
  };

  // Setup completion for banner
  const setupSteps = { team: !!team, gmail: false, erp: false, invoice: invoices.length > 0 };
  const setupDone = Object.values(setupSteps).filter(Boolean).length;
  const setupTotal = Object.keys(setupSteps).length;
  const setupComplete = setupDone === setupTotal;
  const totalAmount = invoices.reduce((s,i) => s+(i.total||0), 0);
  const pending = invoices.filter(i=>i.status==="pending").length;
  const pushed = invoices.filter(i=>i.status==="pushed").length;
  const matched = invoices.filter(i=>i.match_status==="matched").length;

  return (
    <div className="dashboard">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">Bill<span>tiq</span></div>

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
          <div className="nav-item" onClick={onBatchUpload}>📦 Batch Upload</div>
          <div className="nav-item" onClick={onPOs}>📋 Purchase Orders</div>
          <div className="nav-item" onClick={onAnalytics}>📈 Analytics</div>
          <div className="nav-item" onClick={onEmailAgent}>📧 Email Agent</div>
          {team && team.role === "admin" && <div className="nav-item" onClick={onTeam}>👥 Team</div>}
          <div className="nav-item" onClick={onERP}>🔗 ERP Connections</div>
          {team && team.role === "admin" && <div className="nav-item" onClick={onBilling}>💳 Billing</div>}
          <div className="nav-item" onClick={onSettings}>⚙️ Settings</div>
          {team && team.role === "admin" && <div className="nav-item" onClick={onOnboarding} style={{ color:"rgba(232,83,26,0.8)" }}>🚀 Setup Guide</div>}
        </nav>

        <div style={{ padding: "0 16px 12px", display: "flex", gap: 12, fontSize: 11 }}>
          <span style={{ color: "rgba(245,242,235,0.3)", cursor: "pointer" }} onClick={onPrivacy}>Privacy</span>
          <span style={{ color: "rgba(245,242,235,0.3)" }}>·</span>
          <span style={{ color: "rgba(245,242,235,0.3)", cursor: "pointer" }} onClick={onTerms}>Terms</span>
        </div>

        {/* Need Help Button */}
        <div style={{ padding: "0 16px 12px" }}>
          <button
            onClick={onSupport}
            style={{ width:"100%", display:"flex", alignItems:"center", gap:8, background:"rgba(232,83,26,0.12)", border:"1px solid rgba(232,83,26,0.25)", color:"#f87c4f", padding:"10px 14px", borderRadius:10, fontSize:13, fontWeight:500, textDecoration:"none", transition:"all 0.2s", cursor:"pointer", fontFamily:"DM Sans,sans-serif" }}
            onMouseEnter={e => e.currentTarget.style.background = "rgba(232,83,26,0.2)"}
            onMouseLeave={e => e.currentTarget.style.background = "rgba(232,83,26,0.12)"}
          >
            <span style={{ fontSize:16 }}>🆘</span>
            <div style={{ textAlign:"left" }}>
              <div style={{ fontSize:13, fontWeight:600 }}>Need Help?</div>
              <div style={{ fontSize:11, color:"rgba(248,124,79,0.7)", marginTop:1 }}>Help & Support</div>
            </div>
          </button>
        </div>
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
            {!team && Array.isArray(teams) && teams.length === 0 && (
              <button className="btn-secondary-action" onClick={() => setCreatingTeam(true)}>+ Create Team</button>
            )}
            {team && (
              <button className="btn-secondary-action" onClick={onReport}>📊 Monthly Report</button>
            )}
            <button className="btn-approve" onClick={onNewInvoice}>+ Process Invoice</button>
          </div>
        </div>

        {/* Setup progress banner — shows until all steps complete */}
        {team && team.role === "admin" && !setupComplete && (
          <div style={{ background:"linear-gradient(135deg,#fff4f0,#fff8f5)", border:"1px solid #fcd3c0", borderRadius:14, padding:"16px 20px", marginBottom:20, display:"flex", alignItems:"center", gap:16 }}>
            <div style={{ fontSize:24 }}>🚀</div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:700, fontSize:14, color:"#0a0f1e", marginBottom:4 }}>
                Complete your setup — {setupDone} of {setupTotal} steps done
              </div>
              <div style={{ height:6, background:"#fcd3c0", borderRadius:100, overflow:"hidden", maxWidth:200 }}>
                <div style={{ height:"100%", width:`${(setupDone/setupTotal)*100}%`, background:"#e8531a", borderRadius:100, transition:"width 0.4s" }} />
              </div>
            </div>
            <button
              onClick={onOnboarding}
              style={{ background:"#e8531a", color:"white", border:"none", padding:"8px 16px", borderRadius:8, fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:"DM Sans,sans-serif", whiteSpace:"nowrap" }}
            >
              Continue Setup →
            </button>
            </div>
        )}

        {/* Create team prompt - only show if user has no teams at all */}
        {!team && !creatingTeam && Array.isArray(teams) && teams.length === 0 && (
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
          <StatCard icon="💰" label="Total Processed" multiLine value={(() => {
            const byCurrency = invoices.reduce((acc, inv) => {
              const cur = inv.raw_data?.currency || "USD";
              const sym = cur === "INR" ? "₹" : cur === "EUR" ? "€" : cur === "GBP" ? "£" : "$";
              acc[sym] = (acc[sym] || 0) + (inv.total || 0);
              return acc;
            }, {});
            const lines = Object.entries(byCurrency).map(([sym, amt]) => `${sym}${amt.toLocaleString("en-US",{minimumFractionDigits:2})}`);
            return lines.length ? lines : ["$0"];
          })()} sub="This month" accent="#1a6be8" />
          <StatCard icon="✅" label="PO Matched" value={matched} sub={`of ${invoices.length} invoices`} accent="#16a34a" />
          <StatCard icon="⏳" label="Pending Review" value={pending} sub={pending>0?"Needs attention":"All clear!"} accent="#f59e0b" />
        </div>

        {/* Invoice table */}
        <div className="invoices-section">
          <div className="invoices-header" style={{ flexWrap:"wrap", gap:10 }}>
            <div className="invoices-title">Recent Invoices</div>
            <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
              {/* Search */}
              <input
                placeholder="Search invoice #, vendor, amount..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ border:"1px solid #e2ddd4", borderRadius:8, padding:"7px 12px", fontSize:13, fontFamily:"DM Sans,sans-serif", background:"#f9fafb", width:220, outline:"none" }}
              />
              {/* Filter tabs */}
              <div className="filter-tabs">
                {["all","pending","pushed","rejected"].map(f => (
                  <button key={f} className={`filter-tab ${filter===f?"active":""}`} onClick={() => setFilter(f)}>
                    {f.charAt(0).toUpperCase()+f.slice(1)}
                  </button>
                ))}
              </div>
              {/* CSV Export */}
              <button
                onClick={exportCSV}
                style={{ background:"white", border:"1px solid #e2ddd4", color:"#374151", padding:"7px 14px", borderRadius:8, fontSize:12, fontWeight:500, cursor:"pointer", fontFamily:"DM Sans,sans-serif", whiteSpace:"nowrap" }}
              >⬇ Export CSV</button>
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
                    <th onClick={() => handleSort("invoice_number")} style={{ cursor: "pointer", userSelect: "none" }}>Invoice #{sortIcon("invoice_number")}</th>
                    <th onClick={() => handleSort("vendor_name")} style={{ cursor: "pointer", userSelect: "none" }}>Vendor{sortIcon("vendor_name")}</th>
                    <th onClick={() => handleSort("invoice_date")} style={{ cursor: "pointer", userSelect: "none" }}>Date{sortIcon("invoice_date")}</th>
                    <th onClick={() => handleSort("total")} style={{ cursor: "pointer", userSelect: "none" }}>Amount{sortIcon("total")}</th>
                    <th onClick={() => handleSort("match_status")} style={{ cursor: "pointer", userSelect: "none" }}>PO Match{sortIcon("match_status")}</th>
                    <th onClick={() => handleSort("status")} style={{ cursor: "pointer", userSelect: "none" }}>Status{sortIcon("status")}</th>
                    <th onClick={() => handleSort("payment_status")} style={{ cursor: "pointer", userSelect: "none" }}>Payment{sortIcon("payment_status")}</th>
                    <th onClick={() => handleSort("erp_reference")} style={{ cursor: "pointer", userSelect: "none" }}>ERP Ref{sortIcon("erp_reference")}</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(inv => {
                    const sc = STATUS_COLORS[inv.status] || STATUS_COLORS.pending;
                    const mc = MATCH_COLORS[inv.match_status] || MATCH_COLORS.unmatched;
                    const pc = PAYMENT_COLORS[inv.payment_status] || PAYMENT_COLORS.unpaid;
                    const cur = inv.raw_data?.currency || "USD";
                    const sym = cur === "INR" ? "₹" : cur === "EUR" ? "€" : cur === "GBP" ? "£" : "$";
                    const isAdmin = team?.role === "admin";
                    const showMarkPaid = isAdmin && inv.status === "pushed" && inv.payment_status !== "paid" && inv.payment_status !== "cancelled";
                    return (
                      <tr key={inv.id}>
                        <td className="inv-num">{inv.invoice_number||"—"}</td>
                        <td className="inv-vendor">{inv.vendor_name||"—"}</td>
                        <td className="inv-date">{inv.invoice_date||"—"}</td>
                        <td className="inv-amount">{sym}{Number(inv.total||0).toLocaleString("en-US",{minimumFractionDigits:2})}</td>
                        <td><span className="status-badge" style={{background:mc.bg,color:mc.color}}>{mc.label || (inv.match_status||"unmatched").replace(/_/g," ")}</span></td>
                        <td><span className="status-badge" style={{background:sc.bg,color:sc.color}}>{inv.status}</span></td>
                        <td>{inv.status === "pushed" ? <span className="status-badge" style={{background:pc.bg,color:pc.color}}>{pc.label}</span> : <span style={{color:"#9ca3af",fontSize:12}}>—</span>}</td>
                        <td className="inv-erp">{inv.erp_reference||"—"}</td>
                        <td>
                          {inv.status === "pending" && (
                            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                              <button
                                onClick={() => approveInvoice(inv.id)}
                                style={{ background:"#16a34a", color:"white", border:"none", padding:"4px 10px", borderRadius:6, fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:"DM Sans,sans-serif", whiteSpace:"nowrap" }}
                              >✓ Approve</button>
                              <button
                                onClick={() => rejectInvoice(inv.id)}
                                style={{ background:"transparent", color:"#dc2626", border:"1px solid #fecaca", padding:"4px 10px", borderRadius:6, fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:"DM Sans,sans-serif", whiteSpace:"nowrap" }}
                              >✗ Reject</button>
                              <button
                                onClick={() => openComments(inv)}
                                style={{ background:"none", border:"1px solid #e2ddd4", color:"#6b7280", padding:"4px 10px", borderRadius:6, fontSize:11, cursor:"pointer", fontFamily:"DM Sans,sans-serif" }}
                              >💬</button>
                              <button
                                onClick={() => openAudit(inv)}
                                style={{ background:"#f5f3ff", border:"1px solid #c4b5fd", color:"#7c3aed", padding:"4px 10px", borderRadius:6, fontSize:11, cursor:"pointer", fontFamily:"DM Sans,sans-serif" }}
                              >🕐</button>
                            </div>
                          )}
                          {inv.status !== "pending" && (
                            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                              {showMarkPaid && (
                                <button
                                  onClick={() => openMarkPaid(inv)}
                                  style={{ background:"#16a34a", color:"white", border:"none", padding:"4px 10px", borderRadius:6, fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:"DM Sans,sans-serif", whiteSpace:"nowrap" }}
                                >💰 Mark Paid</button>
                              )}
                              <button
                                onClick={() => openComments(inv)}
                                style={{ background:"none", border:"1px solid #e2ddd4", color:"#6b7280", padding:"4px 10px", borderRadius:6, fontSize:11, cursor:"pointer", fontFamily:"DM Sans,sans-serif" }}
                              >💬 Note</button>
                              <button
                                onClick={() => openAudit(inv)}
                                style={{ background:"#f5f3ff", border:"1px solid #c4b5fd", color:"#7c3aed", padding:"4px 10px", borderRadius:6, fontSize:11, cursor:"pointer", fontFamily:"DM Sans,sans-serif" }}
                              >🕐 History</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>


      {/* AUDIT HISTORY MODAL */}
      {auditInvoice && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.4)", zIndex:1001, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}
          onClick={e => e.target === e.currentTarget && setAuditInvoice(null)}>
          <div style={{ background:"white", borderRadius:20, padding:28, maxWidth:520, width:"100%", fontFamily:"DM Sans,sans-serif", maxHeight:"80vh", display:"flex", flexDirection:"column" }}>
            {/* Header */}
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:4 }}>
              <div>
                <div style={{ fontFamily:"Syne,sans-serif", fontWeight:800, fontSize:16, color:"#0a0f1e" }}>
                  Audit History — Invoice #{auditInvoice.invoice_number}
                </div>
                <div style={{ fontSize:12, color:"#6b7280", marginTop:2 }}>
                  {auditInvoice.vendor_name} · {auditInvoice.invoice_date} · {auditLog.length} events
                </div>
              </div>
              <button onClick={() => setAuditInvoice(null)} style={{ background:"none", border:"none", fontSize:20, cursor:"pointer", color:"#9ca3af" }}>×</button>
            </div>

            {/* Timeline */}
            <div style={{ flex:1, overflowY:"auto", marginTop:20 }}>
              {auditLoading ? (
                <div style={{ textAlign:"center", color:"#9ca3af", padding:"20px 0", fontSize:13 }}>Loading history...</div>
              ) : auditLog.length === 0 ? (
                <div style={{ textAlign:"center", color:"#9ca3af", padding:"20px 0", fontSize:13 }}>No audit history yet</div>
              ) : (
                <div style={{ display:"flex", flexDirection:"column" }}>
                  {auditLog.map((entry, i) => {
                    const isLast = i === auditLog.length - 1;
                    const dotConfig = {
                      invoice_created:    { bg:"#f3f4f6", text:"📄", label:"Invoice extracted" },
                      invoice_pushed:     { bg:"#dbeafe", text:"🚀", label:"Pushed to ERP" },
                      agent_decision:     { bg:"#dcfce7", text:"✅", label:"Agent decision" },
                      anomaly_flagged:    { bg:"#fef9c3", text:"⚠️", label:"Anomaly detected" },
                      notification_sent:  { bg:"#ede9fe", text:"🔔", label:"Notification sent" },
                      invoice_approved:   { bg:"#dcfce7", text:"✓", label:"Approved" },
                      invoice_rejected:   { bg:"#fee2e2", text:"✗", label:"Rejected" },
                      comment_added:      { bg:"#f5f3ff", text:"💬", label:"Note added" },
                      payment_confirmed:  { bg:"#dcfce7", text:"💰", label:"Payment confirmed" },
                      slack_approved:     { bg:"#dcfce7", text:"✓", label:"Approved via Slack" },
                      slack_rejected:     { bg:"#fee2e2", text:"✗", label:"Rejected via Slack" },
                    }[entry.action] || { bg:"#f3f4f6", text:"•", label:entry.action };

                    return (
                      <div key={entry.id} style={{ display:"flex", gap:14, paddingBottom: isLast ? 0 : 20, position:"relative" }}>
                        {/* Dot + line */}
                        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", flexShrink:0 }}>
                          <div style={{ width:32, height:32, borderRadius:"50%", background:dotConfig.bg, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, border:"1px solid #e5e7eb", flexShrink:0 }}>
                            {dotConfig.text}
                          </div>
                          {!isLast && <div style={{ width:1, flex:1, background:"#e5e7eb", marginTop:4 }} />}
                        </div>
                        {/* Content */}
                        <div style={{ flex:1, paddingTop:4 }}>
                          <div style={{ fontSize:13, fontWeight:600, color:"#0a0f1e", marginBottom:2 }}>{dotConfig.label}</div>
                          {entry.detail && (
                            <div style={{ fontSize:12, color:"#6b7280", lineHeight:1.6, marginBottom:3 }}>{entry.detail}</div>
                          )}
                          <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                            <span style={{ fontSize:11, color:"#9ca3af", fontFamily:"DM Mono,monospace" }}>
                              {new Date(entry.created_at).toLocaleString("en-US", { dateStyle:"medium", timeStyle:"short" })}
                            </span>
                            {entry.actor && (
                              <span style={{ fontSize:11, background:"#f3f4f6", color:"#6b7280", padding:"2px 8px", borderRadius:100 }}>
                                {entry.actor}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={{ borderTop:"1px solid #e5e7eb", paddingTop:14, marginTop:14, display:"flex", justifyContent:"flex-end" }}>
              <button onClick={() => setAuditInvoice(null)} style={{ background:"#0a0f1e", color:"white", border:"none", padding:"9px 20px", borderRadius:8, fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:"DM Sans,sans-serif" }}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* COMMENTS MODAL */}
      {commentInvoice && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.4)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}
          onClick={e => e.target === e.currentTarget && setCommentInvoice(null)}>
          <div style={{ background:"white", borderRadius:16, padding:28, maxWidth:480, width:"100%", fontFamily:"DM Sans,sans-serif", maxHeight:"80vh", display:"flex", flexDirection:"column" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
              <div>
                <div style={{ fontFamily:"Syne,sans-serif", fontWeight:800, fontSize:16, color:"#0a0f1e" }}>
                  Notes — Invoice #{commentInvoice.invoice_number}
                </div>
                <div style={{ fontSize:12, color:"#6b7280", marginTop:2 }}>{commentInvoice.vendor_name} · {commentInvoice.invoice_date}</div>
              </div>
              <button onClick={() => setCommentInvoice(null)} style={{ background:"none", border:"none", fontSize:20, cursor:"pointer", color:"#9ca3af" }}>×</button>
            </div>

            {/* Comments list */}
            <div style={{ flex:1, overflowY:"auto", marginBottom:16, display:"flex", flexDirection:"column", gap:10, minHeight:80 }}>
              {(comments[commentInvoice.id] || []).length === 0 ? (
                <div style={{ color:"#9ca3af", fontSize:13, textAlign:"center", padding:"20px 0" }}>No notes yet — add the first one below</div>
              ) : (
                (comments[commentInvoice.id] || []).map((c, i) => (
                  <div key={i} style={{ background:"#f9fafb", borderRadius:10, padding:"10px 14px", border:"1px solid #e5e7eb" }}>
                    <div style={{ fontSize:12, color:"#0a0f1e", lineHeight:1.6 }}>{c.comment}</div>
                    <div style={{ fontSize:11, color:"#9ca3af", marginTop:4 }}>
                      {c.user_email} · {new Date(c.created_at).toLocaleString("en-US", { dateStyle:"medium", timeStyle:"short" })}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Add comment */}
            <div style={{ borderTop:"1px solid #e5e7eb", paddingTop:14 }}>
              <textarea
                placeholder="Add a note (e.g. Waiting for GRN, Disputed by supplier...)"
                value={commentText}
                onChange={e => setCommentText(e.target.value)}
                rows={3}
                style={{ width:"100%", border:"1px solid #e2ddd4", borderRadius:8, padding:"10px 12px", fontSize:13, fontFamily:"DM Sans,sans-serif", resize:"none", outline:"none", marginBottom:10, boxSizing:"border-box" }}
                onKeyDown={e => { if (e.key === "Enter" && e.ctrlKey) saveComment(); }}
              />
              <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
                <button onClick={() => setCommentInvoice(null)} style={{ background:"none", border:"1px solid #e2ddd4", color:"#6b7280", padding:"8px 16px", borderRadius:8, fontSize:13, cursor:"pointer", fontFamily:"DM Sans,sans-serif" }}>Cancel</button>
                <button onClick={saveComment} disabled={savingComment || !commentText.trim()} style={{ background:"#e8531a", color:"white", border:"none", padding:"8px 18px", borderRadius:8, fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:"DM Sans,sans-serif", opacity: savingComment || !commentText.trim() ? 0.6 : 1 }}>
                  {savingComment ? "Saving..." : "Save Note"}
                </button>
              </div>
              <div style={{ fontSize:11, color:"#9ca3af", marginTop:6 }}>Tip: Ctrl+Enter to save quickly</div>
            </div>
          </div>
        </div>
      )}

      {/* MARK AS PAID MODAL */}
      {paidInvoice && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}
          onClick={(e) => e.target === e.currentTarget && setPaidInvoice(null)}>
          <div style={{ background:"white", borderRadius:20, padding:32, maxWidth:480, width:"100%", fontFamily:"DM Sans, sans-serif" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:20 }}>
              <div>
                <div style={{ fontFamily:"Syne, sans-serif", fontWeight:800, fontSize:18, color:"#0a0f1e" }}>
                  Mark as Paid 💰
                </div>
                <div style={{ fontSize:12, color:"#6b7280", marginTop:2 }}>
                  Invoice #{paidInvoice.invoice_number} · {paidInvoice.vendor_name}
                </div>
              </div>
              <button onClick={() => setPaidInvoice(null)} style={{ background:"none", border:"none", fontSize:20, cursor:"pointer", color:"#9ca3af" }}>×</button>
            </div>

            <div style={{ display:"grid", gap:14 }}>
              <div>
                <label style={{ fontSize:12, fontWeight:600, color:"#374151", marginBottom:6, display:"block" }}>Payment Date</label>
                <input
                  type="date"
                  value={paidForm.paymentDate}
                  onChange={(e) => setPaidForm(f => ({ ...f, paymentDate: e.target.value }))}
                  style={{ width:"100%", padding:"10px 12px", border:"1px solid #e5e7eb", borderRadius:8, fontSize:14, fontFamily:"inherit" }}
                />
              </div>

              <div>
                <label style={{ fontSize:12, fontWeight:600, color:"#374151", marginBottom:6, display:"block" }}>Payment Method</label>
                <select
                  value={paidForm.paymentMethod}
                  onChange={(e) => setPaidForm(f => ({ ...f, paymentMethod: e.target.value }))}
                  style={{ width:"100%", padding:"10px 12px", border:"1px solid #e5e7eb", borderRadius:8, fontSize:14, fontFamily:"inherit", background:"white" }}
                >
                  <option value="ACH">ACH</option>
                  <option value="Wire">Wire Transfer</option>
                  <option value="Check">Check</option>
                  <option value="Card">Credit Card</option>
                  <option value="Zelle">Zelle</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize:12, fontWeight:600, color:"#374151", marginBottom:6, display:"block" }}>Reference / Check #</label>
                <input
                  type="text"
                  placeholder="e.g. ACH-12345 or Check #5678"
                  value={paidForm.paymentReference}
                  onChange={(e) => setPaidForm(f => ({ ...f, paymentReference: e.target.value }))}
                  style={{ width:"100%", padding:"10px 12px", border:"1px solid #e5e7eb", borderRadius:8, fontSize:14, fontFamily:"inherit" }}
                />
              </div>

              <div>
                <label style={{ fontSize:12, fontWeight:600, color:"#374151", marginBottom:6, display:"block" }}>
                  Amount Paid (full: {Number(paidInvoice.total||0).toLocaleString("en-US",{minimumFractionDigits:2})})
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={paidForm.paidAmount}
                  onChange={(e) => setPaidForm(f => ({ ...f, paidAmount: e.target.value }))}
                  style={{ width:"100%", padding:"10px 12px", border:"1px solid #e5e7eb", borderRadius:8, fontSize:14, fontFamily:"inherit" }}
                />
                <div style={{ fontSize:11, color:"#9ca3af", marginTop:4 }}>Enter a smaller amount for partial payment</div>
              </div>
            </div>

            <div style={{ display:"flex", gap:10, marginTop:24 }}>
              <button
                onClick={() => setPaidInvoice(null)}
                style={{ flex:1, background:"none", border:"1px solid #e5e7eb", color:"#6b7280", padding:"12px", borderRadius:10, fontSize:14, cursor:"pointer", fontFamily:"DM Sans, sans-serif" }}
              >Cancel</button>
              <button
                onClick={submitMarkPaid}
                disabled={savingPaid}
                style={{ flex:2, background:"#16a34a", color:"white", border:"none", padding:"12px", borderRadius:10, fontSize:14, fontWeight:600, cursor: savingPaid ? "wait" : "pointer", opacity: savingPaid ? 0.7 : 1, fontFamily:"DM Sans, sans-serif" }}
              >{savingPaid ? "Saving..." : "Confirm Payment ✓"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
