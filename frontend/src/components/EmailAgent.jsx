import { useState, useEffect } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

export default function EmailAgent({ user, team, onBack }) {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState(null);
  const [logs, setLogs] = useState([]);

  useEffect(() => { if (team) fetchConfig(); }, [team]);

  const fetchConfig = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/agent/email/${team.id}`);
      const data = await res.json();
      setConfig(data.config);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const connectGmail = async () => {
    try {
      const res = await fetch(`${API}/api/agent/email/gmail/auth-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: team.id, userId: user.id }),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } catch (e) { alert("Failed to connect Gmail: " + e.message); }
  };

  const checkNow = async () => {
    setChecking(true);
    setResult(null);
    try {
      const res = await fetch(`${API}/api/agent/email/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: team.id, userId: user.id }),
      });
      const data = await res.json();
      setResult(data);
    } catch (e) { alert("Check failed: " + e.message); }
    setChecking(false);
  };

  const disconnectEmail = async () => {
    if (!confirm("Disconnect email agent?")) return;
    try {
      await fetch(`${API}/api/agent/email/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: team.id, provider: config?.provider, email: config?.email, enabled: false }),
      });
      setConfig(null);
    } catch (e) { alert("Failed: " + e.message); }
  };

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "32px 24px", fontFamily: "DM Sans,sans-serif" }}>
      <button onClick={onBack} style={{ background: "none", border: "none", color: "#9ca3af", fontSize: 13, cursor: "pointer", marginBottom: 20, fontFamily: "DM Sans,sans-serif" }}>← Back</button>

      {/* Header */}
      <div style={{ background: "linear-gradient(135deg,#0a0f1e,#1a2040)", borderRadius: 16, padding: "32px", marginBottom: 24, color: "white" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 40 }}>📧</div>
          <div>
            <h1 style={{ fontFamily: "Syne,sans-serif", fontSize: 24, fontWeight: 800, margin: 0 }}>Email Invoice Agent</h1>
            <p style={{ color: "rgba(255,255,255,0.45)", fontSize: 14, margin: "4px 0 0" }}>Auto-process invoices from your inbox</p>
          </div>
          <div style={{ marginLeft: "auto", background: config?.enabled ? "rgba(34,197,94,0.1)" : "rgba(255,255,255,0.05)", border: `1px solid ${config?.enabled ? "rgba(34,197,94,0.3)" : "rgba(255,255,255,0.1)"}`, padding: "6px 14px", borderRadius: 20, fontSize: 12, color: config?.enabled ? "#22c55e" : "rgba(255,255,255,0.3)", fontFamily: "DM Mono,monospace" }}>
            {config?.enabled ? "● ACTIVE" : "○ NOT CONNECTED"}
          </div>
        </div>
        <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 14, lineHeight: 1.7, margin: 0 }}>
          Connect your Gmail or Outlook inbox. APFlow checks every 5 minutes for emails with PDF invoice attachments, extracts the data automatically, and pushes to your ERP — zero human touch needed.
        </p>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: "#9ca3af" }}>Loading...</div>
      ) : config?.enabled ? (
        <>
          {/* Connected State */}
          <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 14, padding: "20px 24px", marginBottom: 20, display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ fontSize: 28 }}>✅</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, color: "#16a34a", fontSize: 15 }}>Gmail Connected</div>
              <div style={{ fontSize: 13, color: "#15803d", marginTop: 2 }}>Monitoring: <strong>{config.email}</strong></div>
              {config.last_checked && <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>Last checked: {new Date(config.last_checked).toLocaleString()}</div>}
            </div>
            <button onClick={checkNow} disabled={checking} style={{ background: "#e8531a", color: "white", border: "none", padding: "10px 20px", borderRadius: 10, fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "DM Sans,sans-serif" }}>
              {checking ? "Checking..." : "🔍 Check Now"}
            </button>
            <button onClick={disconnectEmail} style={{ background: "transparent", color: "#dc2626", border: "1px solid #fca5a5", padding: "10px 16px", borderRadius: 10, fontSize: 13, cursor: "pointer", fontFamily: "DM Sans,sans-serif" }}>Disconnect</button>
          </div>

          {/* Check Result */}
          {result && (
            <div style={{ background: result.processed > 0 ? "#f0fdf4" : "#f9fafb", border: `1px solid ${result.processed > 0 ? "#bbf7d0" : "#e5e7eb"}`, borderRadius: 14, padding: "20px 24px", marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: result.processed > 0 ? "#16a34a" : "#6b7280", marginBottom: 8 }}>
                {result.processed > 0 ? `✅ ${result.processed} invoice(s) auto-processed!` : "📭 No new invoices found"}
              </div>
              <div style={{ fontSize: 13, color: "#6b7280" }}>
                {result.processed > 0 ? "Check your dashboard to see the processed invoices." : "No new PDF attachments found since last check."}
              </div>
              {result.emails?.flat?.()?.some(e => e?.skipped) && (
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                  {result.emails.flat().filter(e => e?.skipped).map((e, i) => (
                    <div key={i} style={{ fontSize: 12, color: "#92400e", background: "#fef9c3", border: "1px solid #fde68a", padding: "8px 12px", borderRadius: 8 }}>
                      ⚠️ <strong>#{e.invoiceNumber || "Unknown"}</strong> is a duplicate — already processed on <strong>{e.originalDate || "a previous date"}</strong>. Skipped.
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* How it works */}
          <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 14, padding: "24px" }}>
            <div style={{ fontFamily: "Syne,sans-serif", fontWeight: 700, fontSize: 15, color: "#1a1a2e", marginBottom: 16 }}>How it works</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {[
                { icon: "📨", text: "Supplier emails invoice PDF to your connected Gmail" },
                { icon: "🤖", text: "APFlow detects the email every 5 minutes and downloads the PDF" },
                { icon: "🔍", text: "Claude AI extracts all invoice fields automatically" },
                { icon: "✅", text: "Invoice is validated, matched to POs, and pushed to your ERP" },
                { icon: "📊", text: "You receive a summary email of all auto-processed invoices" },
              ].map((s, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: "#f9fafb", borderRadius: 10 }}>
                  <span style={{ fontSize: 20 }}>{s.icon}</span>
                  <span style={{ fontSize: 13, color: "#4b5563" }}>{s.text}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Connect Options */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
            {/* Gmail */}
            <div style={{ background: "white", border: "1.5px solid #e5e7eb", borderRadius: 16, padding: "28px 24px", transition: "all 0.2s" }}>
              <div style={{ fontSize: 36, marginBottom: 16 }}>📧</div>
              <div style={{ fontFamily: "Syne,sans-serif", fontWeight: 700, fontSize: 18, color: "#1a1a2e", marginBottom: 8 }}>Connect Gmail</div>
              <p style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.7, marginBottom: 20 }}>Connect your Gmail inbox. APFlow will monitor it for invoice emails with PDF attachments and process them automatically.</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
                {["Monitors inbox every 5 minutes", "Detects PDF invoice attachments", "Auto-extracts with Claude AI", "Pushes to ERP automatically"].map((f, i) => (
                  <div key={i} style={{ fontSize: 12, color: "#16a34a", display: "flex", gap: 6 }}><span>✓</span>{f}</div>
                ))}
              </div>
              <button onClick={connectGmail} style={{ width: "100%", background: "#e8531a", color: "white", border: "none", padding: "13px", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "DM Sans,sans-serif" }}>
                Connect Gmail →
              </button>
            </div>

            {/* Outlook */}
            <div style={{ background: "#f9fafb", border: "1.5px solid #e5e7eb", borderRadius: 16, padding: "28px 24px", position: "relative", opacity: 0.7 }}>
              <div style={{ position: "absolute", top: 16, right: 16, background: "#e5e7eb", color: "#6b7280", padding: "3px 10px", borderRadius: 20, fontSize: 11, fontFamily: "DM Mono,monospace" }}>COMING SOON</div>
              <div style={{ fontSize: 36, marginBottom: 16 }}>📨</div>
              <div style={{ fontFamily: "Syne,sans-serif", fontWeight: 700, fontSize: 18, color: "#1a1a2e", marginBottom: 8 }}>Connect Outlook</div>
              <p style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.7, marginBottom: 20 }}>Connect your Microsoft Outlook or Office 365 inbox. Same automatic invoice detection and processing.</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
                {["Monitors Outlook/Office 365", "Detects PDF invoice attachments", "Auto-extracts with Claude AI", "Pushes to ERP automatically"].map((f, i) => (
                  <div key={i} style={{ fontSize: 12, color: "#9ca3af", display: "flex", gap: 6 }}><span>○</span>{f}</div>
                ))}
              </div>
              <button disabled style={{ width: "100%", background: "#e5e7eb", color: "#9ca3af", border: "none", padding: "13px", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: "not-allowed", fontFamily: "DM Sans,sans-serif" }}>
                Coming Soon
              </button>
            </div>
          </div>

          {/* Setup Instructions */}
          <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 14, padding: "20px 24px" }}>
            <div style={{ fontWeight: 700, color: "#92400e", marginBottom: 12, fontSize: 14 }}>⚠️ Before connecting Gmail</div>
            <ol style={{ paddingLeft: 20, fontSize: 13, color: "#78350f", lineHeight: 2 }}>
              <li>Make sure you're connecting the Gmail account that receives supplier invoices</li>
              <li>APFlow will only read emails with PDF attachments — it never reads other emails</li>
              <li>You can disconnect at any time from this page</li>
              <li>We recommend creating a dedicated <strong>ap@yourcompany.com</strong> address for invoices</li>
            </ol>
          </div>
        </>
      )}
    </div>
  );
}
