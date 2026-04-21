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
  const [showNetSuiteForm, setShowNetSuiteForm] = useState(false);
  const [netsuiteForm, setNetsuiteForm] = useState({ accountId: "", consumerKey: "", consumerSecret: "", tokenId: "", tokenSecret: "" });
  const [netsuiteLoading, setNetsuiteLoading] = useState(false);
  const [showDynamicsForm, setShowDynamicsForm] = useState(false);
  const [dynamicsForm, setDynamicsForm] = useState({ tenantId: "", clientId: "", clientSecret: "", resourceUrl: "", legalEntity: "USMF" });
  const [dynamicsLoading, setDynamicsLoading] = useState(false);
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
      if (params.get("xero_connected") === "true") {
        showToast("Xero connected successfully! 🎉", "success");
        window.history.replaceState({}, "", window.location.pathname);
        fetchConnections();
      }
      if (params.get("xero_error")) {
        showToast("Xero error: " + params.get("xero_error"), "error");
        window.history.replaceState({}, "", window.location.pathname);
      }
      if (params.get("zoho_connected") === "true") {
        showToast("Zoho Books connected successfully! 🎉", "success");
        window.history.replaceState({}, "", window.location.pathname);
        fetchConnections();
      }
      if (params.get("zoho_error")) {
        showToast("Zoho Books error: " + params.get("zoho_error"), "error");
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

  const connectNetSuite = async (e) => {
    e.preventDefault();
    setNetsuiteLoading(true);
    try {
      const res = await fetch(`${API}/api/erp/netsuite/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: team.id, ...netsuiteForm }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      showToast("NetSuite connected successfully! 🎉", "success");
      setShowNetSuiteForm(false);
      fetchConnections();
    } catch (e) { showToast(e.message, "error"); }
    setNetsuiteLoading(false);
  };

  const connectXero = async () => {
    setLoading("xero");
    try {
      const res = await fetch(`${API}/api/erp/xero/auth/${team.id}`);
      const data = await res.json();
      if (data.success) window.location.href = data.url;
    } catch (e) { showToast(e.message, "error"); }
    setLoading(null);
  };

  const connectZoho = async () => {
    setLoading("zoho");
    try {
      const res = await fetch(`${API}/api/erp/zoho/auth/${team.id}`);
      const data = await res.json();
      if (data.success) window.location.href = data.url;
    } catch (e) { showToast(e.message, "error"); }
    setLoading(null);
  };

  const connectDynamics = async (e) => {
    e.preventDefault();
    setDynamicsLoading(true);
    try {
      const res = await fetch(`${API}/api/erp/dynamics/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: team.id, ...dynamicsForm }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      showToast("Microsoft Dynamics 365 connected successfully! 🎉", "success");
      setShowDynamicsForm(false);
      fetchConnections();
    } catch (e) { showToast(e.message, "error"); }
    setDynamicsLoading(false);
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
    { id: "dynamics",    name: "Microsoft Dynamics 365",  icon: "🟦", desc: "Push invoices to Dynamics 365 — freight & charge lines mapped", color: "#0078D4", connected: connections.dynamics?.status === "connected", status: connections.dynamics?.status || "disconnected", updatedAt: connections.dynamics?.updated_at },
    { id: "netsuite",    name: "NetSuite",                icon: "🟠", desc: "Push invoices to NetSuite as Vendor Bills — freight lines auto-mapped", color: "#F57F17", connected: connections.netsuite?.status === "connected", status: connections.netsuite?.status || "disconnected", updatedAt: connections.netsuite?.updated_at },
    { id: "xero",        name: "Xero",                    icon: "🔷", desc: "Push invoices to Xero as Bills — freight lines auto-mapped", color: "#13B5EA", connected: connections.xero?.status === "connected",     status: connections.xero?.status     || "disconnected", updatedAt: connections.xero?.updated_at },
    { id: "zoho",        name: "Zoho Books",              icon: "🟡", desc: "Push invoices to Zoho Books as Bills — multi-currency ready", color: "#E8A803", connected: connections.zoho?.status === "connected",     status: connections.zoho?.status     || "disconnected", updatedAt: connections.zoho?.updated_at },
    { id: "coupa",       name: "Coupa",                   icon: "🟤", desc: "Coming soon — Coupa procurement integration",                color: "#D4622A", connected: false, status: "coming_soon", updatedAt: null },
    { id: "rillion",     name: "Rillion",                 icon: "⚫", desc: "Coming soon — Rillion AP automation integration",            color: "#374151", connected: false, status: "coming_soon", updatedAt: null },
    { id: "stampli",     name: "Stampli",                 icon: "🔶", desc: "Coming soon — Stampli invoice management integration",       color: "#F59E0B", connected: false, status: "coming_soon", updatedAt: null },
    { id: "mock",        name: "Mock (Demo)",             icon: "⚫", desc: "Demo mode — simulates ERP push for testing",                 color: "#6B7280", connected: connections.mock?.status === "connected",  status: connections.mock?.status || "disconnected", updatedAt: connections.mock?.updated_at },
  ];

  const handleConnect = (erpId) => {
    if (erpId === "quickbooks") connectQB();
    else if (erpId === "oracle") setShowOracleForm(true);
    else if (erpId === "netsuite") setShowNetSuiteForm(true);
    else if (erpId === "xero") connectXero();
    else if (erpId === "zoho") connectZoho();
    else if (erpId === "dynamics") setShowDynamicsForm(true);
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
        <strong>How it works:</strong> Connect your ERP below → when you approve an invoice in Billtiq, it automatically creates a Bill/Invoice in your ERP system with all extracted data. No copy-pasting needed.
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
            Enter your Oracle Fusion Cloud credentials for your integration user.
          </p>
          <form onSubmit={connectOracle}>
            <div style={{ background: "#fef9c3", border: "1px solid #fde68a", borderRadius: 10, padding: "14px 16px", marginBottom: 18 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: "#92400e", marginBottom: 10 }}>⚠️ Before connecting — one-time IT setup required</div>
              <p style={{ fontSize: 12, color: "#92400e", marginBottom: 10, lineHeight: 1.6 }}>
                Ask your Oracle Fusion admin to grant your <strong>integration user</strong> these roles:
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
                <div style={{ background: "rgba(146,64,14,0.08)", borderRadius: 6, padding: "6px 12px", fontFamily: "DM Mono, monospace", fontSize: 12, color: "#92400e" }}>Payables Invoice Entry</div>
                <div style={{ background: "rgba(146,64,14,0.08)", borderRadius: 6, padding: "6px 12px", fontFamily: "DM Mono, monospace", fontSize: 12, color: "#92400e" }}>Payables Invoice Inquiry</div>
              </div>
              <p style={{ fontSize: 12, color: "#78350f", lineHeight: 1.5 }}>
                ✅ This is a <strong>one-time setup</strong>. Team members uploading invoices do <strong>not</strong> need Oracle access.
              </p>
            </div>
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
            <div style={{ display: "flex", gap: 10 }}>
              <button type="submit" disabled={oracleLoading} style={{ background: "#C74634", color: "#fff", border: "none", padding: "11px 22px", borderRadius: 7, fontSize: 14, fontWeight: 500, cursor: "pointer", fontFamily: "DM Sans, sans-serif" }}>
                {oracleLoading ? "Testing Connection..." : "Connect Oracle Fusion →"}
              </button>
              <button type="button" onClick={() => setShowOracleForm(false)} style={{ background: "transparent", border: "1px solid #e2ddd4", color: "#7a7a6e", padding: "11px 18px", borderRadius: 7, fontSize: 13, cursor: "pointer", fontFamily: "DM Sans, sans-serif" }}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* NetSuite Form */}
      {showNetSuiteForm && (
        <div style={{ background: "#fff", border: "1px solid #e2ddd4", borderRadius: 12, padding: 24, marginBottom: 20 }}>
          <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 16, marginBottom: 6 }}>🟠 Connect NetSuite</div>
          <p style={{ fontSize: 13, color: "#7a7a6e", marginBottom: 20, lineHeight: 1.6 }}>
            NetSuite uses Token-Based Authentication (TBA). You'll need to create an Integration record and Token in NetSuite first.
          </p>
          <div style={{ background: "#fff7f4", border: "1px solid #fcd9cc", borderRadius: 10, padding: "14px 16px", marginBottom: 18 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: "#92400e", marginBottom: 8 }}>⚠️ Before connecting — NetSuite setup required</div>
            <ol style={{ paddingLeft: 18, fontSize: 12, color: "#92400e", lineHeight: 1.8 }}>
              <li>In NetSuite → Setup → Integration → Manage Integrations → New</li>
              <li>Enable Token-Based Authentication → Save → Copy Consumer Key & Secret</li>
              <li>Setup → Users/Roles → Access Tokens → New → Select your user → Save</li>
              <li>Copy Token ID & Token Secret (shown once only)</li>
              <li>Find your Account ID in NetSuite URL (e.g. 1234567 from 1234567.app.netsuite.com)</li>
            </ol>
          </div>
          <form onSubmit={connectNetSuite}>
            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 18 }}>
              <div>
                <label style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "#7a7a6e", fontWeight: 600, display: "block", marginBottom: 5 }}>NetSuite Account ID *</label>
                <input style={{ width: "100%", border: "1px solid #e2ddd4", borderRadius: 7, padding: "10px 14px", fontSize: 14, fontFamily: "DM Sans, sans-serif", background: "#f5f2eb" }}
                  placeholder="e.g. 1234567 or TSTDRV123456" value={netsuiteForm.accountId}
                  onChange={e => setNetsuiteForm(f => ({ ...f, accountId: e.target.value }))} required />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div>
                  <label style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "#7a7a6e", fontWeight: 600, display: "block", marginBottom: 5 }}>Consumer Key *</label>
                  <input style={{ width: "100%", border: "1px solid #e2ddd4", borderRadius: 7, padding: "10px 14px", fontSize: 14, fontFamily: "DM Sans, sans-serif", background: "#f5f2eb" }}
                    placeholder="From Integration record" value={netsuiteForm.consumerKey}
                    onChange={e => setNetsuiteForm(f => ({ ...f, consumerKey: e.target.value }))} required />
                </div>
                <div>
                  <label style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "#7a7a6e", fontWeight: 600, display: "block", marginBottom: 5 }}>Consumer Secret *</label>
                  <input type="password" style={{ width: "100%", border: "1px solid #e2ddd4", borderRadius: 7, padding: "10px 14px", fontSize: 14, fontFamily: "DM Sans, sans-serif", background: "#f5f2eb" }}
                    placeholder="••••••••" value={netsuiteForm.consumerSecret}
                    onChange={e => setNetsuiteForm(f => ({ ...f, consumerSecret: e.target.value }))} required />
                </div>
                <div>
                  <label style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "#7a7a6e", fontWeight: 600, display: "block", marginBottom: 5 }}>Token ID *</label>
                  <input style={{ width: "100%", border: "1px solid #e2ddd4", borderRadius: 7, padding: "10px 14px", fontSize: 14, fontFamily: "DM Sans, sans-serif", background: "#f5f2eb" }}
                    placeholder="From Access Token" value={netsuiteForm.tokenId}
                    onChange={e => setNetsuiteForm(f => ({ ...f, tokenId: e.target.value }))} required />
                </div>
                <div>
                  <label style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "#7a7a6e", fontWeight: 600, display: "block", marginBottom: 5 }}>Token Secret *</label>
                  <input type="password" style={{ width: "100%", border: "1px solid #e2ddd4", borderRadius: 7, padding: "10px 14px", fontSize: 14, fontFamily: "DM Sans, sans-serif", background: "#f5f2eb" }}
                    placeholder="••••••••" value={netsuiteForm.tokenSecret}
                    onChange={e => setNetsuiteForm(f => ({ ...f, tokenSecret: e.target.value }))} required />
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button type="submit" disabled={netsuiteLoading} style={{ background: "#F57F17", color: "#fff", border: "none", padding: "11px 22px", borderRadius: 7, fontSize: 14, fontWeight: 500, cursor: "pointer", fontFamily: "DM Sans, sans-serif" }}>
                {netsuiteLoading ? "Testing Connection..." : "Connect NetSuite →"}
              </button>
              <button type="button" onClick={() => setShowNetSuiteForm(false)} style={{ background: "transparent", border: "1px solid #e2ddd4", color: "#7a7a6e", padding: "11px 18px", borderRadius: 7, fontSize: 13, cursor: "pointer", fontFamily: "DM Sans, sans-serif" }}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Dynamics 365 Form */}
      {showDynamicsForm && (
        <div style={{ background: "#fff", border: "1px solid #e2ddd4", borderRadius: 12, padding: 24, marginBottom: 20 }}>
          <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 16, marginBottom: 6 }}>🟦 Connect Microsoft Dynamics 365</div>
          <p style={{ fontSize: 13, color: "#7a7a6e", marginBottom: 20, lineHeight: 1.6 }}>
            Dynamics 365 uses Azure App Registration (Client Credentials). Create an app in Azure AD first.
          </p>
          <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 10, padding: "14px 16px", marginBottom: 18 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: "#1e40af", marginBottom: 8 }}>🔵 Before connecting — Azure setup required</div>
            <ol style={{ paddingLeft: 18, fontSize: 12, color: "#1e40af", lineHeight: 1.8 }}>
              <li>Azure Portal → App Registrations → New Registration</li>
              <li>Certificates & Secrets → New Client Secret → Copy Secret Value</li>
              <li>API Permissions → Add → Dynamics ERP → user_impersonation</li>
              <li>Your Tenant ID is in Azure AD → Overview</li>
              <li>Resource URL is your Dynamics environment URL (e.g. https://yourorg.operations.dynamics.com)</li>
            </ol>
          </div>
          <form onSubmit={connectDynamics}>
            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 18 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div>
                  <label style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "#7a7a6e", fontWeight: 600, display: "block", marginBottom: 5 }}>Azure Tenant ID *</label>
                  <input style={{ width: "100%", border: "1px solid #e2ddd4", borderRadius: 7, padding: "10px 14px", fontSize: 14, fontFamily: "DM Sans, sans-serif", background: "#f5f2eb" }}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" value={dynamicsForm.tenantId}
                    onChange={e => setDynamicsForm(f => ({ ...f, tenantId: e.target.value }))} required />
                </div>
                <div>
                  <label style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "#7a7a6e", fontWeight: 600, display: "block", marginBottom: 5 }}>Client ID *</label>
                  <input style={{ width: "100%", border: "1px solid #e2ddd4", borderRadius: 7, padding: "10px 14px", fontSize: 14, fontFamily: "DM Sans, sans-serif", background: "#f5f2eb" }}
                    placeholder="App Registration Client ID" value={dynamicsForm.clientId}
                    onChange={e => setDynamicsForm(f => ({ ...f, clientId: e.target.value }))} required />
                </div>
                <div>
                  <label style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "#7a7a6e", fontWeight: 600, display: "block", marginBottom: 5 }}>Client Secret *</label>
                  <input type="password" style={{ width: "100%", border: "1px solid #e2ddd4", borderRadius: 7, padding: "10px 14px", fontSize: 14, fontFamily: "DM Sans, sans-serif", background: "#f5f2eb" }}
                    placeholder="••••••••" value={dynamicsForm.clientSecret}
                    onChange={e => setDynamicsForm(f => ({ ...f, clientSecret: e.target.value }))} required />
                </div>
                <div>
                  <label style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "#7a7a6e", fontWeight: 600, display: "block", marginBottom: 5 }}>Legal Entity *</label>
                  <input style={{ width: "100%", border: "1px solid #e2ddd4", borderRadius: 7, padding: "10px 14px", fontSize: 14, fontFamily: "DM Sans, sans-serif", background: "#f5f2eb" }}
                    placeholder="e.g. USMF" value={dynamicsForm.legalEntity}
                    onChange={e => setDynamicsForm(f => ({ ...f, legalEntity: e.target.value }))} required />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "#7a7a6e", fontWeight: 600, display: "block", marginBottom: 5 }}>Dynamics Resource URL *</label>
                <input style={{ width: "100%", border: "1px solid #e2ddd4", borderRadius: 7, padding: "10px 14px", fontSize: 14, fontFamily: "DM Sans, sans-serif", background: "#f5f2eb" }}
                  placeholder="https://yourorg.operations.dynamics.com" value={dynamicsForm.resourceUrl}
                  onChange={e => setDynamicsForm(f => ({ ...f, resourceUrl: e.target.value }))} required />
              </div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button type="submit" disabled={dynamicsLoading} style={{ background: "#0078D4", color: "#fff", border: "none", padding: "11px 22px", borderRadius: 7, fontSize: 14, fontWeight: 500, cursor: "pointer", fontFamily: "DM Sans, sans-serif" }}>
                {dynamicsLoading ? "Testing Connection..." : "Connect Dynamics 365 →"}
              </button>
              <button type="button" onClick={() => setShowDynamicsForm(false)} style={{ background: "transparent", border: "1px solid #e2ddd4", color: "#7a7a6e", padding: "11px 18px", borderRadius: 7, fontSize: 13, cursor: "pointer", fontFamily: "DM Sans, sans-serif" }}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* QuickBooks setup guide */}
      <div style={{ background: "#fff", border: "1px solid #e2ddd4", borderRadius: 12, padding: 24 }}>
        <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 12 }}>📋 Setup Guide</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20 }}>
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
            <div style={{ fontWeight: 600, fontSize: 14, color: "#F57F17", marginBottom: 8 }}>🟠 NetSuite Setup</div>
            <ol style={{ paddingLeft: 18, fontSize: 13, color: "#7a7a6e", lineHeight: 1.8 }}>
              <li>Setup → Integration → Manage Integrations → New</li>
              <li>Enable Token-Based Auth → Copy Consumer Key/Secret</li>
              <li>Setup → Access Tokens → New → Copy Token ID/Secret</li>
              <li>Find Account ID in your NetSuite URL</li>
              <li>Click "Connect NetSuite" above</li>
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
