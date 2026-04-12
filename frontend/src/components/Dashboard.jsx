import { useEffect, useState } from "react";
import { supabase } from "../supabase";

const STATUS_COLORS = {
  pending:  { bg: "#fef9c3", color: "#92400e" },
  approved: { bg: "#dcfce7", color: "#16a34a" },
  rejected: { bg: "#fee2e2", color: "#dc2626" },
  pushed:   { bg: "#dbeafe", color: "#1d4ed8" },
};

function StatCard({ icon, label, value, sub, accent }) {
  return (
    <div className="stat-card">
      <div className="stat-card-icon" style={{ background: accent + "18", color: accent }}>{icon}</div>
      <div className="stat-card-body">
        <div className="stat-card-value">{value}</div>
        <div className="stat-card-label">{label}</div>
        {sub && <div className="stat-card-sub">{sub}</div>}
      </div>
    </div>
  );
}

export default function Dashboard({ user, onNewInvoice, onSignOut }) {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  useEffect(() => { fetchInvoices(); }, []);

  const fetchInvoices = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("invoices")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (!error) setInvoices(data || []);
    setLoading(false);
  };

  const filtered = filter === "all" ? invoices : invoices.filter(i => i.status === filter);

  // Stats
  const total = invoices.length;
  const totalAmount = invoices.reduce((s, i) => s + (i.total || 0), 0);
  const pending = invoices.filter(i => i.status === "pending").length;
  const pushed = invoices.filter(i => i.status === "pushed").length;

  const firstName = user.user_metadata?.full_name?.split(" ")[0] || user.email?.split("@")[0];

  return (
    <div className="dashboard">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">Invoice<span>IQ</span></div>
        <nav className="sidebar-nav">
          <div className="nav-item active">📊 Dashboard</div>
          <div className="nav-item" onClick={onNewInvoice}>📄 New Invoice</div>
          <div className="nav-item">🏢 Vendors</div>
          <div className="nav-item">⚙️ Settings</div>
        </nav>
        <div className="sidebar-user">
          <div className="sidebar-avatar">{firstName?.[0]?.toUpperCase()}</div>
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">{firstName}</div>
            <div className="sidebar-user-email">{user.email}</div>
          </div>
          <button className="signout-btn" onClick={onSignOut} title="Sign out">↩</button>
        </div>
      </aside>

      {/* Main */}
      <main className="dash-main">
        {/* Header */}
        <div className="dash-header">
          <div>
            <h1 className="dash-title">Good morning, {firstName} 👋</h1>
            <p className="dash-sub">Here's your invoice processing overview</p>
          </div>
          <button className="btn-approve" onClick={onNewInvoice}>+ Process Invoice</button>
        </div>

        {/* Stats */}
        <div className="stats-grid">
          <StatCard icon="📄" label="Total Invoices" value={total} sub="All time" accent="#e8531a" />
          <StatCard icon="💰" label="Total Processed" value={`$${totalAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} sub="This month" accent="#1a6be8" />
          <StatCard icon="⏳" label="Pending Review" value={pending} sub={pending > 0 ? "Needs attention" : "All clear!"} accent="#f59e0b" />
          <StatCard icon="✅" label="Pushed to ERP" value={pushed} sub="Successfully synced" accent="#16a34a" />
        </div>

        {/* Invoice table */}
        <div className="invoices-section">
          <div className="invoices-header">
            <div className="invoices-title">Recent Invoices</div>
            <div className="filter-tabs">
              {["all","pending","approved","pushed","rejected"].map(f => (
                <button key={f} className={`filter-tab ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="table-loading">Loading invoices...</div>
          ) : filtered.length === 0 ? (
            <div className="table-empty">
              <div className="table-empty-icon">📭</div>
              <div className="table-empty-title">{filter === "all" ? "No invoices yet" : `No ${filter} invoices`}</div>
              <div className="table-empty-sub">
                {filter === "all" ? "Upload your first invoice to get started" : `Try a different filter`}
              </div>
              {filter === "all" && (
                <button className="btn-approve" style={{ marginTop: 16 }} onClick={onNewInvoice}>
                  Process First Invoice →
                </button>
              )}
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
                    <th>Status</th>
                    <th>ERP Ref</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((inv) => {
                    const sc = STATUS_COLORS[inv.status] || STATUS_COLORS.pending;
                    return (
                      <tr key={inv.id}>
                        <td className="inv-num">{inv.invoice_number || "—"}</td>
                        <td className="inv-vendor">{inv.vendor_name || "—"}</td>
                        <td className="inv-date">{inv.invoice_date || "—"}</td>
                        <td className="inv-amount">${Number(inv.total || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
                        <td>
                          <span className="status-badge" style={{ background: sc.bg, color: sc.color }}>
                            {inv.status}
                          </span>
                        </td>
                        <td className="inv-erp">{inv.erp_reference || "—"}</td>
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
