import { useState, useEffect } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

export default function EmailAgent({ user, team, onBack }) {
  const [config, setConfig] = useState(null);
  const [connectionMethod, setConnectionMethod] = useState("gmail"); // "gmail" or "imap"
  const [imapForm, setImapForm] = useState({ host: "", port: "993", email: "", password: "" });
  const [imapLoading, setImapLoading] = useState(false);
  const [imapTesting, setImapTesting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => { if (team) fetchConfig(); }, [team]);

  const fetchConfig = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch(`${API}/api/agent/email/${team.id}`);
      const data = await res.json();
      setConfig(data.config);
    } catch (e) { console.error(e); }
    if (!silent) setLoading(false);
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
      await fetchConfig(true); // refresh last_checked timestamp silently
    } catch (e) { alert("Check failed: " + e.message); }
    setChecking(false);
  };

  const connectImap = async (e) => {
    e.preventDefault();
    setImapLoading(true);
    try {
      const res = await fetch(`${API}/api/agent/email/imap/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: team.id, ...imapForm }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      showToast("Email inbox connected successfully! 🎉", "success");
      fetchConfig();
    } catch (e) { showToast(e.message, "error"); }
    setImapLoading(false);
  };

  const testImap = async () => {
    setImapTesting(true);
    try {
      const res = await fetch(`${API}/api/agent/email/imap/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(imapForm),
      });
      const data = await res.json();
      if (data.success) showToast("Connection successful! ✓", "success");
      else showToast("Connection failed: " + data.error, "error");
    } catch (e) { showToast(e.message, "error"); }
    setImapTesting(false);
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

  // ── Parse result into flat list of invoice items ──────────────
  const parseResultItems = (result) => {
    if (!result) return { processed: [], skipped: [], failed: [] };
    const all = (result.emails || []).flat().filter(Boolean);
    return {
      processed: all.filter(e => !e.skipped && e.erpRef),
      skipped: all.filter(e => e.skipped),
      failed: all.filter(e => e.failed),
    };
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
          Connect your email inbox. APFlow checks every 5 minutes for emails with PDF and ZIP invoice attachments, extracts the data automatically, and pushes to your ERP — zero human touch needed.
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
              <div style={{ fontWeight: 700, color: "#16a34a", fontSize: 15 }}>Email Inbox Connected</div>
              <div style={{ fontSize: 13, color: "#15803d", marginTop: 2 }}>Monitoring: <strong>{config.email}</strong></div>
              {config.last_checked && <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>Last checked: {new Date(config.last_checked).toLocaleString()}</div>}
            </div>
            <button onClick={checkNow} disabled={checking} style={{ background: "#e8531a", color: "white", border: "none", padding: "10px 20px", borderRadius: 10, fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "DM Sans,sans-serif" }}>
              {checking ? "⏳ Checking..." : "🔍 Check Now"}
            </button>
            <button onClick={disconnectEmail} style={{ background: "transparent", color: "#dc2626", border: "1px solid #fca5a5", padding: "10px 16px", borderRadius: 10, fontSize: 13, cursor: "pointer", fontFamily: "DM Sans,sans-serif" }}>Disconnect</button>
          </div>

          {/* ── Check Result ── */}
          {result && (() => {
            const { processed, skipped } = parseResultItems(result);
            const totalProcessed = result.processed || 0;
            const hasResults = totalProcessed > 0 || skipped.length > 0;

            return (
              <div style={{ background: "white", border: `1px solid ${totalProcessed > 0 ? "#bbf7d0" : "#e5e7eb"}`, borderRadius: 14, padding: "20px 24px", marginBottom: 20 }}>

                {/* Summary header */}
                <div style={{ display: "flex", gap: 16, marginBottom: hasResults ? 16 : 0 }}>
                  <div style={{ flex: 1, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: "12px 16px", textAlign: "center" }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: "#16a34a" }}>{totalProcessed}</div>
                    <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>Processed</div>
                  </div>
                  <div style={{ flex: 1, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "12px 16px", textAlign: "center" }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: "#d97706" }}>{skipped.length}</div>
                    <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>Duplicates</div>
                  </div>
                  <div style={{ flex: 1, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "12px 16px", textAlign: "center" }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: "#dc2626" }}>{result.failed || 0}</div>
                    <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>Failed</div>
                  </div>
                </div>

                {/* No results */}
                {!hasResults && (
                  <div style={{ fontSize: 13, color: "#6b7280", textAlign: "center", paddingTop: 8 }}>
                    📭 No new PDF attachments found since last check.
                  </div>
                )}

                {/* Per-invoice rows */}
                {hasResults && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {/* Processed invoices */}
                    {processed.map((inv, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: "#f9fafb", borderRadius: 10, border: "1px solid #e5e7eb" }}>
                        <span style={{ fontSize: 18 }}>✅</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#1a1a2e" }}>
                            {inv.invoiceNumber ? `#${inv.invoiceNumber}` : "Invoice"} · {inv.from?.match(/<(.+)>/)?.[1] || inv.from || "Unknown sender"}
                          </div>
                          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                            {inv.amount ? `$${Number(inv.amount).toLocaleString()}` : ""}{inv.subject ? ` · "${inv.subject}"` : ""}
                          </div>
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 600, color: "#16a34a", background: "#dcfce7", padding: "3px 10px", borderRadius: 20 }}>PROCESSED</span>
                      </div>
                    ))}

                    {/* Skipped/duplicate invoices */}
                    {skipped.map((inv, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: "#fffbeb", borderRadius: 10, border: "1px solid #fde68a" }}>
                        <span style={{ fontSize: 18 }}>⚠️</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#92400e" }}>
                            #{inv.invoiceNumber} — Duplicate
                          </div>
                          <div style={{ fontSize: 12, color: "#78350f", marginTop: 2 }}>
                            Already processed on {inv.originalDate || "a previous date"}
                          </div>
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 600, color: "#d97706", background: "#fef9c3", padding: "3px 10px", borderRadius: 20 }}>SKIPPED</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {/* How it works */}
          <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 14, padding: "24px" }}>
            <div style={{ fontFamily: "Syne,sans-serif", fontWeight: 700, fontSize: 15, color: "#1a1a2e", marginBottom: 16 }}>How it works</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {[
                { icon: "📨", text: "Supplier emails invoice PDF (or ZIP of invoices) to your connected inbox" },
                { icon: "🤖", text: "APFlow detects the email every 5 minutes and downloads the attachment" },
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
            <div style={{ background: "white", border: "1.5px solid #e5e7eb", borderRadius: 16, padding: "28px 24px" }}>
              <div style={{ fontSize: 36, marginBottom: 16 }}>📧</div>
              <div style={{ fontFamily: "Syne,sans-serif", fontWeight: 700, fontSize: 18, color: "#1a1a2e", marginBottom: 8 }}>Connect Email Inbox</div>
              <p style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.7, marginBottom: 16 }}>
                Connect your dedicated invoice inbox. APFlow monitors it every 5 minutes for PDF and ZIP invoice attachments.
              </p>

              {/* Connection method selector */}
              <div style={{ display:"flex", gap:10, marginBottom:20 }}>
                <button
                  onClick={() => setConnectionMethod("gmail")}
                  style={{ flex:1, padding:"12px", borderRadius:10, border: connectionMethod==="gmail" ? "2px solid #e8531a" : "1px solid #e2ddd4", background: connectionMethod==="gmail" ? "#fff4f0" : "white", cursor:"pointer", fontFamily:"DM Sans,sans-serif" }}
                >
                  <div style={{ fontSize:20, marginBottom:4 }}>📧</div>
                  <div style={{ fontWeight:600, fontSize:13, color: connectionMethod==="gmail" ? "#e8531a" : "#0a0f1e" }}>Gmail OAuth</div>
                  <div style={{ fontSize:11, color:"#6b7280", marginTop:2 }}>Google Workspace · Personal Gmail</div>
                </button>
                <button
                  onClick={() => setConnectionMethod("imap")}
                  style={{ flex:1, padding:"12px", borderRadius:10, border: connectionMethod==="imap" ? "2px solid #e8531a" : "1px solid #e2ddd4", background: connectionMethod==="imap" ? "#fff4f0" : "white", cursor:"pointer", fontFamily:"DM Sans,sans-serif" }}
                >
                  <div style={{ fontSize:20, marginBottom:4 }}>🔧</div>
                  <div style={{ fontWeight:600, fontSize:13, color: connectionMethod==="imap" ? "#e8531a" : "#0a0f1e" }}>IMAP / Outlook</div>
                  <div style={{ fontSize:11, color:"#6b7280", marginTop:2 }}>Microsoft 365 · Corporate email</div>
                </button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
                {["Monitors inbox every 5 minutes", "Detects PDF and ZIP attachments", "Auto-extracts with Claude AI", "Pushes to ERP automatically"].map((f, i) => (
                  <div key={i} style={{ fontSize: 12, color: "#16a34a", display: "flex", gap: 6 }}><span>✓</span>{f}</div>
                ))}
              </div>
              {connectionMethod === "gmail" ? (
                <button onClick={connectGmail} style={{ width:"100%", background:"#e8531a", color:"white", border:"none", padding:"13px", borderRadius:10, fontSize:14, fontWeight:600, cursor:"pointer", fontFamily:"DM Sans,sans-serif" }}>
                  Connect Gmail →
                </button>
              ) : (
                <form onSubmit={connectImap}>
                  <div style={{ display:"flex", flexDirection:"column", gap:12, marginBottom:14 }}>
                    <div>
                      <label style={{ fontSize:11, fontWeight:600, color:"#6b7280", textTransform:"uppercase", letterSpacing:1, display:"block", marginBottom:4 }}>IMAP Server *</label>
                      <input style={{ width:"100%", border:"1px solid #e2ddd4", borderRadius:7, padding:"9px 12px", fontSize:13, fontFamily:"DM Sans,sans-serif", background:"#f9fafb" }}
                        placeholder="outlook.office365.com" value={imapForm.host}
                        onChange={e => setImapForm(f => ({ ...f, host: e.target.value }))} required />
                      <div style={{ fontSize:11, color:"#9ca3af", marginTop:3 }}>
                        Outlook: outlook.office365.com · Yahoo: imap.mail.yahoo.com · Custom: your mail server
                      </div>
                    </div>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 2fr", gap:10 }}>
                      <div>
                        <label style={{ fontSize:11, fontWeight:600, color:"#6b7280", textTransform:"uppercase", letterSpacing:1, display:"block", marginBottom:4 }}>Port</label>
                        <input style={{ width:"100%", border:"1px solid #e2ddd4", borderRadius:7, padding:"9px 12px", fontSize:13, fontFamily:"DM Sans,sans-serif", background:"#f9fafb" }}
                          placeholder="993" value={imapForm.port}
                          onChange={e => setImapForm(f => ({ ...f, port: e.target.value }))} />
                      </div>
                      <div>
                        <label style={{ fontSize:11, fontWeight:600, color:"#6b7280", textTransform:"uppercase", letterSpacing:1, display:"block", marginBottom:4 }}>Email Address *</label>
                        <input style={{ width:"100%", border:"1px solid #e2ddd4", borderRadius:7, padding:"9px 12px", fontSize:13, fontFamily:"DM Sans,sans-serif", background:"#f9fafb" }}
                          placeholder="ap-invoices@yourcompany.com" value={imapForm.email}
                          onChange={e => setImapForm(f => ({ ...f, email: e.target.value }))} required />
                      </div>
                    </div>
                    <div>
                      <label style={{ fontSize:11, fontWeight:600, color:"#6b7280", textTransform:"uppercase", letterSpacing:1, display:"block", marginBottom:4 }}>App Password *</label>
                      <input type="password" style={{ width:"100%", border:"1px solid #e2ddd4", borderRadius:7, padding:"9px 12px", fontSize:13, fontFamily:"DM Sans,sans-serif", background:"#f9fafb" }}
                        placeholder="••••••••••••" value={imapForm.password}
                        onChange={e => setImapForm(f => ({ ...f, password: e.target.value }))} required />
                      <div style={{ fontSize:11, color:"#9ca3af", marginTop:3 }}>
                        For Microsoft 365: use an App Password, not your regular password. Ask IT to enable IMAP and create an app password for this mailbox.
                      </div>
                    </div>
                  </div>
                  <div style={{ background:"#eff6ff", border:"1px solid #bfdbfe", borderRadius:8, padding:"10px 14px", marginBottom:14 }}>
                    <div style={{ fontSize:12, color:"#1e40af", fontWeight:600, marginBottom:4 }}>🏢 Dedicated Invoice Mailbox (recommended)</div>
                    <div style={{ fontSize:11, color:"#1e40af", lineHeight:1.6 }}>
                      Ask IT to create <strong>ap-invoices@yourcompany.com</strong> and enable IMAP access for it. Tell all suppliers to send invoices to this address. APFlow will only read this mailbox — no access to any other company email.
                    </div>
                  </div>
                  <div style={{ display:"flex", gap:10 }}>
                    <button type="button" onClick={testImap} disabled={imapTesting || !imapForm.host || !imapForm.email || !imapForm.password}
                      style={{ background:"white", border:"1px solid #e2ddd4", color:"#374151", padding:"11px 18px", borderRadius:8, fontSize:13, cursor:"pointer", fontFamily:"DM Sans,sans-serif" }}>
                      {imapTesting ? "Testing..." : "Test Connection"}
                    </button>
                    <button type="submit" disabled={imapLoading}
                      style={{ flex:1, background:"#e8531a", color:"white", border:"none", padding:"11px", borderRadius:8, fontSize:14, fontWeight:600, cursor:"pointer", fontFamily:"DM Sans,sans-serif" }}>
                      {imapLoading ? "Connecting..." : "Connect IMAP Inbox →"}
                    </button>
                  </div>
                </form>
              )}
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
            <div style={{ fontWeight: 700, color: "#92400e", marginBottom: 12, fontSize: 14 }}>⚠️ Before connecting your inbox</div>
            <ol style={{ paddingLeft: 20, fontSize: 13, color: "#78350f", lineHeight: 2 }}>
              <li>Make sure you're connecting the inbox that receives supplier invoices (Gmail or Outlook)</li>
              <li>APFlow will only read emails with PDF or ZIP invoice attachments — it never reads other emails</li>
              <li>You can disconnect at any time from this page</li>
              <li>We recommend creating a dedicated <strong>ap@yourcompany.com</strong> address for invoices</li>
            </ol>
          </div>
        </>
      )}
    </div>
  );
}
