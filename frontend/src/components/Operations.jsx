import { useState, useEffect } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

const TABS = [
  { key: "exception_triage",  label: "Exception Triage",  icon: "🚦", desc: "Prioritizes invoices with match exceptions or anomalies." },
  { key: "vendor_status",     label: "Vendor Status",     icon: "🏢", desc: "Vendors not yet resolved to an ERP supplier." },
  { key: "po_acknowledgment", label: "PO Acknowledgment", icon: "📋", desc: "Invoices with a PO that need supplier acknowledgment." },
];

const STATUS_STYLE = {
  open:        { bg: "#eff6ff", color: "#2563eb", label: "OPEN" },
  in_progress: { bg: "#fffbeb", color: "#d97706", label: "IN PROGRESS" },
  resolved:    { bg: "#f0fdf4", color: "#16a34a", label: "RESOLVED" },
  dismissed:   { bg: "#f3f4f6", color: "#6b7280", label: "DISMISSED" },
};

const RISK_COLOR = { high: "#dc2626", medium: "#d97706", low: "#16a34a" };

function money(n) {
  return `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
}

export default function Operations({ user, team, onBack }) {
  const [activeTab, setActiveTab] = useState("exception_triage");
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [lastRun, setLastRun] = useState(null);

  useEffect(() => { if (team) fetchTasks(); }, [team, activeTab]);

  const fetchTasks = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch(`${API}/api/operations/${team.id}?type=${activeTab}`);
      const data = await res.json();
      setTasks(data.tasks || []);
    } catch (e) { console.error(e); }
    if (!silent) setLoading(false);
  };

  const runAgent = async () => {
    setRunning(true);
    setLastRun(null);
    try {
      const res = await fetch(`${API}/api/operations/run/${activeTab}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: team.id, userId: user.id }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Run failed");
      setLastRun(data.data);
      await fetchTasks(true);
    } catch (e) { alert("Run failed: " + e.message); }
    setRunning(false);
  };

  const updateStatus = async (taskId, status) => {
    setBusyId(taskId);
    try {
      const res = await fetch(`${API}/api/operations/task/${taskId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: team.id, status }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Update failed");
      await fetchTasks(true);
    } catch (e) { alert(e.message); }
    setBusyId(null);
  };

  const sendPoAck = async (taskId) => {
    if (!confirm("Send a PO acknowledgment request to the supplier?")) return;
    setBusyId(taskId);
    try {
      const res = await fetch(`${API}/api/operations/po-ack/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: team.id, taskId }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.data?.reason || data.error || "Send failed");
      alert("Acknowledgment request sent ✓");
      await fetchTasks(true);
    } catch (e) { alert("Send failed: " + e.message); }
    setBusyId(null);
  };

  const tab = TABS.find(t => t.key === activeTab);
  const openCount = tasks.filter(t => t.status === "open").length;

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: "32px 24px", fontFamily: "DM Sans,sans-serif" }}>
      <button onClick={onBack} style={{ background: "none", border: "none", color: "#9ca3af", fontSize: 13, cursor: "pointer", marginBottom: 20, fontFamily: "DM Sans,sans-serif" }}>← Back</button>

      {/* Header */}
      <div style={{ background: "linear-gradient(135deg,#0a0f1e,#1a2040)", borderRadius: 16, padding: "32px", marginBottom: 24, color: "white" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ fontSize: 40 }}>🛠️</div>
          <div>
            <h1 style={{ fontFamily: "Syne,sans-serif", fontSize: 24, fontWeight: 800, margin: 0 }}>Operations</h1>
            <p style={{ color: "rgba(255,255,255,0.45)", fontSize: 14, margin: "4px 0 0" }}>On-demand AP operations agents</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            style={{
              flex: 1, padding: "14px 12px", borderRadius: 12, cursor: "pointer", fontFamily: "DM Sans,sans-serif",
              border: activeTab === t.key ? "2px solid #e8531a" : "1px solid #e2ddd4",
              background: activeTab === t.key ? "#fff4f0" : "white",
            }}>
            <div style={{ fontSize: 22, marginBottom: 4 }}>{t.icon}</div>
            <div style={{ fontWeight: 600, fontSize: 13, color: activeTab === t.key ? "#e8531a" : "#0a0f1e" }}>{t.label}</div>
          </button>
        ))}
      </div>

      {/* Run bar */}
      <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 14, padding: "20px 24px", marginBottom: 20, display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#1a1a2e" }}>{tab.label}</div>
          <div style={{ fontSize: 13, color: "#6b7280", marginTop: 2 }}>{tab.desc}</div>
          {lastRun && (
            <div style={{ fontSize: 12, color: "#16a34a", marginTop: 6 }}>
              Last run: {lastRun.created} new task{lastRun.created === 1 ? "" : "s"} created.
            </div>
          )}
        </div>
        <button onClick={runAgent} disabled={running}
          style={{ background: "#e8531a", color: "white", border: "none", padding: "11px 22px", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: running ? "default" : "pointer", fontFamily: "DM Sans,sans-serif", opacity: running ? 0.7 : 1 }}>
          {running ? "⏳ Running..." : "▶ Run agent"}
        </button>
      </div>

      {/* Task list */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: "#9ca3af" }}>Loading...</div>
      ) : tasks.length === 0 ? (
        <div style={{ background: "#f9fafb", border: "1px dashed #e5e7eb", borderRadius: 14, padding: 40, textAlign: "center", color: "#6b7280", fontSize: 14 }}>
          No tasks yet. Click <strong>Run agent</strong> to scan your invoices.
        </div>
      ) : (
        <>
          <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 10 }}>{tasks.length} task{tasks.length === 1 ? "" : "s"} · {openCount} open</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {tasks.map(t => {
              const p = t.payload || {};
              const ss = STATUS_STYLE[t.status] || STATUS_STYLE.open;
              return (
                <div key={t.id} style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 12, padding: "16px 20px" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      {/* Title line per agent type */}
                      {activeTab === "exception_triage" && (
                        <>
                          <div style={{ fontSize: 14, fontWeight: 700, color: "#1a1a2e" }}>
                            #{p.invoice_number || "—"} · {p.vendor_name || "Unknown vendor"}
                            {p.risk_level && (
                              <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: RISK_COLOR[p.risk_level] || "#6b7280", background: `${RISK_COLOR[p.risk_level] || "#6b7280"}1a`, padding: "2px 8px", borderRadius: 20 }}>
                                {String(p.risk_level).toUpperCase()} RISK
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 13, color: "#6b7280", marginTop: 3 }}>
                            {money(p.total)}{p.match_status ? ` · match: ${p.match_status}` : ""}
                          </div>
                          {p.summary && <div style={{ fontSize: 12, color: "#4b5563", marginTop: 6 }}>{p.summary}</div>}
                        </>
                      )}
                      {activeTab === "vendor_status" && (
                        <>
                          <div style={{ fontSize: 14, fontWeight: 700, color: "#1a1a2e" }}>{p.vendor_name || "Unknown vendor"}</div>
                          <div style={{ fontSize: 13, color: "#6b7280", marginTop: 3 }}>
                            {p.invoice_count || 0} invoice{p.invoice_count === 1 ? "" : "s"} · {money(p.total_billed)} billed
                            {p.vendor_email ? ` · ${p.vendor_email}` : ""}
                          </div>
                          <div style={{ fontSize: 12, color: "#d97706", marginTop: 6 }}>Not yet resolved to an ERP supplier.</div>
                        </>
                      )}
                      {activeTab === "po_acknowledgment" && (
                        <>
                          <div style={{ fontSize: 14, fontWeight: 700, color: "#1a1a2e" }}>
                            #{p.invoice_number || "—"} · {p.vendor_name || "Unknown vendor"}
                          </div>
                          <div style={{ fontSize: 13, color: "#6b7280", marginTop: 3 }}>
                            PO {p.po_number || "—"} · {money(p.total)}
                            {p.supplier_email ? ` · ${p.supplier_email}` : " · no supplier email"}
                          </div>
                          {p.ack_status === "sent" && <div style={{ fontSize: 12, color: "#16a34a", marginTop: 6 }}>✓ Acknowledgment request sent</div>}
                        </>
                      )}
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 600, color: ss.color, background: ss.bg, padding: "3px 10px", borderRadius: 20, whiteSpace: "nowrap" }}>{ss.label}</span>
                  </div>

                  {/* Actions */}
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    {activeTab === "po_acknowledgment" && p.ack_status !== "sent" && (
                      <button onClick={() => sendPoAck(t.id)} disabled={busyId === t.id || !p.supplier_email}
                        title={p.supplier_email ? "" : "No supplier email on file"}
                        style={{ background: "#2563eb", color: "white", border: "none", padding: "8px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: (busyId === t.id || !p.supplier_email) ? "default" : "pointer", fontFamily: "DM Sans,sans-serif", opacity: (busyId === t.id || !p.supplier_email) ? 0.5 : 1 }}>
                        {busyId === t.id ? "Sending..." : "✉ Send request"}
                      </button>
                    )}
                    {t.status !== "resolved" && (
                      <button onClick={() => updateStatus(t.id, "resolved")} disabled={busyId === t.id}
                        style={{ background: "white", border: "1px solid #bbf7d0", color: "#16a34a", padding: "8px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "DM Sans,sans-serif" }}>
                        ✓ Resolve
                      </button>
                    )}
                    {t.status !== "dismissed" && (
                      <button onClick={() => updateStatus(t.id, "dismissed")} disabled={busyId === t.id}
                        style={{ background: "white", border: "1px solid #e5e7eb", color: "#6b7280", padding: "8px 14px", borderRadius: 8, fontSize: 12, cursor: "pointer", fontFamily: "DM Sans,sans-serif" }}>
                        Dismiss
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
