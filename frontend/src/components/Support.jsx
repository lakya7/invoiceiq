import { useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

const FAQS = [
  {
    q: "Why isn't the email agent detecting my invoices?",
    a: "The email agent checks for keywords in the subject line and ZIP/PDF attachments. Make sure the email was sent to your connected Gmail address. If the subject has no invoice keywords, the agent still detects ZIP files automatically. Try clicking Check Now after sending a test email.",
  },
  {
    q: "How do I add a PO number when the invoice doesn't have one?",
    a: "Ask your supplier to mention the PO number in the email body when sending the invoice — for example \"Please process against PO-2024-001\". APFlow reads the email body and extracts the PO number automatically, even if it's not printed on the invoice PDF.",
  },
  {
    q: "Can I process multiple invoices at once?",
    a: "Yes — use Batch Upload to upload a ZIP file containing multiple PDF invoices. APFlow processes each one automatically. Alternatively, your suppliers can email a ZIP file to your connected Gmail and the Email Agent handles it automatically.",
  },
  {
    q: "Why does my invoice show \"Unmatched\" for PO?",
    a: "APFlow couldn't find a matching PO in your Purchase Orders list. Make sure you've added the PO in APFlow under Purchase Orders, and that the PO number matches exactly. You can also ask your supplier to mention the PO number in the email body.",
  },
  {
    q: "How do I connect Oracle Fusion?",
    a: "Go to ERP Connections → Oracle Fusion → enter your Oracle base URL, username, and password. Make sure REST API access is enabled in your Oracle instance. Contact us if you need help with Oracle REST API setup — we have Oracle Fusion expertise on the team.",
  },
  {
    q: "How do I invite my team members?",
    a: "Go to Team Management (Admin only) → Invite Member → enter their work email and role. They'll receive an invite email. If they don't see it, check their spam folder. Members can view and process invoices; only Admins can manage billing and team settings.",
  },
  {
    q: "My PDF won't upload — what format does APFlow accept?",
    a: "APFlow accepts standard PDF files up to 10MB. If your PDF is password-protected, remove the password first. For scanned invoices, make sure the scan resolution is at least 150 DPI. Image files (JPG, PNG) are also supported.",
  },
  {
    q: "How do I cancel or change my subscription?",
    a: "Go to Billing → Manage Subscription. This opens the Stripe billing portal where you can upgrade, downgrade, or cancel your plan. Changes take effect at the end of your current billing period.",
  },
];

const QUICK_FIXES = [
  { icon: "📧", color: "#fff4f0", label: "Email agent not detecting invoices", fix: "Click Check Now. Verify the email was sent to your connected Gmail address." },
  { icon: "📄", color: "#E6F1FB", label: "PDF won't upload", fix: "Convert to standard PDF (not password-protected). Max 10MB." },
  { icon: "🔗", color: "#EAF3DE", label: "ERP connection failing", fix: "Check credentials in ERP Connections. Oracle requires REST API access enabled." },
  { icon: "👥", color: "#EEEDFE", label: "Team member can't log in", fix: "Resend the invite from Team Management. Check their spam folder." },
];

export default function Support({ user, team, onBack }) {
  const [openFaq, setOpenFaq] = useState(null);
  const [form, setForm] = useState({ name: user?.user_metadata?.full_name || "", email: user?.email || "", issueType: "Email Invoice Agent", message: "" });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.message.trim()) return;
    setSending(true);
    setError("");

    try {
      // Send via backend email
      const res = await fetch(`${API}/api/support`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          issueType: form.issueType,
          message: form.message,
          teamId: team?.id,
          teamName: team?.name,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setSent(true);
    } catch (err) {
      // Fallback: open mailto
      const subject = encodeURIComponent(`[${form.issueType}] Support Request — APFlow`);
      const body = encodeURIComponent(`Hi APFlow Support,\n\nIssue: ${form.issueType}\n\n${form.message}\n\nAccount: ${form.email}\nTeam: ${team?.name || "No team"}`);
      window.open(`mailto:help@apflow.app?subject=${subject}&body=${body}`);
      setSent(true);
    }
    setSending(false);
  };

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "32px 24px", fontFamily: "DM Sans, sans-serif" }}>
      <button onClick={onBack} style={{ background: "none", border: "none", color: "#9ca3af", fontSize: 13, cursor: "pointer", marginBottom: 20, fontFamily: "DM Sans, sans-serif" }}>← Back</button>

      {/* Header */}
      <div style={{ background: "linear-gradient(135deg,#0a0f1e,#1a2040)", borderRadius: 16, padding: "32px", marginBottom: 24, color: "white" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 8 }}>
          <div style={{ width: 48, height: 48, background: "rgba(232,83,26,0.2)", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>🆘</div>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontFamily: "Syne, sans-serif", fontSize: 24, fontWeight: 800, margin: 0 }}>Help & Support</h1>
            <p style={{ color: "rgba(255,255,255,0.45)", fontSize: 14, margin: "4px 0 0" }}>We respond within 2 hours on business days</p>
          </div>
          <div style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", color: "#22c55e", padding: "5px 14px", borderRadius: 20, fontSize: 11, fontFamily: "DM Mono, monospace", flexShrink: 0 }}>● Avg. 2hr response</div>
        </div>
      </div>

      {/* Quick fixes */}
      <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 15, color: "#1a1a2e", marginBottom: 14 }}>Common fixes</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 28 }}>
        {QUICK_FIXES.map((q, i) => (
          <div key={i} style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 12, padding: "16px", display: "flex", alignItems: "flex-start", gap: 12 }}>
            <div style={{ width: 36, height: 36, background: q.color, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>{q.icon}</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#1a1a2e", marginBottom: 4 }}>{q.label}</div>
              <div style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.5 }}>{q.fix}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Contact form */}
      <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 15, color: "#1a1a2e", marginBottom: 14 }}>Send us a message</div>
      <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 14, padding: "24px", marginBottom: 24 }}>
        {sent ? (
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
            <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 18, marginBottom: 8 }}>Message sent!</div>
            <div style={{ fontSize: 14, color: "#6b7280" }}>We'll reply to <strong>{form.email}</strong> within 2 hours.</div>
            <button onClick={() => setSent(false)} style={{ marginTop: 16, background: "none", border: "1px solid #e5e7eb", color: "#6b7280", padding: "8px 20px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontFamily: "DM Sans, sans-serif" }}>Send another message</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: 6 }}>Your name</label>
                <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Jane Smith" style={{ width: "100%", border: "1px solid #e5e7eb", borderRadius: 8, padding: "10px 12px", fontSize: 14, fontFamily: "DM Sans, sans-serif", outline: "none", boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: 6 }}>Email</label>
                <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="jane@company.com" required style={{ width: "100%", border: "1px solid #e5e7eb", borderRadius: 8, padding: "10px 12px", fontSize: 14, fontFamily: "DM Sans, sans-serif", outline: "none", boxSizing: "border-box" }} />
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: 6 }}>Issue type</label>
              <select value={form.issueType} onChange={e => setForm({ ...form, issueType: e.target.value })} style={{ width: "100%", border: "1px solid #e5e7eb", borderRadius: 8, padding: "10px 12px", fontSize: 14, fontFamily: "DM Sans, sans-serif", outline: "none", background: "white", boxSizing: "border-box" }}>
                <option>Email Invoice Agent</option>
                <option>Invoice Upload / PDF</option>
                <option>ERP Connection</option>
                <option>PO Matching</option>
                <option>Team / Access</option>
                <option>Billing</option>
                <option>Other</option>
              </select>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: 6 }}>Describe your issue</label>
              <textarea value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} placeholder="What happened? What were you trying to do? Any error messages?" required rows={4} style={{ width: "100%", border: "1px solid #e5e7eb", borderRadius: 8, padding: "10px 12px", fontSize: 14, fontFamily: "DM Sans, sans-serif", outline: "none", resize: "vertical", boxSizing: "border-box" }} />
            </div>
            {error && <div style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>⚠️ {error}</div>}
            <button type="submit" disabled={sending} style={{ width: "100%", background: "#e8531a", color: "white", border: "none", padding: "13px", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: sending ? "not-allowed" : "pointer", fontFamily: "DM Sans, sans-serif", opacity: sending ? 0.7 : 1 }}>
              {sending ? "Sending..." : "Send Message →"}
            </button>
          </form>
        )}
      </div>

      {/* FAQ */}
      <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 15, color: "#1a1a2e", marginBottom: 14 }}>Frequently asked questions</div>
      <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 14, overflow: "hidden", marginBottom: 24 }}>
        {FAQS.map((faq, i) => (
          <div key={i} style={{ borderBottom: i < FAQS.length - 1 ? "1px solid #f3f4f6" : "none" }}>
            <button onClick={() => setOpenFaq(openFaq === i ? null : i)} style={{ width: "100%", background: "none", border: "none", padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, cursor: "pointer", textAlign: "left", fontFamily: "DM Sans, sans-serif" }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: "#1a1a2e" }}>{faq.q}</span>
              <span style={{ fontSize: 12, color: "#9ca3af", flexShrink: 0, transform: openFaq === i ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>▼</span>
            </button>
            {openFaq === i && (
              <div style={{ padding: "0 20px 16px", fontSize: 13, color: "#6b7280", lineHeight: 1.7 }}>{faq.a}</div>
            )}
          </div>
        ))}
      </div>

      {/* Contact info */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={{ background: "#f9fafb", borderRadius: 12, padding: "16px", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 20 }}>✉️</span>
          <div>
            <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 2 }}>Email support</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#1a1a2e" }}>help@apflow.app</div>
          </div>
        </div>
        <div style={{ background: "#f9fafb", borderRadius: 12, padding: "16px", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 20 }}>⚡</span>
          <div>
            <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 2 }}>Response time</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#1a1a2e" }}>Within 2 hours (business days)</div>
          </div>
        </div>
      </div>
    </div>
  );
}
