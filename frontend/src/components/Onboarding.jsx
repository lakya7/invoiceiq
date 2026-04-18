import { useState, useEffect } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

const STEPS = [
  {
    id: "team",
    icon: "👥",
    title: "Create your team workspace",
    desc: "Invite your AP team and set roles — Admins manage billing, Members process invoices.",
    cta: "Create Team",
    done_label: "Team created",
  },
  {
    id: "gmail",
    icon: "📧",
    title: "Connect your Gmail inbox",
    desc: "APFlow monitors your inbox every 5 minutes for invoice emails — PDFs and ZIPs detected automatically.",
    cta: "Connect Gmail",
    done_label: "Gmail connected",
  },
  {
    id: "erp",
    icon: "🔗",
    title: "Connect your ERP",
    desc: "Connect Oracle Fusion or QuickBooks. Validated invoices push automatically with zero manual entry.",
    cta: "Connect ERP",
    done_label: "ERP connected",
  },
  {
    id: "invoice",
    icon: "📄",
    title: "Process your first invoice",
    desc: "Upload a PDF invoice or send one to your connected Gmail. Watch APFlow extract and push it in seconds.",
    cta: "Process Invoice",
    done_label: "First invoice processed",
  },
];

export default function Onboarding({ user, team, teams, onCreateTeam, onEmailAgent, onERP, onNewInvoice, onDismiss }) {
  const [step, setStep] = useState(0); // 0 = welcome, 1 = checklist
  const [completed, setCompleted] = useState({});

  const firstName = user?.user_metadata?.full_name?.split(" ")[0] || user?.email?.split("@")[0];

  // Auto-detect completed steps
  useEffect(() => {
    const done = {};
    if (team) done.team = true;
    setCompleted(done);
  }, [team]);

  const completedCount = Object.keys(completed).length;
  const totalSteps = STEPS.length;
  const pct = Math.round((completedCount / totalSteps) * 100);

  const handleStep = (stepId) => {
    if (stepId === "team") onCreateTeam?.();
    if (stepId === "gmail") onEmailAgent?.();
    if (stepId === "erp") onERP?.();
    if (stepId === "invoice") onNewInvoice?.();
  };

  if (step === 0) {
    // Welcome screen
    return (
      <div style={{ minHeight: "100vh", background: "#f5f2eb", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "DM Sans, sans-serif" }}>
        <div style={{ maxWidth: 600, width: "100%", textAlign: "center" }}>
          {/* Logo */}
          <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 800, fontSize: 28, marginBottom: 32 }}>
            AP<span style={{ color: "#e8531a" }}>Flow</span>
          </div>

          {/* Welcome card */}
          <div style={{ background: "white", borderRadius: 24, padding: "48px 40px", border: "1px solid #e5e7eb", marginBottom: 16 }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>👋</div>
            <h1 style={{ fontFamily: "Syne, sans-serif", fontWeight: 800, fontSize: 28, color: "#0a0f1e", marginBottom: 12, letterSpacing: "-1px" }}>
              Welcome to APFlow, {firstName}!
            </h1>
            <p style={{ fontSize: 15, color: "#6b7280", lineHeight: 1.75, marginBottom: 32, fontWeight: 300 }}>
              You're about to eliminate manual invoice processing for your team. Let's get you set up in under 5 minutes.
            </p>

            {/* What you'll get */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 36, textAlign: "left" }}>
              {[
                { icon: "📧", text: "Auto-process invoices from your Gmail inbox" },
                { icon: "🤖", text: "Claude AI extracts every field in 4 seconds" },
                { icon: "🎯", text: "PO matching — even from email body text" },
                { icon: "🚀", text: "Push directly to Oracle or QuickBooks" },
                { icon: "🔔", text: "Slack & Teams alerts for your team" },
              ].map((item, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: "#f9fafb", borderRadius: 10 }}>
                  <span style={{ fontSize: 18 }}>{item.icon}</span>
                  <span style={{ fontSize: 14, color: "#374151" }}>{item.text}</span>
                </div>
              ))}
            </div>

            <button
              onClick={() => setStep(1)}
              style={{ width: "100%", background: "#e8531a", color: "white", border: "none", padding: "16px", borderRadius: 12, fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "DM Sans, sans-serif" }}
            >
              Let's Get Started →
            </button>
          </div>

          <button
            onClick={onDismiss}
            style={{ background: "none", border: "none", color: "#9ca3af", fontSize: 13, cursor: "pointer", fontFamily: "DM Sans, sans-serif" }}
          >
            Skip — go to dashboard
          </button>
        </div>
      </div>
    );
  }

  // Checklist screen
  return (
    <div style={{ minHeight: "100vh", background: "#f5f2eb", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "DM Sans, sans-serif" }}>
      <div style={{ maxWidth: 640, width: "100%" }}>
        {/* Logo */}
        <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 800, fontSize: 24, marginBottom: 32, textAlign: "center" }}>
          AP<span style={{ color: "#e8531a" }}>Flow</span>
        </div>

        {/* Progress header */}
        <div style={{ background: "white", borderRadius: 20, padding: "28px 32px", border: "1px solid #e5e7eb", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div>
              <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 800, fontSize: 18, color: "#0a0f1e" }}>Setup checklist</div>
              <div style={{ fontSize: 13, color: "#6b7280", marginTop: 2 }}>{completedCount} of {totalSteps} steps completed</div>
            </div>
            <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 800, fontSize: 24, color: pct === 100 ? "#16a34a" : "#e8531a" }}>{pct}%</div>
          </div>
          {/* Progress bar */}
          <div style={{ height: 6, background: "#f3f4f6", borderRadius: 100, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct}%`, background: pct === 100 ? "#16a34a" : "#e8531a", borderRadius: 100, transition: "width 0.5s ease" }} />
          </div>
        </div>

        {/* Steps */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
          {STEPS.map((s, i) => {
            const done = completed[s.id];
            return (
              <div
                key={s.id}
                style={{
                  background: done ? "#f0fdf4" : "white",
                  border: `1px solid ${done ? "#bbf7d0" : "#e5e7eb"}`,
                  borderRadius: 16,
                  padding: "20px 24px",
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  transition: "all 0.2s",
                }}
              >
                {/* Step number / check */}
                <div style={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  background: done ? "#16a34a" : "#f3f4f6",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: done ? 18 : 14,
                  fontWeight: 700,
                  color: done ? "white" : "#9ca3af",
                  flexShrink: 0,
                }}>
                  {done ? "✓" : i + 1}
                </div>

                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                    <span style={{ fontSize: 16 }}>{s.icon}</span>
                    <div style={{ fontWeight: 700, fontSize: 14, color: done ? "#15803d" : "#0a0f1e" }}>
                      {done ? s.done_label : s.title}
                    </div>
                  </div>
                  {!done && <div style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.5 }}>{s.desc}</div>}
                </div>

                {!done && (
                  <button
                    onClick={() => handleStep(s.id)}
                    style={{
                      background: "#e8531a",
                      color: "white",
                      border: "none",
                      padding: "8px 16px",
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                      fontFamily: "DM Sans, sans-serif",
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                    }}
                  >
                    {s.cta} →
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Done state */}
        {completedCount === totalSteps ? (
          <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 16, padding: "20px 24px", textAlign: "center" }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🎉</div>
            <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 800, fontSize: 18, color: "#15803d", marginBottom: 4 }}>You're all set!</div>
            <div style={{ fontSize: 13, color: "#16a34a", marginBottom: 16 }}>APFlow is fully configured and running 24/7 for your team.</div>
            <button onClick={onDismiss} style={{ background: "#16a34a", color: "white", border: "none", padding: "12px 28px", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "DM Sans, sans-serif" }}>
              Go to Dashboard →
            </button>
          </div>
        ) : (
          <button
            onClick={onDismiss}
            style={{ width: "100%", background: "none", border: "1px solid #e5e7eb", color: "#6b7280", padding: "12px", borderRadius: 12, fontSize: 13, cursor: "pointer", fontFamily: "DM Sans, sans-serif" }}
          >
            Skip for now — go to dashboard
          </button>
        )}
      </div>
    </div>
  );
}
