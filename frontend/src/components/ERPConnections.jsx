import { useState, useEffect } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

function StatusBadge({ status }) {
  const colors = {
    connected:    { bg: "#dcfce7", color: "#16a34a", label: "✓ Connected" },
    disconnected: { bg: "#f3f4f6", color: "#6b7280", label: "Not Connected" },
    error:        { bg: "#fee2e2", color: "#dc2626", label: "⚠ Error" },
  };
  const c = colors[status] || colors.disconnected;
  return <span style={{ background: c.bg, color: c.color, padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600 }}>{c.label}</span>;
}

function ERPCard({ erp, onConnect, onDisconnect, loading }) {
  return (
    <div style={{
      background: "#fff", border: `1px solid ${erp.connected ? "#bbf7d0" : "#e2ddd4"}`,
      borderRadius: 12, padding: 24, transition: "all 0.2s",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
        <div style={{ fontSize: 32 }}>{erp.icon}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 16, marginBottom: 3 }}>{erp.name}</div>
          <div style={{ fontSize: 12, color: "#7a7a6e" }}>{erp.desc}</div>
        </div>
        <StatusBadge status={erp.status} />
      </div>

      {erp.connected ? (
        <div>
          <div style={{ fontSize: 12, color: "#7a7a6e", marginBottom: 12 }}>
            Last synced: {erp.updatedAt ? new Date(erp.updatedAt).toLocaleDateString() : "Never"}
          </div>
          <button
            onClick={() => onDisconnect(erp.id)}
            disabled={loading === erp.id}
            style={{ background: "transparent", border: "1px solid #fecaca", color: "#dc2626", padding: "8px 16px", borderRadius: 7, fontSize: 13, cursor: "pointer", fontFamily: "DM Sans, sans-serif" }}
          >
            {loading === erp.id ? "Disconnecting..." : "Disconnect"}
          </button>
        </div>
      ) : (
        <button
          onClick={() => onConnect(erp.id)}
          disabled={loading === erp.id}
          style={{ background: erp.color, color: "#fff", border: "none", padding: "10px 20px", borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "DM Sans, sans-serif", width: "100%", transition: "opacity 0.2s" }}
        >
          {loading === erp.id ? "Connecting..." : `Connect ${erp.name}`}
        </button>
      )}
    </div>
  );
}

export default function ERPConnections({ user, team, onBack }) {
  const [connections, setConnections] = useState({});
  const [loading, setLoading] = useState(null);
  const [toast, setToast] = useState(null);
  const [showOracleForm, setShowOracleForm] = useState(false);
  const [oracleForm, setOracleForm] = useState({ baseUrl: "", username: "", password: "" });
  const [oracleLoading, setOracleLoading] = useState(false);
  const [selectedERP, setSelectedERP] = useState(null); // for push routing

  useEffect(() => {
    if (team) {
      fetchConnections();
      // Handle QB redirect back
      const params = new URLSearchParams(window.location.search);
      if (params.get("qb_connected") === "true") {
        showToast("QuickBooks connected successfully! 🎉", "success");
        window.history.replaceState({}, "", window.location.pathname);
        fetchConnections();
      }
      if (params.get("qb_error")) {
        showToast("QuickBooks error: " + params.get("qb_error"), "error");
        window.history.replaceState({}, "", window.location.pathname);
      }
    }
  }, [team]);

  const fetchConnections = async () => {
    try {
      const res = await fetch(`${API}/api/erp/connections/${team.id}`);
      const data = await res.json();
      if (data.success) {
        const map = {};
        (data.connections || []).forEach(c => { map[c.erp_type] = c; });
        setConnections(map);
      }
    } catch (e) { console.error("Failed to load connections:", e); }
  };

  const connectQB = async () => {
    setLoading("quickbooks");
    try {
      const res = await fetch(`${API}/api/erp/quickbooks/auth/${team.id}`);
      const data = await res.json();
      if (data.success) window.location.href = data.url; // redirect to QB OAuth
    } catch (e) { showToast(e.message, "error"); }
    setLoading(null);
  };

  const connectOracle = async (e) => {
    e.preventDefault();
    setOracleLoading(true);
    try {
      const res = await fetch(`${API}/api/erp/oracle/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: team.id, ...oracleForm }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      showToast("Oracle Fusion connected successfully! 🎉", "success");
      setShowOracleForm(false);
      fetchConnections();
    } catch (e) { showToast(e.message, "error"); }
    setOracleLoading(false);
  };

  const disconnect = async (erpType) => {
    setLoading(erpType);
    try {
      const res = await fetch(`${API}/api/erp/${erpType}/disconnect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: team.id }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      showToast(`${erpType} disconnected`, "success");
      fetchConnections();
    } catch (e) { showToast(e.message, "error"); }
    setLoading(null);
  };

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const erps = [
    { id: "quickbooks",  name: "QuickBooks Online",      icon: "💚", desc: "Push invoices as Bills directly to QuickBooks",               color: "#2CA01C", connected: connections.quickbooks?.status === "connected",  status: connections.quickbooks?.status  || "disconnected", updatedAt: connections.quickbooks?.updated_at },
    { id: "oracle",      name: "Oracle Fusion Cloud",     icon: "🔴", desc: "Push invoices to Oracle Payables module",                    color: "#C74634", connected: connections.oracle?.status === "connected",      status: connections.oracle?.status      || "disconnected", updatedAt: connections.oracle?.updated_at },
    { id: "sap",         name: "SAP S/4HANA",             icon: "🔵", desc: "Coming soon — SAP integration in development",               color: "#0070f3", connected: false, status: "coming_soon", updatedAt: null },
    { id: "sap_ariba",   name: "SAP Ariba",               icon: "🟣", desc: "Coming soon — SAP Ariba procurement integration",            color: "#6B46C1", connected: false, status: "coming_soon", updatedAt: null },
    { id: "dynamics",    name: "Microsoft Dynamics 365",  icon: "🟦", desc: "Coming soon — Dynamics 365 Finance integration",            color: "#0078D4", connected: false, status: "coming_soon", updatedAt: null },
    { id: "netsuite",    name: "NetSuite",                icon: "🟠", desc: "Coming soon — NetSuite integration in development",          color: "#F57F17", connected: false, status: "coming_soon", updatedAt: null },
    { id: "xero",        name: "Xero",                    icon: "🔷", desc: "Coming soon — Xero accounting integration",                  color: "#13B5EA", connected: false, status: "coming_soon", updatedAt: null },
    { id: "zoho",        name: "Zoho Books",              icon: "🟡", desc: "Coming soon — Zoho Books integration",                       color: "#E8A803", connected: false, status: "coming_soon", updatedAt: null },
    { id: "coupa",       name: "Coupa",                   icon: "🟤", desc: "Coming soon — Coupa procurement integration",                color: "#D4622A", connected: false, status: "coming_soon", updatedAt: null },
    { id: "rillion",     name: "Rillion",                 icon: "⚫", desc: "Coming soon — Rillion AP automation integration",            color: "#374151", connected: false, status: "coming_soon", updatedAt: null },
    { id: "stampli",     name: "Stampli",                 icon: "🔶", desc: "Coming soon — Stampli invoice management integration",       color: "#F59E0B", connected: false, status: "coming_soon", updatedAt: null },
    { id: "mock",        name: "Mock (Demo)",             icon: "⚫", desc: "Demo mode — simulates ERP push for testing",                 color: "#6B7280", connected: connections.mock?.status === "connected",  status: connections.mock?.status || "disconnected", updatedAt: connections.mock?.updated_at },
  ];

  const handleConnect = (erpId) => {
    if (erpId === "quickbooks") connectQB();
    else if (erpId === "oracle") setShowOracleForm(true);
    else showToast("Coming soon!", "info");
  };

  const connectedCount = erps.filter(e => e.connected).length;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px 24px" }}>
      <button style={{ background: "none", border: "none", color: "#7a7a6e", fontSize: 13, cursor: "pointer", marginBottom: 20, fontFamily: "DM Sans, sans-serif" }} onClick={onBack}>← Dashboard</button>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28, flexWrap: "wrap", gap: 14 }}>
        <div>
          <h1 style={{ fontFamily: "Syne, sans-serif", fontSize: 26, fontWeight: 800, marginBottom: 4 }}>ERP Connections</h1>
          <p style={{ color: "#7a7a6e", fontSize: 14 }}>Connect your ERP to automatically sync invoices · {team?.name}</p>
        </div>
        {connectedCount > 0 && (
          <div style={{ background: "#dcfce7", color: "#16a34a", padding: "6px 14px", borderRadius: 20, fontSize: 13, fontWeight: 600 }}>
            {connectedCount} ERP{connectedCount > 1 ? "s" : ""} Connected
          </div>
        )}
      </div>

      {/* How it works */}
      <div style={{ background: "#fff7f4", border: "1px solid #fcd9cc", borderRadius: 10, padding: "14px 18px", marginBottom: 24, fontSize: 13, color: "#92400e", lineHeight: 1.6 }}>
        <strong>How it works:</strong> Connect your ERP below → when you approve an invoice in InvoiceIQ, it automatically creates a Bill/Invoice in your ERP system with all extracted data. No copy-pasting needed.
      </div>

      {/* ERP Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16, marginBottom: 24 }}>
        {erps.map(erp => (
          erp.status === "coming_soon" ? (
            <div key={erp.id} style={{ background: "#faf9f7", border: "1px solid #e2ddd4", borderRadius: 12, padding: 24, opacity: 0.6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 10 }}>
                <div style={{ fontSize: 32 }}>{erp.icon}</div>
                <div>
                  <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 16 }}>{erp.name}</div>
                  <div style={{ fontSize: 12, color: "#7a7a6e" }}>{erp.desc}</div>
                </div>
              </div>
              <span style={{ background: "#f3f4f6", color: "#9ca3af", padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600 }}>Coming Soon</span>
            </div>
          ) : (
            <ERPCard key={erp.id} erp={erp} onConnect={handleConnect} onDisconnect={disconnect} loading={loading} />
          )
        ))}
      </div>

      {/* Oracle Form */}
      {showOracleForm && (
        <div style={{ background: "#fff", border: "1px solid #e2ddd4", borderRadius: 12, padding: 24, marginBottom: 20 }}>
          <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 16, marginBottom: 6 }}>🔴 Connect Oracle Fusion Cloud</div>
          <p style={{ fontSize: 13, color: "#7a7a6e", marginBottom: 20, lineHeight: 1.6 }}>
            Enter your Oracle Fusion Cloud credentials. You need a user with Payables access.
          </p>
          <form onSubmit={connectOracle}>
            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 18 }}>
              <div>
                <label style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "#7a7a6e", fontWeight: 600, display: "block", marginBottom: 5 }}>Oracle Base URL *</label>
                <input
                  style={{ width: "100%", border: "1px solid #e2ddd4", borderRadius: 7, padding: "10px 14px", fontSize: 14, fontFamily: "DM Sans, sans-serif", background: "#f5f2eb" }}
                  placeholder="https://your-instance.fa.us2.oraclecloud.com"
                  value={oracleForm.baseUrl}
                  onChange={e => setOracleForm(f => ({ ...f, baseUrl: e.target.value }))}
                  required
                />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div>
                  <label style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "#7a7a6e", fontWeight: 600, display: "block", marginBottom: 5 }}>Username *</label>
                  <input
                    style={{ width: "100%", border: "1px solid #e2ddd4", borderRadius: 7, padding: "10px 14px", fontSize: 14, fontFamily: "DM Sans, sans-serif", background: "#f5f2eb" }}
                    placeholder="oracle.user@company.com"
                    value={oracleForm.username}
                    onChange={e => setOracleForm(f => ({ ...f, username: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "#7a7a6e", fontWeight: 600, display: "block", marginBottom: 5 }}>Password *</label>
                  <input
                    style={{ width: "100%", border: "1px solid #e2ddd4", borderRadius: 7, padding: "10px 14px", fontSize: 14, fontFamily: "DM Sans, sans-serif", background: "#f5f2eb" }}
                    type="password"
                    placeholder="••••••••"
                    value={oracleForm.password}
                    onChange={e => setOracleForm(f => ({ ...f, password: e.target.value }))}
                    required
                  />
                </div>
              </div>
            </div>
            <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#1d4ed8", marginBottom: 16 }}>
              ℹ️ The user needs: <strong>Payables Invoice Entry</strong> and <strong>Payables Invoice Inquiry</strong> roles in Oracle Fusion.
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button type="submit" disabled={oracleLoading} style={{ background: "#C74634", color: "#fff", border: "none", padding: "11px 22px", borderRadius: 7, fontSize: 14, fontWeight: 500, cursor: "pointer", fontFamily: "DM Sans, sans-serif" }}>
                {oracleLoading ? "Testing Connection..." : "Connect Oracle Fusion →"}
              </button>
              <button type="button" onClick={() => setShowOracleForm(false)} style={{ background: "transparent", border: "1px solid #e2ddd4", color: "#7a7a6e", padding: "11px 18px", borderRadius: 7, fontSize: 13, cursor: "pointer", fontFamily: "DM Sans, sans-serif" }}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* QuickBooks setup guide */}
      <div style={{ background: "#fff", border: "1px solid #e2ddd4", borderRadius: 12, padding: 24 }}>
        <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 12 }}>📋 Setup Guide</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, color: "#2CA01C", marginBottom: 8 }}>💚 QuickBooks Setup</div>
            <ol style={{ paddingLeft: 18, fontSize: 13, color: "#7a7a6e", lineHeight: 1.8 }}>
              <li>Go to <strong>developer.intuit.com</strong></li>
              <li>Create an app → copy Client ID & Secret</li>
              <li>Add to Render env: <code style={{ background: "#f5f2eb", padding: "1px 6px", borderRadius: 4 }}>QB_CLIENT_ID</code>, <code style={{ background: "#f5f2eb", padding: "1px 6px", borderRadius: 4 }}>QB_CLIENT_SECRET</code></li>
              <li>Set redirect URI: <code style={{ background: "#f5f2eb", padding: "1px 6px", borderRadius: 4, fontSize: 11 }}>{API}/api/erp/quickbooks/callback</code></li>
              <li>Click "Connect QuickBooks" above</li>
            </ol>
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, color: "#C74634", marginBottom: 8 }}>🔴 Oracle Fusion Setup</div>
            <ol style={{ paddingLeft: 18, fontSize: 13, color: "#7a7a6e", lineHeight: 1.8 }}>
              <li>Get your Oracle Fusion Cloud URL</li>
              <li>Create a service account user in Oracle</li>
              <li>Assign Payables roles to the user</li>
              <li>Enable REST API access in Oracle</li>
              <li>Click "Connect Oracle Fusion" above</li>
            </ol>
          </div>
        </div>
      </div>

      {toast && (
        <div style={{
          position: "fixed", bottom: 28, right: 28, padding: "13px 20px", borderRadius: 9,
          fontSize: 14, fontWeight: 500, zIndex: 999,
          background: toast.type === "success" ? "#0a0f1e" : toast.type === "info" ? "#1d4ed8" : "#dc2626",
          color: "#fff", boxShadow: "0 8px 28px rgba(0,0,0,0.12)",
          animation: "slideUp 0.3s ease",
        }}>
          {toast.type === "success" ? "✓" : "ℹ"} {toast.msg}
        </div>
      )}
      <style>{`@keyframes slideUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }`}</style>
    </div>
  );
}
