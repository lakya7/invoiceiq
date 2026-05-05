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
    if (sortBy !== field) return <span style={{ opacity: 0.4, marginLeft: 6, fontSize: 13, color: "#7a7a6e" }}>⇅</span>;
    return <span style={{ marginLeft: 6, fontSize: 13, color: "#0a3d2f", fontWeight: 700 }}>{sortDir === "asc" ? "↑" : "↓"}</span>;
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
  // Team-scoped key — dismissing on Team A doesn't hide banner on Team B
  const setupDismissedKey = team?.id ? `billtiq_setup_dismissed_${team.id}` : null;
  const [setupDismissed, setSetupDismissed] = useState(false);
  // Re-read dismissed state whenever team changes
  useEffect(() => {
    if (!setupDismissedKey) { setSetupDismissed(false); return; }
    try { setSetupDismissed(localStorage.getItem(setupDismissedKey) === "1"); }
    catch { setSetupDismissed(false); }
  }, [setupDismissedKey]);
  const dismissSetup = () => {
    if (!setupDismissedKey) return;
    try { localStorage.setItem(setupDismissedKey, "1"); } catch {}
    setSetupDismissed(true);
  };
  const [auditLoading, setAuditLoading] = useState(false);

  // ── BULK SELECTION ─────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkActionLoading, setBulkActionLoading] = useState(false);

  // ── ROW ACTION OVERFLOW MENU ───────────────────────────────
  const [openMenuId, setOpenMenuId] = useState(null);
  useEffect(() => {
    if (!openMenuId) return;
    const close = (e) => {
      // Don't close if clicking inside an open menu or its trigger
      if (e.target.closest?.("[data-row-menu]")) return;
      setOpenMenuId(null);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [openMenuId]);
  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(i => i.id)));
    }
  };
  const clearSelection = () => setSelectedIds(new Set());

  // ── HELPER: Compute age in days from invoice_date ─────────
  const getInvoiceAge = (inv) => {
    const dateStr = inv.invoice_date || inv.created_at;
    if (!dateStr) return null;
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return null;
    const diffMs = Date.now() - date.getTime();
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    return days;
  };

  // ── HELPER: Format age with smart units + color ──────────
  const formatAge = (days) => {
    if (days === null || days < 0) return { text: "—", color: "#9ca3af" };
    if (days === 0) return { text: "Today", color: "#6b7280" };
    if (days === 1) return { text: "1d", color: "#6b7280" };
    if (days < 14) return { text: `${days}d`, color: "#6b7280" };
    if (days < 30) return { text: `${days}d`, color: "#d97706" };
    if (days < 60) return { text: `${days}d`, color: "#dc2626" };
    return { text: `${days}d`, color: "#991b1b" };
  };

  // ── HELPER: Compute exception reason for a row ──────────
  const getExceptionReason = (inv) => {
    if (inv.match_status === "matched") return null;
    if (inv.match_status === "non_po") return null;
    // Try to derive specific reason from anomalies or match_status
    if (inv.anomalies && Array.isArray(inv.anomalies) && inv.anomalies.length > 0) {
      const first = inv.anomalies[0];
      if (typeof first === 'string') return first;
      return first.label || first.message || first.type || "Anomaly flagged";
    }
    if (inv.match_status === "mismatch") return "Amount or vendor mismatch";
    if (inv.match_status === "partial") return "Partial PO match";
    if (inv.match_status === "unmatched" && !inv.po_number) return "No PO number on invoice";
    if (inv.match_status === "unmatched") return "PO not found in system";
    return null;
  };

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

  // ── BULK: Mark selected as paid ────────────────────────────
  const bulkMarkPaid = async () => {
    const eligibleIds = [...selectedIds].filter(id => {
      const inv = invoices.find(i => i.id === id);
      return inv && inv.status === "pushed" && inv.payment_status !== "paid" && inv.payment_status !== "cancelled";
    });
    if (eligibleIds.length === 0) {
      alert("No eligible invoices selected. Only pushed/unpaid invoices can be marked paid.");
      return;
    }
    if (!window.confirm(`Mark ${eligibleIds.length} invoice(s) as paid? Payment date will be set to today.`)) return;
    setBulkActionLoading(true);
    const today = new Date().toISOString().slice(0, 10);
    let successCount = 0;
    let failCount = 0;
    for (const invoiceId of eligibleIds) {
      try {
        const inv = invoices.find(i => i.id === invoiceId);
        const res = await fetch(`${API}/api/invoices/${invoiceId}/mark-paid`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            teamId: team?.id,
            paymentDate: today,
            paymentMethod: "ACH",
            paymentReference: "Bulk action",
            paidAmount: inv?.total || 0,
            userId: user?.id,
          }),
        });
        if (res.ok) successCount++; else failCount++;
      } catch { failCount++; }
    }
    setBulkActionLoading(false);
    clearSelection();
    fetchInvoices();
    alert(`Marked ${successCount} invoice(s) as paid.${failCount > 0 ? ` ${failCount} failed.` : ""}`);
  };

  // ── BULK: Export selected to CSV ───────────────────────────
  const bulkExportCSV = () => {
    const selected = invoices.filter(i => selectedIds.has(i.id));
    if (selected.length === 0) return;
    const headers = ["Invoice #", "Vendor", "Date", "Amount", "Currency", "PO Match", "Status", "Payment Status", "ERP Reference"];
    const rows = selected.map(inv => [
      inv.invoice_number || "",
      inv.vendor_name || "",
      inv.invoice_date || "",
      inv.total || 0,
      inv.raw_data?.currency || "USD",
      inv.match_status || "",
      inv.status || "",
      inv.payment_status || "",
      inv.erp_reference || "",
    ]);
    const csv = [headers, ...rows].map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `billtiq-invoices-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // ── BULK: Add note to selected ─────────────────────────────
  const [bulkNoteText, setBulkNoteText] = useState("");
  const [showBulkNote, setShowBulkNote] = useState(false);
  const submitBulkNote = async () => {
    if (!bulkNoteText.trim()) return;
    setBulkActionLoading(true);
    let successCount = 0;
    let failCount = 0;
    let firstError = null;
    const noteText = bulkNoteText.trim();
    for (const invoiceId of selectedIds) {
      try {
        const { error } = await supabase.from("invoice_comments").insert({
          invoice_id: invoiceId,
          team_id: team?.id,
          user_id: user.id,
          user_email: user.email,
          comment: noteText,
          created_at: new Date().toISOString(),
        });
        if (error) {
          if (!firstError) firstError = error;
          console.error("Bulk note insert error:", error, "for invoice", invoiceId);
          failCount++;
        } else {
          successCount++;
        }
      } catch (e) {
        if (!firstError) firstError = e;
        console.error("Bulk note exception:", e);
        failCount++;
      }
    }
    setBulkActionLoading(false);
    setShowBulkNote(false);
    setBulkNoteText("");
    clearSelection();
    if (failCount === 0) {
      alert(`Added note to ${successCount} invoice(s).`);
    } else {
      const errMsg = firstError?.message || firstError?.error_description || "Unknown error";
      alert(`Added note to ${successCount} invoice(s). ${failCount} failed.\n\nError: ${errMsg}`);
    }
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
    let matchesFilter = filter === "all" || inv.status === filter;
    // Exception filter — match_status indicates problems
    if (filter === "exceptions") {
      matchesFilter = inv.match_status === "unmatched" || inv.match_status === "mismatch" || inv.match_status === "partial";
    }
    // Duplicates filter — anomalies indicate possible duplicates
    if (filter === "duplicates") {
      matchesFilter = inv.anomalies && Array.isArray(inv.anomalies) && inv.anomalies.some(a =>
        typeof a === 'string' ? a.toLowerCase().includes('duplicate') : (a.type === 'duplicate' || a.label?.toLowerCase().includes('duplicate'))
      );
    }
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
  // Exports the currently-filtered view (respects search + filter tabs)
  const exportCSV = () => {
    const rows = [
      ["Invoice #","Vendor","Date","Amount","Currency","PO Match","Status","ERP Reference","Created At"],
      ...filtered.map(inv => [
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

  // Exception-focused metrics for the new dashboard layout
  const matchExceptions = invoices.filter(i =>
    i.match_status === "unmatched" || i.match_status === "mismatch" || i.match_status === "partial"
  ).length;
  const duplicateSuspects = invoices.filter(i =>
    i.anomalies && Array.isArray(i.anomalies) && i.anomalies.some(a =>
      typeof a === 'string' ? a.toLowerCase().includes('duplicate') : (a.type === 'duplicate' || a.label?.toLowerCase().includes('duplicate'))
    )
  ).length;
  const pendingApprovalAmount = invoices
    .filter(i => i.status === "pending")
    .reduce((s, i) => s + (i.total || 0), 0);
  const formatCurrency = (n) => {
    if (n >= 1000000) return `$${(n/1000000).toFixed(1)}M`;
    if (n >= 1000) return `$${(n/1000).toFixed(1)}K`;
    return `$${n.toFixed(0)}`;
  };

  // Determine the right page header based on what needs attention
  const totalActionRequired = pending + matchExceptions + duplicateSuspects;
  const hasActionItems = totalActionRequired > 0;

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
          {team && team.role === "admin" && <div className="nav-item" onClick={onOnboarding} style={{ color: "var(--ink)", fontWeight: 600 }}>🚀 Setup Guide</div>}
        </nav>

        <div style={{ padding: "0 16px 12px", display: "flex", gap: 12, fontSize: 11 }}>
          <span style={{ color: "#9ca3af", cursor: "pointer" }} onClick={onPrivacy}>Privacy</span>
          <span style={{ color: "#d1d5db" }}>·</span>
          <span style={{ color: "#9ca3af", cursor: "pointer" }} onClick={onTerms}>Terms</span>
        </div>

        {/* Need Help Button */}
        <div style={{ padding: "0 16px 12px" }}>
          <button
            onClick={onSupport}
            style={{ width:"100%", display:"flex", alignItems:"center", gap:8, background:"white", border:"1px solid #e2ddd4", color:"#4b5563", padding:"10px 14px", borderRadius:8, fontSize:13, fontWeight:500, textDecoration:"none", transition:"all 0.2s", cursor:"pointer", fontFamily:"DM Sans,sans-serif" }}
            onMouseEnter={e => { e.currentTarget.style.background = "#faf9f7"; e.currentTarget.style.borderColor = "#cbc5b8"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "white"; e.currentTarget.style.borderColor = "#e2ddd4"; }}
          >
            <span style={{ fontSize:16 }}>🆘</span>
            <div style={{ textAlign:"left" }}>
              <div style={{ fontSize:13, fontWeight:600, color:"#1f2937" }}>Need Help?</div>
              <div style={{ fontSize:11, color:"#9ca3af", marginTop:1 }}>Help & Support</div>
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
            <h1 className="dash-title">
              {hasActionItems
                ? <>{totalActionRequired} AP {(matchExceptions + duplicateSuspects) > 0 ? "Exception" : "Invoice"}{totalActionRequired === 1 ? "" : "s"} Requiring Review</>
                : "Inbox"
              }
            </h1>
            <p className="dash-sub">{team ? `${team.name} · ${invoices.length} invoice${invoices.length === 1 ? '' : 's'} processed` : "Your AP exception handling overview"}</p>
          </div>
          <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
            {!team && Array.isArray(teams) && teams.length === 0 && (
              <button className="btn-secondary-action" onClick={() => setCreatingTeam(true)}>+ Create Team</button>
            )}
            {team && (
              <button className="btn-secondary-action" onClick={onReport}>📊 Monthly Report</button>
            )}
            <button className="btn-approve" onClick={onNewInvoice}>+ New Invoice</button>
          </div>
        </div>

        {/* Setup progress — small dismissible widget instead of dominant banner */}
        {team && team.role === "admin" && !setupComplete && !setupDismissed && (
          <div style={{ background:"#faf9f7", border:"1px solid #e2ddd4", borderRadius:10, padding:"10px 14px", marginBottom:18, display:"flex", alignItems:"center", gap:12, fontSize:13 }}>
            <div style={{ fontSize:14, opacity:0.7 }}>🚀</div>
            <div style={{ flex:1, color:"#7a7a6e" }}>
              Setup {setupDone}/{setupTotal} complete
              <span style={{ display:"inline-block", marginLeft:10, height:4, background:"#e2ddd4", borderRadius:100, overflow:"hidden", width:120, verticalAlign:"middle" }}>
                <span style={{ display:"block", height:"100%", width:`${(setupDone/setupTotal)*100}%`, background:"#0a3d2f", borderRadius:100, transition:"width 0.4s" }} />
              </span>
            </div>
            <button
              onClick={onOnboarding}
              style={{ background:"transparent", color:"#0a3d2f", border:"1px solid #0a3d2f", padding:"5px 12px", borderRadius:6, fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"DM Sans,sans-serif", whiteSpace:"nowrap" }}
            >
              Continue →
            </button>
            <button
              onClick={dismissSetup}
              title="Dismiss"
              style={{ background:"transparent", color:"#7a7a6e", border:"none", padding:"4px 8px", borderRadius:6, fontSize:14, cursor:"pointer", fontFamily:"DM Sans,sans-serif" }}
            >
              ✕
            </button>
          </div>
        )}

        {/* Create team prompt - only show if user has no teams at all */}
        {!team && !creatingTeam && Array.isArray(teams) && teams.length === 0 && (
          <div className="onboarding-card">
            <div style={{ fontSize:36, marginBottom:12 }}>👥</div>
            <div style={{ fontFamily:"DM Sans,sans-serif", fontWeight:700, fontSize:18, marginBottom:6 }}>Create a Team Workspace</div>
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

        {/* Stats — exception-focused, click to filter */}
        <div className="stats-grid">
          {/* Pending Review — most important, larger if has items */}
          <div
            className="stat-card stat-clickable"
            onClick={() => setFilter("pending")}
            style={{
              cursor: "pointer",
              background: pending > 0 ? "#fffbeb" : "white",
              borderColor: pending > 0 ? "#fcd34d" : "var(--border)",
              borderWidth: pending > 0 ? "1.5px" : "1px",
              outline: filter === "pending" ? "2px solid #f59e0b" : "none",
              outlineOffset: "-2px",
            }}
            title="Click to filter table"
          >
            <div className="stat-card-icon" style={{ background: pending > 0 ? "rgba(245,158,11,0.15)" : "#f3f4f6", color: pending > 0 ? "#d97706" : "#7a7a6e" }}>⏳</div>
            <div className="stat-card-body">
              <div className="stat-card-value" style={{ color: pending > 0 ? "#92400e" : "#cbc5b8" }}>{pending}</div>
              <div className="stat-card-label">Pending Review</div>
              <div className="stat-card-sub">{pending > 0 ? "Action required" : "No invoices pending review"}</div>
            </div>
          </div>

          {/* Match Exceptions */}
          <div
            className="stat-card stat-clickable"
            onClick={() => setFilter("exceptions")}
            style={{
              cursor: "pointer",
              background: matchExceptions > 0 ? "#fef2f2" : "white",
              borderColor: matchExceptions > 0 ? "#fca5a5" : "var(--border)",
              borderWidth: matchExceptions > 0 ? "1.5px" : "1px",
              outline: filter === "exceptions" ? "2px solid #dc2626" : "none",
              outlineOffset: "-2px",
            }}
            title="Click to filter table"
          >
            <div className="stat-card-icon" style={{ background: matchExceptions > 0 ? "rgba(220,38,38,0.12)" : "#f3f4f6", color: matchExceptions > 0 ? "#dc2626" : "#7a7a6e" }}>🧩</div>
            <div className="stat-card-body">
              <div className="stat-card-value" style={{ color: matchExceptions > 0 ? "#991b1b" : "#cbc5b8" }}>{matchExceptions}</div>
              <div className="stat-card-label">Match Exceptions</div>
              <div className="stat-card-sub">{matchExceptions > 0 ? "Unmatched / mismatched" : "All POs matched"}</div>
            </div>
          </div>

          {/* Duplicate Suspects */}
          <div
            className="stat-card stat-clickable"
            onClick={() => setFilter("duplicates")}
            style={{
              cursor: "pointer",
              background: duplicateSuspects > 0 ? "#fef2f2" : "white",
              borderColor: duplicateSuspects > 0 ? "#fca5a5" : "var(--border)",
              borderWidth: duplicateSuspects > 0 ? "1.5px" : "1px",
              outline: filter === "duplicates" ? "2px solid #dc2626" : "none",
              outlineOffset: "-2px",
            }}
            title="Click to filter table"
          >
            <div className="stat-card-icon" style={{ background: duplicateSuspects > 0 ? "rgba(220,38,38,0.12)" : "#f3f4f6", color: duplicateSuspects > 0 ? "#dc2626" : "#7a7a6e" }}>🚨</div>
            <div className="stat-card-body">
              <div className="stat-card-value" style={{ color: duplicateSuspects > 0 ? "#991b1b" : "#cbc5b8" }}>{duplicateSuspects}</div>
              <div className="stat-card-label">Duplicate Suspects</div>
              <div className="stat-card-sub">{duplicateSuspects > 0 ? "Review before pushing" : "No duplicates flagged"}</div>
            </div>
          </div>

          {/* $ Pending Approval */}
          <div className="stat-card" style={{ background: "white", borderColor: "var(--border)" }}>
            <div className="stat-card-icon" style={{ background: "rgba(13,79,60,0.1)", color: "#0a3d2f" }}>💰</div>
            <div className="stat-card-body">
              <div className="stat-card-value" style={{ color: pendingApprovalAmount > 0 ? "var(--ink)" : "#cbc5b8", fontVariantNumeric: "tabular-nums" }}>{formatCurrency(pendingApprovalAmount)}</div>
              <div className="stat-card-label">$ Pending Approval</div>
              <div className="stat-card-sub">{pending} invoice{pending === 1 ? '' : 's'} awaiting</div>
            </div>
          </div>
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
              {/* CSV Export — hidden during bulk selection to avoid two competing export buttons */}
              {selectedIds.size === 0 && (
                <button
                  onClick={exportCSV}
                  style={{ background:"white", border:"1px solid #e2ddd4", color:"#374151", padding:"7px 14px", borderRadius:8, fontSize:12, fontWeight:500, cursor:"pointer", fontFamily:"DM Sans,sans-serif", whiteSpace:"nowrap" }}
                >⬇ Export {filter === "all" && !search.trim() ? "all" : "filtered"}</button>
              )}
            </div>
          </div>

          {/* Bulk Action Bar — shows when items selected */}
          {selectedIds.size > 0 && (
            <div style={{ background:"#0a3d2f", color:"white", borderRadius:8, padding:"10px 16px", marginBottom:12, display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
              <span style={{ fontSize:13, fontWeight:600 }}>
                {selectedIds.size} selected
              </span>
              <span style={{ color:"rgba(255,255,255,0.4)" }}>·</span>
              <button
                onClick={bulkMarkPaid}
                disabled={bulkActionLoading}
                style={{ background:"white", color:"#0a3d2f", border:"none", padding:"6px 14px", borderRadius:6, fontSize:12, fontWeight:600, cursor:bulkActionLoading?"wait":"pointer", fontFamily:"DM Sans,sans-serif" }}
              >💰 Mark Paid</button>
              <button
                onClick={bulkExportCSV}
                style={{ background:"transparent", color:"white", border:"1px solid rgba(255,255,255,0.3)", padding:"6px 14px", borderRadius:6, fontSize:12, fontWeight:500, cursor:"pointer", fontFamily:"DM Sans,sans-serif" }}
              >⬇ Export {selectedIds.size} selected</button>
              <button
                onClick={() => setShowBulkNote(true)}
                style={{ background:"transparent", color:"white", border:"1px solid rgba(255,255,255,0.3)", padding:"6px 14px", borderRadius:6, fontSize:12, fontWeight:500, cursor:"pointer", fontFamily:"DM Sans,sans-serif" }}
              >💬 Add Note</button>
              <div style={{ flex:1 }} />
              <button
                onClick={clearSelection}
                style={{ background:"transparent", color:"rgba(255,255,255,0.7)", border:"none", padding:"6px 10px", fontSize:12, cursor:"pointer", fontFamily:"DM Sans,sans-serif" }}
              >Clear</button>
            </div>
          )}

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
                    <th style={{ width: 36, padding: "9px 8px 9px 14px" }}>
                      <input
                        type="checkbox"
                        checked={filtered.length > 0 && selectedIds.size === filtered.length}
                        ref={el => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < filtered.length; }}
                        onChange={toggleSelectAll}
                        style={{ cursor: "pointer", accentColor: "#0a3d2f" }}
                      />
                    </th>
                    <th onClick={() => handleSort("invoice_number")} style={{ cursor: "pointer", userSelect: "none" }}>Invoice #{sortIcon("invoice_number")}</th>
                    <th onClick={() => handleSort("vendor_name")} style={{ cursor: "pointer", userSelect: "none" }}>Vendor{sortIcon("vendor_name")}</th>
                    <th>Age</th>
                    <th onClick={() => handleSort("total")} style={{ cursor: "pointer", userSelect: "none" }}>Amount{sortIcon("total")}</th>
                    <th onClick={() => handleSort("match_status")} style={{ cursor: "pointer", userSelect: "none" }}>PO Match{sortIcon("match_status")}</th>
                    <th>Exception Reason</th>
                    <th onClick={() => handleSort("status")} style={{ cursor: "pointer", userSelect: "none" }}>Status{sortIcon("status")}</th>
                    <th onClick={() => handleSort("payment_status")} style={{ cursor: "pointer", userSelect: "none" }}>Payment{sortIcon("payment_status")}</th>
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
                    const ageDays = getInvoiceAge(inv);
                    const age = formatAge(ageDays);
                    const reason = getExceptionReason(inv);
                    const isException = inv.match_status === "unmatched" || inv.match_status === "mismatch" || inv.match_status === "partial";
                    const isSelected = selectedIds.has(inv.id);
                    return (
                      <tr key={inv.id} className={isException ? "row-exception" : ""} style={isSelected ? { background: "#eff6f3" } : undefined}>
                        <td style={{ padding: "9px 8px 9px 14px" }}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelect(inv.id)}
                            style={{ cursor: "pointer", accentColor: "#0a3d2f" }}
                          />
                        </td>
                        <td className="inv-num">{inv.invoice_number||"—"}</td>
                        <td className="inv-vendor">{inv.vendor_name||"—"}</td>
                        <td style={{ color: age.color, fontWeight: 600, fontSize: 12, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{age.text}</td>
                        <td className="inv-amount">{sym}{Number(inv.total||0).toLocaleString("en-US",{minimumFractionDigits:2})}</td>
                        <td>
                          {/* For pushed invoices, the exception is historical (was reviewed and approved). Show a muted "Approved" label instead of the alarming red badge. */}
                          {inv.status === "pushed" && (inv.match_status === "unmatched" || inv.match_status === "mismatch" || inv.match_status === "partial") ? (
                            <span className="status-badge" style={{ background: "#f3f4f6", color: "#6b7280", fontWeight: 500 }} title={`Originally ${mc.label || inv.match_status}, approved by reviewer`}>
                              Approved · {mc.label || inv.match_status}
                            </span>
                          ) : inv.three_way_match_status === "matched" && inv.match_type === "3-way" ? (
                            // 3-way match passed — show receipt numbers
                            <span
                              className="status-badge"
                              style={{ background: "#dcfce7", color: "#16a34a" }}
                              title={inv.three_way_match_reason || "Invoice matches PO and goods receipts"}
                            >
                              ✓ 3-Way{inv.three_way_match_receipts ? ` · ${inv.three_way_match_receipts}` : ""}
                            </span>
                          ) : inv.three_way_match_status === "matched" && inv.match_type === "2-way" ? (
                            // 2-way match passed — no receipts needed for this PO
                            <span
                              className="status-badge"
                              style={{ background: "#dcfce7", color: "#16a34a" }}
                              title={inv.three_way_match_reason || "Invoice matches PO"}
                            >
                              ✓ 2-Way
                            </span>
                          ) : inv.three_way_match_status === "receipt_missing" ? (
                            // 3-way required, receipt not yet available — distinct exception state
                            <span
                              className="status-badge"
                              style={{ background: "#fef3c7", color: "#92400e" }}
                              title={inv.three_way_match_reason || "3-way match required but receipt is missing"}
                            >
                              ⚠ Receipt Missing
                            </span>
                          ) : inv.three_way_match_status === "mismatch" ? (
                            // Mismatch on either qty or price (label varies by match type)
                            <span
                              className="status-badge"
                              style={{ background: "#fee2e2", color: "#dc2626" }}
                              title={inv.three_way_match_reason || "Invoice does not match PO and/or receipts"}
                            >
                              ⚠ {inv.match_type === "2-way" ? "2-Way" : "3-Way"} Mismatch
                            </span>
                          ) : (
                            <span className="status-badge" style={{background:mc.bg,color:mc.color}}>{mc.label || (inv.match_status||"unmatched").replace(/_/g," ")}</span>
                          )}
                        </td>
                        <td style={{ color: (reason && inv.status !== "pushed") ? "#991b1b" : "#9ca3af", fontSize: 12, maxWidth: 220 }}>
                          {/* For pushed rows, the exception reason is informational, not actionable — fade it */}
                          {reason ? (inv.status === "pushed" ? <span style={{ fontStyle: "italic" }}>{reason}</span> : reason) : "—"}
                        </td>
                        <td><span className="status-badge" style={{background:sc.bg,color:sc.color}}>{inv.status}</span></td>
                        <td>{inv.status === "pushed" ? <span className="status-badge" style={{background:pc.bg,color:pc.color}}>{pc.label}</span> : <span style={{color:"#9ca3af",fontSize:12}}>—</span>}</td>
                        <td>
                          {inv.status === "pending" && (
                            <div style={{ display:"flex", gap:6, alignItems:"center", position:"relative" }}>
                              <button
                                onClick={() => approveInvoice(inv.id)}
                                style={{ background:"#0a3d2f", color:"white", border:"none", padding:"4px 10px", borderRadius:6, fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:"DM Sans,sans-serif", whiteSpace:"nowrap" }}
                              >✓ Approve</button>
                              <div data-row-menu style={{ position:"relative" }}>
                                <button
                                  onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === inv.id ? null : inv.id); }}
                                  title="More actions"
                                  style={{ background:"white", border:"1px solid #e2ddd4", color:"#6b7280", padding:"4px 8px", borderRadius:6, fontSize:14, lineHeight:1, cursor:"pointer", fontFamily:"DM Sans,sans-serif" }}
                                >⋯</button>
                                {openMenuId === inv.id && (
                                  <div style={{ position:"absolute", top:"calc(100% + 4px)", right:0, background:"white", border:"1px solid #e2ddd4", borderRadius:8, boxShadow:"0 6px 20px rgba(10,61,47,0.12)", padding:4, minWidth:160, zIndex:50 }}>
                                    <button
                                      onClick={() => { setOpenMenuId(null); rejectInvoice(inv.id); }}
                                      style={{ display:"block", width:"100%", textAlign:"left", background:"none", border:"none", color:"#C53030", padding:"8px 12px", borderRadius:6, fontSize:12, fontWeight:500, cursor:"pointer", fontFamily:"DM Sans,sans-serif" }}
                                      onMouseEnter={e => e.currentTarget.style.background = "#fef2f2"}
                                      onMouseLeave={e => e.currentTarget.style.background = "none"}
                                    >✗ Reject</button>
                                    <button
                                      onClick={() => { setOpenMenuId(null); openComments(inv); }}
                                      style={{ display:"block", width:"100%", textAlign:"left", background:"none", border:"none", color:"#374151", padding:"8px 12px", borderRadius:6, fontSize:12, fontWeight:500, cursor:"pointer", fontFamily:"DM Sans,sans-serif" }}
                                      onMouseEnter={e => e.currentTarget.style.background = "#faf9f7"}
                                      onMouseLeave={e => e.currentTarget.style.background = "none"}
                                    >💬 Add note</button>
                                    <button
                                      onClick={() => { setOpenMenuId(null); openAudit(inv); }}
                                      style={{ display:"block", width:"100%", textAlign:"left", background:"none", border:"none", color:"#374151", padding:"8px 12px", borderRadius:6, fontSize:12, fontWeight:500, cursor:"pointer", fontFamily:"DM Sans,sans-serif" }}
                                      onMouseEnter={e => e.currentTarget.style.background = "#faf9f7"}
                                      onMouseLeave={e => e.currentTarget.style.background = "none"}
                                    >🕐 View history</button>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                          {inv.status !== "pending" && (
                            <div style={{ display:"flex", gap:6, alignItems:"center", position:"relative" }}>
                              {showMarkPaid ? (
                                <button
                                  onClick={() => openMarkPaid(inv)}
                                  className="btn-mark-paid"
                                  title="Mark as paid"
                                >💰 Mark Paid</button>
                              ) : (
                                <button
                                  onClick={() => openComments(inv)}
                                  style={{ background:"white", border:"1px solid #e2ddd4", color:"#374151", padding:"4px 10px", borderRadius:6, fontSize:11, fontWeight:500, cursor:"pointer", fontFamily:"DM Sans,sans-serif", whiteSpace:"nowrap" }}
                                >💬 Note</button>
                              )}
                              <div data-row-menu style={{ position:"relative" }}>
                                <button
                                  onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === inv.id ? null : inv.id); }}
                                  title="More actions"
                                  style={{ background:"white", border:"1px solid #e2ddd4", color:"#6b7280", padding:"4px 8px", borderRadius:6, fontSize:14, lineHeight:1, cursor:"pointer", fontFamily:"DM Sans,sans-serif" }}
                                >⋯</button>
                                {openMenuId === inv.id && (
                                  <div style={{ position:"absolute", top:"calc(100% + 4px)", right:0, background:"white", border:"1px solid #e2ddd4", borderRadius:8, boxShadow:"0 6px 20px rgba(10,61,47,0.12)", padding:4, minWidth:160, zIndex:50 }}>
                                    {showMarkPaid && (
                                      <button
                                        onClick={() => { setOpenMenuId(null); openComments(inv); }}
                                        style={{ display:"block", width:"100%", textAlign:"left", background:"none", border:"none", color:"#374151", padding:"8px 12px", borderRadius:6, fontSize:12, fontWeight:500, cursor:"pointer", fontFamily:"DM Sans,sans-serif" }}
                                        onMouseEnter={e => e.currentTarget.style.background = "#faf9f7"}
                                        onMouseLeave={e => e.currentTarget.style.background = "none"}
                                      >💬 Add note</button>
                                    )}
                                    <button
                                      onClick={() => { setOpenMenuId(null); openAudit(inv); }}
                                      style={{ display:"block", width:"100%", textAlign:"left", background:"none", border:"none", color:"#374151", padding:"8px 12px", borderRadius:6, fontSize:12, fontWeight:500, cursor:"pointer", fontFamily:"DM Sans,sans-serif" }}
                                      onMouseEnter={e => e.currentTarget.style.background = "#faf9f7"}
                                      onMouseLeave={e => e.currentTarget.style.background = "none"}
                                    >🕐 View history</button>
                                  </div>
                                )}
                              </div>
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


      {/* BULK NOTE MODAL */}
      {showBulkNote && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.4)", zIndex:1001, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}
          onClick={e => e.target === e.currentTarget && setShowBulkNote(false)}>
          <div style={{ background:"white", borderRadius:14, padding:24, maxWidth:480, width:"100%", fontFamily:"DM Sans,sans-serif" }}>
            <div style={{ fontSize:18, fontWeight:700, marginBottom:6 }}>Add note to {selectedIds.size} invoice{selectedIds.size === 1 ? '' : 's'}</div>
            <div style={{ fontSize:13, color:"#6b7280", marginBottom:14 }}>This note will be added to each selected invoice's audit trail.</div>
            <textarea
              value={bulkNoteText}
              onChange={e => setBulkNoteText(e.target.value)}
              placeholder="e.g., Reviewed during month-end close. Approved for payment."
              autoFocus
              rows={4}
              style={{ width:"100%", border:"1px solid #e2ddd4", borderRadius:8, padding:"10px 12px", fontSize:13, fontFamily:"DM Sans,sans-serif", resize:"vertical", boxSizing:"border-box", outline:"none" }}
            />
            <div style={{ display:"flex", gap:8, justifyContent:"flex-end", marginTop:14 }}>
              <button
                onClick={() => { setShowBulkNote(false); setBulkNoteText(""); }}
                style={{ background:"white", border:"1px solid #e2ddd4", color:"#374151", padding:"8px 16px", borderRadius:6, fontSize:13, fontWeight:500, cursor:"pointer", fontFamily:"DM Sans,sans-serif" }}
              >Cancel</button>
              <button
                onClick={submitBulkNote}
                disabled={!bulkNoteText.trim() || bulkActionLoading}
                style={{ background:"#0a3d2f", color:"white", border:"none", padding:"8px 16px", borderRadius:6, fontSize:13, fontWeight:600, cursor: (!bulkNoteText.trim() || bulkActionLoading) ? "not-allowed" : "pointer", opacity: (!bulkNoteText.trim() || bulkActionLoading) ? 0.5 : 1, fontFamily:"DM Sans,sans-serif" }}
              >{bulkActionLoading ? "Adding..." : "Add Note"}</button>
            </div>
          </div>
        </div>
      )}

      {/* AUDIT HISTORY MODAL */}
      {auditInvoice && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.4)", zIndex:1001, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}
          onClick={e => e.target === e.currentTarget && setAuditInvoice(null)}>
          <div style={{ background:"white", borderRadius:20, padding:28, maxWidth:520, width:"100%", fontFamily:"DM Sans,sans-serif", maxHeight:"80vh", display:"flex", flexDirection:"column" }}>
            {/* Header */}
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:4 }}>
              <div>
                <div style={{ fontFamily:"DM Sans,sans-serif", fontWeight:800, fontSize:16, color:"#0a0f1e" }}>
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
                <div style={{ fontFamily:"DM Sans,sans-serif", fontWeight:800, fontSize:16, color:"#0a0f1e" }}>
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
                <div style={{ fontFamily:"DM Sans, sans-serif", fontWeight:800, fontSize:18, color:"#0a0f1e" }}>
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
