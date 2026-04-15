import { useState, useEffect } from "react";
import { supabase } from "../supabase";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

const SECTIONS = ["Notifications", "ERP & Integration", "Company", "Account", "Billing"];

function Toggle({ checked, onChange, label, sub }) {
  return (
    <div className="toggle-row">
      <div className="toggle-text">
        <div className="toggle-label">{label}</div>
        {sub && <div className="toggle-sub">{sub}</div>}
      </div>
      <button
        className={`toggle-btn ${checked ? "on" : ""}`}
        onClick={() => onChange(!checked)}
        type="button"
      >
        <span className="toggle-knob" />
      </button>
    </div>
  );
}

function SettingRow({ label, sub, children }) {
  return (
    <div className="setting-row">
      <div className="setting-row-left">
        <div className="setting-row-label">{label}</div>
        {sub && <div className="setting-row-sub">{sub}</div>}
      </div>
      <div className="setting-row-right">{children}</div>
    </div>
  );
}

export default function Settings({ user, onBack }) {
  const [activeSection, setActiveSection] = useState("Notifications");
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testSending, setTestSending] = useState(false);
  const [toast, setToast] = useState(null);
  const [profile, setProfile] = useState({ full_name: user.user_metadata?.full_name || "", email: user.email });

  const firstName = profile.full_name?.split(" ")[0] || profile.email?.split("@")[0];

  useEffect(() => { loadSettings(); }, []);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/settings/${user.id}`);
      const data = await res.json();
      if (data.success) setSettings(data.settings);
    } catch (e) { showToast("Failed to load settings", "error"); }
    setLoading(false);
  };

  const set = (key, val) => setSettings(s => ({ ...s, [key]: val }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API}/api/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, settings }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      showToast("Settings saved!", "success");
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  };

  const sendTestEmail = async () => {
    const email = settings?.notify_email || user.email;
    setTestSending(true);
    try {
      const res = await fetch(`${API}/api/settings/test-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, userId: user.id }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      showToast(`Test email sent to ${email}!`, "success");
    } catch (e) { showToast("Failed to send: " + e.message, "error"); }
    setTestSending(false);
  };

  const updatePassword = async () => {
    const { error } = await supabase.auth.resetPasswordForEmail(user.email);
    if (error) showToast(error.message, "error");
    else showToast("Password reset email sent!", "success");
  };

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  return (
    <div className="settings-page">
      {/* Sidebar */}
      <aside className="settings-sidebar">
        <button className="settings-back" onClick={onBack}>← Dashboard</button>
        <div className="settings-sidebar-title">Settings</div>
        <nav className="settings-nav">
          {SECTIONS.map(s => (
            <button
              key={s}
              className={`settings-nav-item ${activeSection === s ? "active" : ""}`}
              onClick={() => setActiveSection(s)}
            >
              {s === "Notifications" && "🔔 "}
              {s === "ERP & Integration" && "🔗 "}
              {s === "Company" && "🏢 "}
              {s === "Account" && "👤 "}
              {s === "Billing" && "💳 "}
              {s}
            </button>
          ))}
        </nav>
      </aside>

      {/* Main */}
      <div className="settings-main">
        <div className="settings-header">
          <h1 className="settings-title">{activeSection}</h1>
        </div>

        {loading ? (
          <div className="settings-loading">Loading settings...</div>
        ) : (

          <div className="settings-content">

            {/* ── NOTIFICATIONS ───────────────────────── */}
            {activeSection === "Notifications" && (
              <>
                <div className="settings-card">
                  <div className="settings-card-title">Email Notifications</div>
                  <div className="settings-card-sub">Choose when APFlow sends you emails</div>

                  <div className="settings-card-body">
                    <Toggle
                      checked={settings?.notify_on_approval}
                      onChange={v => set("notify_on_approval", v)}
                      label="Invoice approved & pushed to ERP"
                      sub="Get notified when an invoice is approved and successfully synced"
                    />
                    <Toggle
                      checked={settings?.notify_on_rejection}
                      onChange={v => set("notify_on_rejection", v)}
                      label="Invoice rejected"
                      sub="Get notified when an invoice fails validation or is manually rejected"
                    />
                    <Toggle
                      checked={settings?.notify_on_duplicate}
                      onChange={v => set("notify_on_duplicate", v)}
                      label="Duplicate invoice detected"
                      sub="Alert when AI detects a potentially duplicate invoice"
                    />
                  </div>
                </div>

                <div className="settings-card">
                  <div className="settings-card-title">Notification Email</div>
                  <div className="settings-card-sub">Where to send notifications (defaults to your account email)</div>
                  <div className="settings-card-body">
                    <SettingRow label="Send notifications to" sub="You can add a team inbox or CC address">
                      <input
                        className="settings-input"
                        type="email"
                        placeholder={user.email}
                        value={settings?.notify_email || ""}
                        onChange={e => set("notify_email", e.target.value)}
                      />
                    </SettingRow>
                    <div style={{ marginTop: 16 }}>
                      <button className="btn-secondary-action" onClick={sendTestEmail} disabled={testSending}>
                        {testSending ? "Sending..." : "📧 Send Test Email"}
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* ── ERP & INTEGRATION ───────────────────── */}
            {activeSection === "ERP & Integration" && (
              <>
                <div className="settings-card">
                  <div className="settings-card-title">ERP System</div>
                  <div className="settings-card-sub">Select your primary ERP for invoice sync</div>
                  <div className="settings-card-body">
                    <div className="erp-grid">
                      {[
                        { id: "oracle", name: "Oracle Fusion", icon: "🔴", status: "connected" },
                        { id: "sap", name: "SAP S/4HANA", icon: "🔵", status: "coming_soon" },
                        { id: "quickbooks", name: "QuickBooks", icon: "🟢", status: "coming_soon" },
                        { id: "netsuite", name: "NetSuite", icon: "🟠", status: "coming_soon" },
                        { id: "xero", name: "Xero", icon: "🔷", status: "coming_soon" },
                        { id: "mock", name: "Mock (Demo)", icon: "⚫", status: "connected" },
                      ].map(erp => (
                        <div
                          key={erp.id}
                          className={`erp-card ${settings?.erp_system === erp.id ? "selected" : ""} ${erp.status === "coming_soon" ? "disabled" : ""}`}
                          onClick={() => erp.status !== "coming_soon" && set("erp_system", erp.id)}
                        >
                          <div className="erp-icon">{erp.icon}</div>
                          <div className="erp-name">{erp.name}</div>
                          <div className={`erp-status ${erp.status}`}>
                            {erp.status === "connected" ? "Available" : "Coming soon"}
                          </div>
                          {settings?.erp_system === erp.id && <div className="erp-check">✓</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="settings-card">
                  <div className="settings-card-title">Processing Rules</div>
                  <div className="settings-card-sub">Automate your approval workflow</div>
                  <div className="settings-card-body">
                    <SettingRow label="Auto-approve invoices below" sub="Invoices under this amount skip manual review (set 0 to disable)">
                      <div className="input-prefix-wrap">
                        <span className="input-prefix">$</span>
                        <input
                          className="settings-input prefix"
                          type="number"
                          min="0"
                          value={settings?.auto_approve_below || 0}
                          onChange={e => set("auto_approve_below", Number(e.target.value))}
                        />
                      </div>
                    </SettingRow>
                    <Toggle
                      checked={settings?.require_po_match}
                      onChange={v => set("require_po_match", v)}
                      label="Require PO match before approval"
                      sub="Flag invoices that don't match an open purchase order"
                    />
                  </div>
                </div>
              </>
            )}

            {/* ── COMPANY ─────────────────────────────── */}
            {activeSection === "Company" && (
              <div className="settings-card">
                <div className="settings-card-title">Company Details</div>
                <div className="settings-card-sub">Used in email notifications and exports</div>
                <div className="settings-card-body">
                  <SettingRow label="Company Name">
                    <input
                      className="settings-input"
                      type="text"
                      placeholder="Acme Corp"
                      value={settings?.company_name || ""}
                      onChange={e => set("company_name", e.target.value)}
                    />
                  </SettingRow>
                  <SettingRow label="Default Currency">
                    <select
                      className="settings-input"
                      value={settings?.default_currency || "USD"}
                      onChange={e => set("default_currency", e.target.value)}
                    >
                      {["USD","EUR","GBP","CAD","AUD","INR","SGD","JPY"].map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </SettingRow>
                  <SettingRow label="Fiscal Year Start">
                    <select className="settings-input" value={settings?.fiscal_year_start || "January"} onChange={e => set("fiscal_year_start", e.target.value)}>
                      {["January","February","March","April","July","October"].map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </SettingRow>
                </div>
              </div>
            )}

            {/* ── ACCOUNT ─────────────────────────────── */}
            {activeSection === "Account" && (
              <>
                <div className="settings-card">
                  <div className="settings-card-title">Profile</div>
                  <div className="settings-card-body">
                    <div className="profile-avatar-row">
                      <div className="profile-avatar">{firstName?.[0]?.toUpperCase()}</div>
                      <div>
                        <div className="profile-name">{profile.full_name || "—"}</div>
                        <div className="profile-email">{profile.email}</div>
                      </div>
                    </div>
                    <SettingRow label="Full Name">
                      <input
                        className="settings-input"
                        type="text"
                        value={profile.full_name}
                        onChange={e => setProfile(p => ({ ...p, full_name: e.target.value }))}
                      />
                    </SettingRow>
                    <SettingRow label="Email Address">
                      <input className="settings-input" type="email" value={profile.email} disabled />
                    </SettingRow>
                  </div>
                </div>

                <div className="settings-card">
                  <div className="settings-card-title">Security</div>
                  <div className="settings-card-body">
                    <SettingRow label="Password" sub="Send a password reset link to your email">
                      <button className="btn-secondary-action" onClick={updatePassword}>
                        Reset Password
                      </button>
                    </SettingRow>
                  </div>
                </div>

                <div className="settings-card danger-card">
                  <div className="settings-card-title" style={{ color: "#dc2626" }}>Danger Zone</div>
                  <div className="settings-card-body">
                    <SettingRow label="Delete Account" sub="Permanently delete your account and all invoice data">
                      <button className="btn-danger">Delete Account</button>
                    </SettingRow>
                  </div>
                </div>
              </>
            )}

            {/* ── BILLING ─────────────────────────────── */}
            {activeSection === "Billing" && (
              <>
                <div className="settings-card">
                  <div className="settings-card-title">Current Plan</div>
                  <div className="settings-card-body">
                    <div className="plan-display">
                      <div className="plan-badge">Starter</div>
                      <div className="plan-price">$299<span>/month</span></div>
                      <div className="plan-desc">500 documents/month · 1 ERP integration</div>
                    </div>
                    <div className="usage-bar-wrap">
                      <div className="usage-bar-header">
                        <span>Documents this month</span>
                        <span>47 / 500</span>
                      </div>
                      <div className="usage-bar"><div className="usage-bar-fill" style={{ width: "9.4%" }} /></div>
                    </div>
                  </div>
                </div>

                <div className="settings-card">
                  <div className="settings-card-title">Upgrade Plan</div>
                  <div className="settings-card-sub">Scale as your invoice volume grows</div>
                  <div className="settings-card-body">
                    <div className="billing-plans">
                      {[
                        { name: "Growth", price: "$99", docs: "2,000 docs/mo", erp: "3 ERP integrations", current: false },
                        { name: "Enterprise", price: "$199", docs: "Unlimited", erp: "Unlimited ERPs + dedicated support", current: false },
                      ].map(plan => (
                        <div key={plan.name} className="billing-plan-card">
                          <div className="billing-plan-name">{plan.name}</div>
                          <div className="billing-plan-price">{plan.price}<span>/mo</span></div>
                          <ul className="billing-plan-features">
                            <li>{plan.docs}</li>
                            <li>{plan.erp}</li>
                          </ul>
                          <button className="btn-secondary-action">Upgrade →</button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Save button */}
            {activeSection !== "Billing" && (
              <div className="settings-save-row">
                <button className="btn-approve" onClick={save} disabled={saving}>
                  {saving ? "Saving..." : "Save Changes"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className={`settings-toast ${toast.type}`}>
          {toast.type === "success" ? "✓" : "⚠"} {toast.msg}
        </div>
      )}
    </div>
  );
}
