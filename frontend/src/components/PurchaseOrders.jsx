import { useState, useEffect, useRef } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

const STATUS_COLORS = {
  open:              { bg: "#dbeafe", color: "#1d4ed8" },
  partially_matched: { bg: "#fef9c3", color: "#92400e" },
  fully_matched:     { bg: "#dcfce7", color: "#16a34a" },
  closed:            { bg: "#f3f4f6", color: "#6b7280" },
  cancelled:         { bg: "#fee2e2", color: "#dc2626" },
};

export default function PurchaseOrders({ user, team, onBack }) {
  const [pos, setPos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [toast, setToast] = useState(null);
  const [filter, setFilter] = useState("all");
  const [manualPO, setManualPO] = useState({ poNumber: "", vendorName: "", totalAmount: "", currency: "USD", issueDate: "", expectedDelivery: "" });
  const fileRef = useRef();

  useEffect(() => { if (team) fetchPOs(); }, [team]);

  const fetchPOs = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/pos/${team.id}`);
      const data = await res.json();
      if (data.success) setPos(data.pos);
    } catch (e) { showToast("Failed to load POs", "error"); }
    setLoading(false);
  };

  const uploadPO = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("teamId", team.id);
      formData.append("userId", user.id);
      const res = await fetch(`${API}/api/pos`, { method: "POST", body: formData });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      showToast("PO uploaded & extracted!", "success");
      setShowUpload(false);
      fetchPOs();
    } catch (e) { showToast(e.message, "error"); }
    setUploading(false);
  };

  const submitManualPO = async (e) => {
    e.preventDefault();
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("teamId", team.id);
      formData.append("userId", user.id);
      formData.append("poData", JSON.stringify({ ...manualPO, vendor: { name: manualPO.vendorName }, totalAmount: parseFloat(manualPO.totalAmount) || 0 }));
      const res = await fetch(`${API}/api/pos`, { method: "POST", body: formData });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      showToast("PO created!", "success");
      setShowManual(false);
      setManualPO({ poNumber: "", vendorName: "", totalAmount: "", currency: "USD", issueDate: "", expectedDelivery: "" });
      fetchPOs();
    } catch (e) { showToast(e.message, "error"); }
    setUploading(false);
  };

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const filtered = filter === "all" ? pos : pos.filter(p => p.status === filter);
  const totalOpen = pos.filter(p => p.status === "open").reduce((s, p) => s + (p.total_amount || 0), 0);

  return (
    <div className="po-page">
      <div className="team-header">
        <button className="settings-back" onClick={onBack}>← Dashboard</button>
        <div className="team-header-row">
          <div>
            <h1 className="team-title">Purchase Orders</h1>
            <p className="team-sub">Manage POs for invoice matching · {team?.name}</p>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn-secondary-action" onClick={() => { setShowManual(true); setShowUpload(false); }}>+ Manual PO</button>
            <button className="btn-approve" onClick={() => { setShowUpload(true); setShowManual(false); }}>📄 Upload PO</button>
          </div>
        </div>
      </div>

      <div className="team-content">
        {/* Stats */}
        <div className="po-stats">
          {[
            { label: "Total POs", value: pos.length, color: "#e8531a" },
            { label: "Open", value: pos.filter(p=>p.status==="open").length, color: "#1d4ed8" },
            { label: "Matched", value: pos.filter(p=>p.status==="fully_matched").length, color: "#16a34a" },
            { label: "Open Value", value: `$${totalOpen.toLocaleString("en-US",{minimumFractionDigits:0})}`, color: "#7c3aed" },
          ].map((s, i) => (
            <div key={i} className="po-stat-card">
              <div className="po-stat-value" style={{ color: s.color }}>{s.value}</div>
              <div className="po-stat-label">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Upload dropzone */}
        {showUpload && (
          <div className="settings-card">
            <div className="settings-card-title">Upload Purchase Order</div>
            <div className="settings-card-sub">AI will extract all PO data automatically</div>
            <div className="settings-card-body">
              {uploading ? (
                <div style={{ textAlign: "center", padding: "32px", color: "var(--muted)" }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>⚡</div>
                  AI is extracting PO data...
                </div>
              ) : (
                <div
                  className={`dropzone ${dragOver ? "dragover" : ""}`}
                  style={{ padding: "40px 24px" }}
                  onClick={() => fileRef.current.click()}
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={e => { e.preventDefault(); setDragOver(false); uploadPO(e.dataTransfer.files[0]); }}
                >
                  <div style={{ fontSize: 36, marginBottom: 10 }}>📋</div>
                  <div style={{ fontSize: 15, color: "var(--ink)", marginBottom: 4 }}>Drop PO document here</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>PDF · JPG · PNG</div>
                  <input ref={fileRef} type="file" accept=".pdf,image/*" style={{ display: "none" }} onChange={e => uploadPO(e.target.files[0])} />
                </div>
              )}
              <button className="btn-secondary-action" style={{ marginTop: 12 }} onClick={() => setShowUpload(false)}>Cancel</button>
            </div>
          </div>
        )}

        {/* Manual PO form */}
        {showManual && (
          <div className="settings-card">
            <div className="settings-card-title">Create PO Manually</div>
            <div className="settings-card-body">
              <form onSubmit={submitManualPO}>
                <div className="fields-grid" style={{ marginBottom: 16 }}>
                  {[
                    { label: "PO Number *", key: "poNumber", type: "text", placeholder: "PO-2024-001" },
                    { label: "Vendor Name *", key: "vendorName", type: "text", placeholder: "Acme Corp" },
                    { label: "Total Amount *", key: "totalAmount", type: "number", placeholder: "10000" },
                    { label: "Currency", key: "currency", type: "text", placeholder: "USD" },
                    { label: "Issue Date", key: "issueDate", type: "date", placeholder: "" },
                    { label: "Expected Delivery", key: "expectedDelivery", type: "date", placeholder: "" },
                  ].map(f => (
                    <div key={f.key} className="field">
                      <label className="field-label">{f.label}</label>
                      <input
                        className="field-input"
                        type={f.type}
                        placeholder={f.placeholder}
                        value={manualPO[f.key]}
                        onChange={e => setManualPO(p => ({ ...p, [f.key]: e.target.value }))}
                        required={f.label.includes("*")}
                      />
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button className="btn-approve" type="submit" disabled={uploading}>{uploading ? "Creating..." : "Create PO"}</button>
                  <button className="btn-secondary-action" type="button" onClick={() => setShowManual(false)}>Cancel</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* PO Table */}
        <div className="settings-card">
          <div className="invoices-header">
            <div className="invoices-title">All Purchase Orders</div>
            <div className="filter-tabs">
              {["all","open","partially_matched","fully_matched","closed"].map(f => (
                <button key={f} className={`filter-tab ${filter===f?"active":""}`} onClick={() => setFilter(f)}>
                  {f === "all" ? "All" : f.replace(/_/g," ").replace(/\b\w/g,l=>l.toUpperCase())}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="table-loading">Loading purchase orders...</div>
          ) : filtered.length === 0 ? (
            <div className="table-empty">
              <div className="table-empty-icon">📋</div>
              <div className="table-empty-title">{filter === "all" ? "No POs yet" : `No ${filter.replace(/_/g," ")} POs`}</div>
              <div className="table-empty-sub">Upload or create your first purchase order to enable invoice matching</div>
            </div>
          ) : (
            <div className="invoices-table-wrap">
              <table className="invoices-table">
                <thead>
                  <tr>
                    <th>PO Number</th>
                    <th>Vendor</th>
                    <th>Issue Date</th>
                    <th>Delivery</th>
                    <th>Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(po => {
                    const sc = STATUS_COLORS[po.status] || STATUS_COLORS.open;
                    return (
                      <tr key={po.id}>
                        <td className="inv-num">{po.po_number}</td>
                        <td className="inv-vendor">{po.vendor_name || "—"}</td>
                        <td className="inv-date">{po.issue_date || "—"}</td>
                        <td className="inv-date">{po.expected_delivery || "—"}</td>
                        <td className="inv-amount">${Number(po.total_amount||0).toLocaleString("en-US",{minimumFractionDigits:2})}</td>
                        <td><span className="status-badge" style={{ background: sc.bg, color: sc.color }}>{po.status.replace(/_/g," ")}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {toast && <div className={`settings-toast ${toast.type}`}>{toast.type==="success"?"✓":"⚠"} {toast.msg}</div>}
    </div>
  );
}
