import { useState, useEffect } from "react";
import { supabase } from "../supabase";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

// ── v4 enterprise tokens ────────────────────────────────────────────
const T = {
  ink: "#1b2a44",        // graphite-navy accent
  bg: "#f5f6f8",
  card: "#ffffff",
  border: "#e6e8ec",
  line: "#eef0f3",
  text: "#1b2a44",
  muted: "#6b7280",
  faint: "#9aa1ac",
  pos: "#1b7f5c",
  warn: "#b45309",
  amber: "#c98a1b",
  danger: "#b42318",
  blue: "#2f5fb3",
  slate: "#5b6b86",
};

// Small-data thresholds — below these, tiles show an honest "not enough data" state
const MIN_VOLUME = 10;       // invoices in window before the daily trend is meaningful
const MIN_VOLUME_DAYS = 3;   // distinct active days
const MIN_STATUS = 5;        // invoices before the status donut beats a plain list
const MIN_HOURS_FOR_FTE = 20; // hours-saved before an FTE estimate isn't noise

const MIN_PER_INVOICE = 15;  // estimate assumption: minutes saved per invoice
const COST_PER_INVOICE = 25; // estimate assumption: $ saved per invoice
const HOURS_PER_FTE_MONTH = 160;

const fmtMoney = (n) => "$" + Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
const fmtNum = (n) => Number(n || 0).toLocaleString("en-US");

// ── tiny stroke icons (no emoji) ────────────────────────────────────
function Icon({ name, size = 16, color = "currentColor" }) {
  const p = {
    doc: <path d="M6 2h7l5 5v15a0 0 0 0 1 0 0H6a0 0 0 0 1 0 0V2z M13 2v5h5" />,
    cash: <><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    bolt: <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />,
    cpu: <><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3" /></>,
    award: <><circle cx="12" cy="9" r="6" /><path d="M9 14l-2 8 5-3 5 3-2-8" /></>,
    bars: <path d="M4 20V10M10 20V4M16 20v-8M22 20V8" />,
    pie: <><path d="M12 3v9h9" /><circle cx="12" cy="12" r="9" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  }[name];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{p}</svg>
  );
}

function Num({ children, size, weight = 700, color = T.ink }) {
  return <span style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontVariantNumeric: "tabular-nums", fontWeight: weight, fontSize: size, color, letterSpacing: "-0.01em" }}>{children}</span>;
}

function Empty({ label }) {
  return (
    <div className="av4-empty">
      <Icon name="info" size={18} color={T.faint} />
      <span>{label}</span>
    </div>
  );
}

function Card({ title, sub, icon, right, span = 12, dark = false, children }) {
  return (
    <section className={`av4-card c${span}`} style={dark ? { background: T.ink, borderColor: T.ink } : undefined}>
      {(title || right) && (
        <header className="av4-card-h">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {icon && <Icon name={icon} size={15} color={dark ? "rgba(255,255,255,.55)" : T.slate} />}
            <div>
              <div className="av4-card-t" style={dark ? { color: "#fff" } : undefined}>{title}</div>
              {sub && <div className="av4-card-s" style={dark ? { color: "rgba(255,255,255,.4)" } : undefined}>{sub}</div>}
            </div>
          </div>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export default function Analytics({ user, team, onBack }) {
  // ── DATA LAYER — preserved exactly (client-side Supabase aggregation) ──
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("month");

  useEffect(() => { fetchData(); }, [team, period]);

  const fetchData = async () => {
    setLoading(true);
    try {
      let query = supabase.from("invoices").select("*");
      if (team) {
        query = query.eq("team_id", team.id);
      } else {
        query = query.eq("user_id", user.id);
      }
      const now = new Date();
      if (period === "week") query = query.gte("created_at", new Date(now - 7*24*60*60*1000).toISOString());
      else if (period === "month") query = query.gte("created_at", new Date(now.getFullYear(), now.getMonth(), 1).toISOString());
      else if (period === "quarter") query = query.gte("created_at", new Date(now.getFullYear(), now.getMonth()-3, 1).toISOString());
      const { data } = await query.order("created_at", { ascending: true });
      setInvoices(data || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  // ── DERIVATIONS (client-side; same data) ──
  const total = invoices.length;
  const totalAmount = invoices.reduce((s, i) => s + (i.total || 0), 0);

  const autoApproved = invoices.filter(i => i.agent_decision === "auto_approved").length;
  const autoApprovalRate = total > 0 ? Math.round((autoApproved / total) * 100) : null;

  const hoursSaved = Math.round((total * MIN_PER_INVOICE) / 60);
  const costSaved = total * COST_PER_INVOICE;
  const fteMonths = hoursSaved / HOURS_PER_FTE_MONTH;
  const fteMeaningful = hoursSaved >= MIN_HOURS_FOR_FTE;

  // Status — bucket ALL statuses honestly; highlight the three v4 names + Other
  const statusOf = (s) => {
    if (s === "pushed") return "pushed";
    if (s === "review") return "review";
    if (s === "rejected" || s === "rejected_duplicate") return "rejected";
    return "other"; // paid, pending, partially_paid, validation_failed, push_uncertain, null...
  };
  const STATUS_DEF = [
    { key: "pushed", label: "Pushed", color: T.pos },
    { key: "review", label: "In review", color: T.amber },
    { key: "rejected", label: "Rejected", color: T.danger },
    { key: "other", label: "Other", color: T.slate },
  ];
  const statusCounts = STATUS_DEF.map(d => ({ ...d, value: invoices.filter(i => statusOf(i.status) === d.key).length }));
  const distinctStatuses = statusCounts.filter(s => s.value > 0).length;
  const statusEnough = total >= MIN_STATUS && distinctStatuses >= 2;

  // AI agent — account for EVERY agent_decision value (sums to total)
  const AGENT_DEF = [
    { key: "auto_approved", label: "Auto-approved", color: T.pos, match: d => d === "auto_approved" },
    { key: "escalated", label: "Escalated", color: T.warn, match: d => d === "escalated" },
    { key: "pending_approval", label: "Awaiting approval", color: T.amber, match: d => d === "pending_approval" },
    { key: "email", label: "Email-ingested", color: T.blue, match: d => d === "batch_email" || d === "email_auto_processed" },
    { key: "batch", label: "Batch (manual)", color: T.slate, match: d => d === "batch_manual" },
    { key: "none", label: "No agent decision", color: T.faint, match: d => d == null },
  ];
  const agentCounts = AGENT_DEF.map(d => ({ ...d, value: invoices.filter(i => d.match(i.agent_decision)).length }));
  const agentClassified = agentCounts.reduce((s, d) => s + d.value, 0);
  const agentOther = total - agentClassified; // any decision value not mapped above
  const agentBuckets = agentOther > 0
    ? [...agentCounts, { key: "other", label: "Other", color: T.muted, value: agentOther }]
    : agentCounts;

  // PO match — a neutral breakdown, NOT a "match rate" headline
  const matchOf = (m) => {
    if (m === "matched") return "matched";
    if (m === "non_po" || m === "no_po") return "non_po";
    if (m === "unmatched") return "unmatched";
    return "other"; // partial, mismatch, null
  };
  const MATCH_DEF = [
    { key: "matched", label: "PO-matched", color: T.pos },
    { key: "non_po", label: "Non-PO", color: T.slate },
    { key: "unmatched", label: "Unmatched", color: T.amber },
    { key: "other", label: "Other", color: T.faint },
  ];
  const matchCounts = MATCH_DEF.map(d => ({ ...d, value: invoices.filter(i => matchOf(i.match_status) === d.key).length }));

  // 30-day daily volume
  const dayKeys = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (29 - i));
    return d;
  });
  const dailyData = dayKeys.map(d => {
    const key = d.toISOString().split("T")[0];
    return { date: d, key, value: invoices.filter(inv => (inv.created_at || "").startsWith(key)).length };
  });
  const activeDays = dailyData.filter(d => d.value > 0).length;
  const volumeEnough = total >= MIN_VOLUME && activeDays >= MIN_VOLUME_DAYS;
  const maxDaily = Math.max(...dailyData.map(d => d.value), 1);

  // Top vendors — by amount, with count
  const vendorMap = {};
  invoices.forEach(i => {
    const v = i.vendor_name || "Unknown";
    if (!vendorMap[v]) vendorMap[v] = { count: 0, total: 0 };
    vendorMap[v].count++;
    vendorMap[v].total += i.total || 0;
  });
  const topVendors = Object.entries(vendorMap).sort((a, b) => b[1].total - a[1].total).slice(0, 5);
  const maxVendor = topVendors.length ? topVendors[0][1].total || 1 : 1;

  return (
    <div className="av4">
      <style>{CSS}</style>

      <button onClick={onBack} className="av4-back">← Dashboard</button>

      <div className="av4-head">
        <div>
          <h1 className="av4-title">Analytics</h1>
          <p className="av4-subtitle">{team?.name || "Personal"} · invoice intelligence</p>
        </div>
        <div className="av4-period">
          {["week", "month", "quarter", "all"].map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={"av4-period-b" + (period === p ? " on" : "")}>
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="av4-loading"><Icon name="bars" size={22} color={T.faint} /><span>Loading analytics…</span></div>
      ) : (
        <div className="av4-grid">

          {/* KPI ROW */}
          <Kpi span={3} icon="doc" label="Total Invoices" value={<Num size={30}>{fmtNum(total)}</Num>} sub="this period" />
          <Kpi span={3} icon="cash" label="Amount Processed" value={<Num size={30}>{fmtMoney(totalAmount)}</Num>} sub="this period" />
          <Kpi span={3} icon="cpu" label="Auto-Approval Rate" hero
            value={<Num size={30} color={T.pos}>{autoApprovalRate == null ? "—" : autoApprovalRate + "%"}</Num>}
            sub={total > 0 ? `${fmtNum(autoApproved)} of ${fmtNum(total)} auto-approved` : "no invoices yet"} />
          <Kpi span={3} icon="clock" label="Hours Saved" value={<Num size={30}>{fmtNum(hoursSaved)}h</Num>}
            sub="≈15 min/invoice estimate" estimate />

          {/* INVOICE VOLUME */}
          <Card span={8} title="Invoice Volume" sub="Daily, last 30 days" icon="bars">
            {volumeEnough ? (
              <div className="av4-bars">
                {dailyData.map((d, i) => (
                  <div key={d.key} className="av4-bar-col" title={`${d.key}: ${d.value}`}>
                    <div className="av4-bar-track">
                      <div className="av4-bar-fill" style={{ height: `${Math.max((d.value / maxDaily) * 100, d.value > 0 ? 6 : 0)}%` }} />
                    </div>
                    {i % 6 === 0 && <div className="av4-bar-x">{d.date.toLocaleDateString("en", { month: "short", day: "numeric" })}</div>}
                  </div>
                ))}
              </div>
            ) : (
              <Empty label={`Not enough data yet — daily trends appear once you've processed ~${MIN_VOLUME}+ invoices across a few days.`} />
            )}
          </Card>

          {/* INVOICE STATUS */}
          <Card span={4} title="Invoice Status" sub="Processing outcome" icon="pie">
            {total === 0 ? (
              <Empty label="No invoices yet." />
            ) : statusEnough ? (
              <Donut segments={statusCounts} total={total} />
            ) : (
              <StatusList rows={statusCounts} total={total} />
            )}
          </Card>

          {/* AI AGENT PERFORMANCE */}
          <Card span={7} dark title="AI Agent Performance" sub="Every decision accounted for" icon="cpu">
            {total === 0 ? (
              <Empty label="No agent activity yet." />
            ) : (
              <>
                <StackBar buckets={agentBuckets} total={total} dark />
                <div className="av4-legend">
                  {agentBuckets.filter(b => b.value > 0).map(b => (
                    <div key={b.key} className="av4-legend-i">
                      <span className="av4-dot" style={{ background: b.color }} />
                      <span className="av4-legend-l" style={{ color: "rgba(255,255,255,.72)" }}>{b.label}</span>
                      <Num size={13} weight={600} color="#fff">{b.value}</Num>
                    </div>
                  ))}
                </div>
                <div className="av4-reconcile">
                  <Num size={12} weight={600} color="rgba(255,255,255,.55)">{agentBuckets.reduce((s, b) => s + b.value, 0)}</Num>
                  <span> / {total} invoices classified</span>
                </div>

                <div className="av4-match">
                  <div className="av4-match-h">PO Match Breakdown</div>
                  <StackBar buckets={matchCounts} total={total} dark />
                  <div className="av4-legend">
                    {matchCounts.filter(b => b.value > 0).map(b => (
                      <div key={b.key} className="av4-legend-i">
                        <span className="av4-dot" style={{ background: b.color }} />
                        <span className="av4-legend-l" style={{ color: "rgba(255,255,255,.72)" }}>{b.label}</span>
                        <Num size={13} weight={600} color="#fff">{b.value}</Num>
                      </div>
                    ))}
                  </div>
                  <div className="av4-match-note">Most invoices are non-PO — matching applies only to PO-backed invoices.</div>
                </div>
              </>
            )}
          </Card>

          {/* TOP VENDORS */}
          <Card span={5} title="Top Vendors" sub="By amount processed" icon="award">
            {topVendors.length > 0 ? (
              <div className="av4-vendors">
                {topVendors.map(([name, d], i) => (
                  <div key={name} className="av4-vendor">
                    <div className="av4-vendor-top">
                      <span className="av4-vendor-name" title={name}>{name}</span>
                      <Num size={13} weight={600}>{fmtMoney(d.total)}</Num>
                    </div>
                    <div className="av4-vendor-track">
                      <div className="av4-vendor-fill" style={{ width: `${(d.total / maxVendor) * 100}%` }} />
                    </div>
                    <div className="av4-vendor-sub"><Num size={11} weight={500} color={T.faint}>{d.count}</Num>&nbsp;invoice{d.count === 1 ? "" : "s"}</div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty label="No vendor data yet — process your first invoice." />
            )}
          </Card>

          {/* ESTIMATED SAVINGS */}
          <Card span={12} title="Estimated Savings" sub="Modeled, not measured — see assumptions below" icon="bolt">
            <div className="av4-savings">
              <SaveStat label="Hours Saved" value={<Num size={26}>{fmtNum(hoursSaved)}h</Num>} note="≈15 min/invoice" />
              <SaveStat label="Cost Savings" value={<Num size={26}>{fmtMoney(costSaved)}</Num>} note="≈$25/invoice" />
              <SaveStat label="FTE Equivalent"
                value={fteMeaningful ? <Num size={26}>{fteMonths.toFixed(1)}</Num> : <Num size={26} color={T.faint}>—</Num>}
                note={fteMeaningful ? "FTE-months @160h/mo" : "more volume needed"} />
              <SaveStat label="Auto-Approval Rate"
                value={<Num size={26} color={T.pos}>{autoApprovalRate == null ? "—" : autoApprovalRate + "%"}</Num>}
                note="genuine automation" />
            </div>
            <div className="av4-assumptions">
              <Icon name="info" size={13} color={T.faint} />
              <span>Estimates use industry-standard manual-processing assumptions (~15 min &amp; ~$25 per invoice). They are projections, not tracked time.</span>
            </div>
          </Card>

        </div>
      )}
    </div>
  );
}

// ── sub-components ───────────────────────────────────────────────────
function Kpi({ span, icon, label, value, sub, hero, estimate }) {
  return (
    <div className={`av4-card av4-kpi c${span}` + (hero ? " hero" : "")}>
      <div className="av4-kpi-icon"><Icon name={icon} size={16} color={hero ? T.pos : T.slate} /></div>
      <div className="av4-kpi-v">{value}</div>
      <div className="av4-kpi-l">{label}</div>
      <div className={"av4-kpi-s" + (estimate ? " est" : "")}>{sub}</div>
    </div>
  );
}

function Donut({ segments, total }) {
  const size = 132, stroke = 16, r = (size / 2) - stroke / 2, circ = 2 * Math.PI * r;
  let offset = 0;
  const top = [...segments].filter(s => s.value > 0).sort((a, b) => b.value - a.value)[0];
  return (
    <div className="av4-donut-wrap">
      <div className="av4-donut">
        <svg width={size} height={size}>
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={T.line} strokeWidth={stroke} />
          {segments.map(s => {
            if (!s.value) return null;
            const frac = s.value / total;
            const dash = frac * circ;
            const el = (
              <circle key={s.key} cx={size/2} cy={size/2} r={r} fill="none" stroke={s.color} strokeWidth={stroke}
                strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={-offset}
                transform={`rotate(-90 ${size/2} ${size/2})`} strokeLinecap="butt" />
            );
            offset += dash;
            return el;
          })}
        </svg>
        <div className="av4-donut-mid">
          <Num size={24}>{top ? Math.round((top.value / total) * 100) : 0}%</Num>
          <span className="av4-donut-lbl">{top ? top.label : ""}</span>
        </div>
      </div>
      <div className="av4-donut-legend">
        {segments.filter(s => s.value > 0).map(s => (
          <div key={s.key} className="av4-legend-i">
            <span className="av4-dot" style={{ background: s.color }} />
            <span className="av4-legend-l" style={{ color: T.muted }}>{s.label}</span>
            <Num size={13} weight={600}>{s.value}</Num>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusList({ rows, total }) {
  return (
    <div className="av4-statuslist">
      <div className="av4-statuslist-note">Too few invoices for a breakdown chart — counts shown directly.</div>
      {rows.filter(r => r.value > 0).map(r => (
        <div key={r.key} className="av4-statusrow">
          <span className="av4-dot" style={{ background: r.color }} />
          <span className="av4-status-l">{r.label}</span>
          <Num size={14} weight={600}>{r.value}</Num>
        </div>
      ))}
      <div className="av4-statusrow total">
        <span className="av4-status-l" style={{ color: T.muted }}>Total</span>
        <Num size={14} weight={700}>{total}</Num>
      </div>
    </div>
  );
}

function StackBar({ buckets, total, dark }) {
  return (
    <div className="av4-stack" style={dark ? { background: "rgba(255,255,255,.08)" } : undefined}>
      {buckets.filter(b => b.value > 0).map(b => (
        <div key={b.key} className="av4-stack-seg" title={`${b.label}: ${b.value}`}
          style={{ width: `${(b.value / total) * 100}%`, background: b.color }} />
      ))}
    </div>
  );
}

function SaveStat({ label, value, note }) {
  return (
    <div className="av4-savestat">
      <div className="av4-savestat-v">{value}</div>
      <div className="av4-savestat-l">{label}</div>
      <div className="av4-savestat-n">{note}</div>
    </div>
  );
}

// ── styles ───────────────────────────────────────────────────────────
const CSS = `
.av4{--ink:#1b2a44;font-family:'Inter',system-ui,-apple-system,sans-serif;background:#f5f6f8;min-height:100vh;color:#1b2a44;padding:28px 24px 64px;max-width:1180px;margin:0 auto;-webkit-font-smoothing:antialiased;}
.av4 *{box-sizing:border-box;}
.av4-back{background:none;border:none;color:#6b7280;font-size:13px;cursor:pointer;margin-bottom:18px;font-family:inherit;padding:0;}
.av4-back:hover{color:#1b2a44;}
.av4-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-bottom:24px;}
.av4-title{font-size:26px;font-weight:800;letter-spacing:-0.02em;margin:0;color:#1b2a44;}
.av4-subtitle{font-size:13px;color:#9aa1ac;margin:4px 0 0;}
.av4-period{display:flex;gap:2px;background:#fff;border:1px solid #e6e8ec;padding:3px;border-radius:10px;}
.av4-period-b{background:none;border:none;padding:6px 14px;border-radius:7px;font-size:13px;font-weight:500;color:#6b7280;cursor:pointer;font-family:inherit;transition:all .15s;}
.av4-period-b.on{background:#1b2a44;color:#fff;}
.av4-loading{display:flex;flex-direction:column;align-items:center;gap:12px;padding:90px 0;color:#9aa1ac;font-size:14px;}
.av4-grid{display:grid;grid-template-columns:repeat(12,1fr);gap:16px;}
.av4-card{background:#fff;border:1px solid #e6e8ec;border-radius:12px;padding:18px 18px;box-shadow:0 1px 2px rgba(16,24,40,.04);animation:av4up .5s cubic-bezier(.2,.6,.2,1) both;}
.av4-grid>*:nth-child(1){animation-delay:.02s}.av4-grid>*:nth-child(2){animation-delay:.05s}.av4-grid>*:nth-child(3){animation-delay:.08s}.av4-grid>*:nth-child(4){animation-delay:.11s}.av4-grid>*:nth-child(5){animation-delay:.14s}.av4-grid>*:nth-child(6){animation-delay:.17s}.av4-grid>*:nth-child(7){animation-delay:.2s}.av4-grid>*:nth-child(8){animation-delay:.23s}.av4-grid>*:nth-child(9){animation-delay:.26s}
@keyframes av4up{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.c3{grid-column:span 3}.c4{grid-column:span 4}.c5{grid-column:span 5}.c7{grid-column:span 7}.c8{grid-column:span 8}.c12{grid-column:span 12}
.av4-card-h{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;}
.av4-card-t{font-size:14px;font-weight:700;letter-spacing:-0.01em;}
.av4-card-s{font-size:12px;color:#9aa1ac;margin-top:1px;}
.av4-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;text-align:center;color:#9aa1ac;font-size:12.5px;line-height:1.5;padding:34px 18px;min-height:120px;}
/* KPI */
.av4-kpi{display:flex;flex-direction:column;gap:0;padding:18px 18px 16px;position:relative;}
.av4-kpi.hero{border-color:#cfe6db;box-shadow:0 1px 2px rgba(27,127,92,.08),0 0 0 1px rgba(27,127,92,.04);}
.av4-kpi-icon{width:30px;height:30px;border-radius:8px;background:#f3f5f8;display:flex;align-items:center;justify-content:center;margin-bottom:12px;}
.av4-kpi.hero .av4-kpi-icon{background:#eaf5f0;}
.av4-kpi-v{line-height:1;margin-bottom:7px;}
.av4-kpi-l{font-size:12.5px;color:#6b7280;font-weight:500;}
.av4-kpi-s{font-size:11px;color:#9aa1ac;margin-top:3px;}
.av4-kpi-s.est{color:#c98a1b;}
/* bars */
.av4-bars{display:flex;align-items:flex-end;gap:3px;height:160px;padding-top:8px;}
.av4-bar-col{flex:1;display:flex;flex-direction:column;align-items:center;height:100%;position:relative;}
.av4-bar-track{width:100%;flex:1;display:flex;align-items:flex-end;}
.av4-bar-fill{width:100%;background:#1b2a44;border-radius:3px 3px 0 0;min-height:0;transition:height .8s cubic-bezier(.2,.6,.2,1);}
.av4-bar-col:hover .av4-bar-fill{background:#2f5fb3;}
.av4-bar-x{position:absolute;top:100%;margin-top:5px;font-size:9.5px;color:#9aa1ac;white-space:nowrap;font-family:'JetBrains Mono',monospace;}
/* donut */
.av4-donut-wrap{display:flex;flex-direction:column;align-items:center;gap:16px;}
.av4-donut{position:relative;width:132px;height:132px;}
.av4-donut-mid{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;}
.av4-donut-lbl{font-size:10.5px;color:#9aa1ac;}
.av4-donut-legend{width:100%;display:flex;flex-direction:column;gap:8px;}
.av4-legend{display:flex;flex-direction:column;gap:7px;margin-top:14px;}
.av4-legend-i{display:flex;align-items:center;gap:8px;}
.av4-legend-l{flex:1;font-size:12.5px;}
.av4-dot{width:8px;height:8px;border-radius:2px;flex-shrink:0;}
/* status list */
.av4-statuslist{display:flex;flex-direction:column;gap:9px;}
.av4-statuslist-note{font-size:11.5px;color:#9aa1ac;line-height:1.5;margin-bottom:4px;}
.av4-statusrow{display:flex;align-items:center;gap:9px;}
.av4-status-l{flex:1;font-size:13px;}
.av4-statusrow.total{border-top:1px solid #eef0f3;padding-top:9px;margin-top:2px;}
/* stack bar (dark card) */
.av4-stack{display:flex;width:100%;height:12px;border-radius:6px;overflow:hidden;background:#eef0f3;}
.av4-stack-seg{height:100%;transition:width .8s cubic-bezier(.2,.6,.2,1);}
.av4-reconcile{margin-top:12px;font-size:11.5px;color:rgba(255,255,255,.4);}
.av4-match{margin-top:22px;padding-top:18px;border-top:1px solid rgba(255,255,255,.1);}
.av4-match-h{font-size:12.5px;font-weight:600;color:rgba(255,255,255,.8);margin-bottom:12px;}
.av4-match-note{font-size:11.5px;color:rgba(255,255,255,.4);margin-top:12px;line-height:1.5;}
/* vendors */
.av4-vendors{display:flex;flex-direction:column;gap:15px;}
.av4-vendor-top{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:6px;}
.av4-vendor-name{font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.av4-vendor-track{background:#eef0f3;border-radius:5px;height:7px;overflow:hidden;}
.av4-vendor-fill{height:100%;background:#1b2a44;border-radius:5px;transition:width .8s cubic-bezier(.2,.6,.2,1);}
.av4-vendor-sub{font-size:11px;color:#9aa1ac;margin-top:4px;}
/* savings */
.av4-savings{display:grid;grid-template-columns:repeat(4,1fr);gap:0;}
.av4-savestat{padding:4px 20px;border-right:1px solid #eef0f3;}
.av4-savestat:last-child{border-right:none;}
.av4-savestat:first-child{padding-left:0;}
.av4-savestat-v{line-height:1;margin-bottom:7px;}
.av4-savestat-l{font-size:12.5px;color:#6b7280;font-weight:500;}
.av4-savestat-n{font-size:11px;color:#9aa1ac;margin-top:3px;}
.av4-assumptions{display:flex;align-items:flex-start;gap:7px;margin-top:18px;padding-top:14px;border-top:1px solid #eef0f3;font-size:11.5px;color:#9aa1ac;line-height:1.5;}
@media(max-width:900px){
  .av4-grid{grid-template-columns:repeat(2,1fr);}
  .c3,.c4,.c5,.c7,.c8,.c12{grid-column:span 2;}
  .av4-savings{grid-template-columns:repeat(2,1fr);gap:18px 0;}
  .av4-savestat:nth-child(2){border-right:none;}
}
@media(max-width:560px){
  .av4-grid{grid-template-columns:1fr;}
  .c3,.c4,.c5,.c7,.c8,.c12{grid-column:span 1;}
  .av4-savings{grid-template-columns:1fr;}
  .av4-savestat{border-right:none;padding:0 0 14px;border-bottom:1px solid #eef0f3;}
  .av4-savestat:last-child{border-bottom:none;padding-bottom:0;}
}
`;
