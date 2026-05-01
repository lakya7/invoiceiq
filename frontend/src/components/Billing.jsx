import { useState, useEffect } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

const PLANS = [
  {
    id: "starter",
    name: "Starter",
    price: "$499",
    period: "/month",
    desc: "For SMBs on QuickBooks, Xero, or Zoho",
    docs: 200,
    features: [
      "200 invoices/month",
      "1 ERP integration",
      "Core AI extraction",
      "Duplicate detection",
      "Email + portal capture",
      "Audit trail",
      "Email support",
    ],
    cta: "Subscribe to Starter",
    color: "#6b7280",
    highlight: false,
  },
  {
    id: "growth",
    name: "Growth",
    price: "$1,500",
    period: "/month",
    desc: "For mid-market on Oracle Fusion or NetSuite",
    docs: 1000,
    features: [
      "1,000 invoices/month",
      "Up to 3 ERP integrations",
      "PO matching (2-way)",
      "All AI Agents",
      "Team management & approval workflows",
      "Analytics dashboard",
      "Priority email support",
    ],
    cta: "Subscribe to Growth",
    color: "#e8531a",
    highlight: true,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: "Custom",
    period: "",
    desc: "For large finance teams & multi-entity",
    docs: Infinity,
    features: [
      "Unlimited invoices",
      "Unlimited ERPs",
      "Dedicated CSM",
      "SLA guarantee",
      "SOC 2 documentation & DPA",
      "SSO / SAML",
      "On-premise / VPC deployment",
      "Custom integrations",
    ],
    cta: "Contact Sales",
    color: "#7c3aed",
    highlight: false,
  },
];

function UsageBar({ used, limit, plan }) {
  const pct = limit === "Unlimited" ? 0 : Math.min(100, Math.round((used / limit) * 100));
  const color = pct >= 90 ? "#dc2626" : pct >= 70 ? "#f59e0b" : "#16a34a";
  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, marginBottom:8 }}>
        <span style={{ color:"var(--muted)" }}>Documents used this period</span>
        <span style={{ fontWeight:600 }}>{used} / {limit === "Unlimited" ? "∞" : limit}</span>
      </div>
      <div style={{ height:8, background:"var(--border)", borderRadius:4, overflow:"hidden" }}>
        <div style={{ height:"100%", width:`${pct}%`, background:color, borderRadius:4, transition:"width 0.6s ease" }} />
      </div>
      {pct >= 80 && limit !== "Unlimited" && (
        <div style={{ marginTop:8, fontSize:12, color:pct>=90?"#dc2626":"#f59e0b", fontWeight:500 }}>
          {pct >= 90 ? "⚠️ Almost at limit — upgrade to avoid interruptions" : `ℹ️ ${100-pct}% remaining this billing period`}
        </div>
      )}
    </div>
  );
}

export default function Billing({ user, team, onBack }) {
  const [sub, setSub] = useState(null);
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (team) fetchBilling();
  }, [team]);

  // Handle redirect back from Stripe
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("upgraded") === "true") {
      showToast("🎉 Subscription activated! Welcome to your new plan.", "success");
      window.history.replaceState({}, "", window.location.pathname);
      setTimeout(() => fetchBilling(), 2000);
    }
    if (params.get("canceled") === "true") {
      showToast("Checkout canceled — no charges made.", "info");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const fetchBilling = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/billing/${team.id}`);
      const data = await res.json();
      if (data.success) { setSub(data.subscription); setUsage(data.usage); }
    } catch (e) { showToast("Failed to load billing info", "error"); }
    setLoading(false);
  };

  const checkout = async (planId) => {
    if (planId === "enterprise") {
      window.open("mailto:hello@billtiq.com?subject=Enterprise Plan Inquiry", "_blank");
      return;
    }
    setCheckoutLoading(planId);
    try {
      const res = await fetch(`${API}/api/billing/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: team.id, plan: planId, email: user.email, teamName: team.name }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      window.location.href = data.url; // redirect to Stripe Checkout
    } catch (e) { showToast(e.message, "error"); }
    setCheckoutLoading(null);
  };

  const openPortal = async () => {
    setPortalLoading(true);
    try {
      const res = await fetch(`${API}/api/billing/portal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: team.id }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      window.location.href = data.url;
    } catch (e) { showToast(e.message, "error"); }
    setPortalLoading(false);
  };

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const currentPlan = sub?.plan || null;
  const currentPlanData = currentPlan ? PLANS.find(p => p.id === currentPlan) : null;
  const isOwner = team?.role === "admin";

  return (
    <div className="billing-page">
      <div className="team-header">
        <button className="settings-back" onClick={onBack}>← Dashboard</button>
        <div className="team-header-row">
          <div>
            <h1 className="team-title">Billing & Plans</h1>
            <p className="team-sub">{team?.name} · Manage your subscription</p>
          </div>
          {sub?.stripe_subscription_id && isOwner && (
            <button className="btn-secondary-action" onClick={openPortal} disabled={portalLoading}>
              {portalLoading ? "Loading..." : "⚙ Manage Subscription"}
            </button>
          )}
        </div>
      </div>

      <div className="billing-content">
        {loading ? (
          <div className="table-loading">Loading billing info...</div>
        ) : (
          <>
            {/* Current plan + usage */}
            <div className="billing-current-card">
              <div className="billing-current-left">
                <div className="billing-plan-tag">Current Plan</div>
                {currentPlanData ? (
                  <>
                    <div className="billing-current-name">{currentPlanData.name}</div>
                    <div className="billing-current-price">
                      {currentPlanData.price}
                      <span>{currentPlanData.period}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="billing-current-name">No active plan</div>
                    <div className="billing-current-price" style={{ fontSize: 16, color: "var(--muted)", fontWeight: 500 }}>
                      Choose a plan below to activate invoice processing
                    </div>
                  </>
                )}
                {sub?.cancel_at_period_end && (
                  <div className="cancel-badge">
                    ⚠️ Cancels {new Date(sub.current_period_end).toLocaleDateString("en-US", { month:"short", day:"numeric" })}
                  </div>
                )}
                {sub?.status === "past_due" && (
                  <div className="pastdue-badge">🔴 Payment past due — update payment method</div>
                )}
              </div>
              <div className="billing-current-right">
                {usage && currentPlanData && <UsageBar used={usage.used} limit={usage.limit} plan={currentPlan} />}
                {sub?.current_period_end && currentPlanData && (
                  <div style={{ marginTop:12, fontSize:12, color:"var(--muted)" }}>
                    Next renewal: {new Date(sub.current_period_end).toLocaleDateString("en-US", { month:"long", day:"numeric", year:"numeric" })}
                  </div>
                )}
              </div>
            </div>

            {/* Plan cards */}
            {isOwner && (
              <>
                <div className="billing-section-title">
                  {!currentPlanData ? "Choose a Plan" : "Switch Plan"}
                </div>
                <div className="billing-plans-grid">
                  {PLANS.map(plan => {
                    const isCurrent = plan.id === currentPlan;
                    const isDowngrade = PLANS.findIndex(p=>p.id===plan.id) < PLANS.findIndex(p=>p.id===currentPlan);
                    return (
                      <div key={plan.id} className={`billing-plan-card-full ${plan.highlight ? "highlighted" : ""} ${isCurrent ? "current" : ""}`}>
                        {plan.highlight && <div className="popular-badge">Most Popular</div>}
                        {isCurrent && <div className="current-badge">✓ Current</div>}

                        <div className="bpc-name">{plan.name}</div>
                        <div className="bpc-price">
                          {plan.price}
                          {plan.period && <span>{plan.period}</span>}
                        </div>
                        <div className="bpc-desc">{plan.desc}</div>

                        <ul className="bpc-features">
                          {plan.features.map((f,i) => (
                            <li key={i}>
                              <span style={{ color: plan.highlight && !isCurrent ? "#f87c4f" : "#16a34a" }}>✓</span> {f}
                            </li>
                          ))}
                        </ul>

                        <button
                          className={`bpc-btn ${plan.highlight ? "primary" : "secondary"} ${isCurrent ? "disabled" : ""}`}
                          onClick={() => !isCurrent && checkout(plan.id)}
                          disabled={isCurrent || checkoutLoading === plan.id}
                          style={{ borderColor: plan.color, color: isCurrent ? "var(--muted)" : plan.highlight ? "#fff" : plan.color, background: plan.highlight && !isCurrent ? plan.color : "transparent" }}
                        >
                          {checkoutLoading === plan.id ? "Loading..." : isCurrent ? "Current Plan" : plan.cta}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {!isOwner && (
              <div className="settings-card">
                <div className="settings-card-body">
                  <div style={{ padding:"24px 0", textAlign:"center", color:"var(--muted)", fontSize:14 }}>
                    Only team admins can manage billing. Contact your team admin to upgrade.
                  </div>
                </div>
              </div>
            )}

            {/* Security note */}
            <div className="billing-security">
              <span>🔒</span>
              <span>Payments are processed securely by Stripe. Billtiq never stores your card details.</span>
            </div>
          </>
        )}
      </div>

      {toast && (
        <div className={`settings-toast ${toast.type}`}>
          {toast.type === "success" ? "✓" : toast.type === "info" ? "ℹ" : "⚠"} {toast.msg}
        </div>
      )}
    </div>
  );
}
