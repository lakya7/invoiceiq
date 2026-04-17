import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import Auth from "./components/Auth";
import Dashboard from "./components/Dashboard";
import Settings from "./components/Settings";
import TeamManagement from "./components/TeamManagement";
import Billing from './components/Billing';
import ERPConnections from './components/ERPConnections';
import PurchaseOrders from "./components/PurchaseOrders";
import Upload from "./components/Upload";
import Processing from "./components/Processing";
import Review from "./components/Review";
import Success from "./components/Success";
import Legal from "./components/Legal";
import Analytics from "./components/Analytics";
import EmailAgent from "./components/EmailAgent";
import BatchUpload from "./components/BatchUpload";
import Support from "./components/Support";
import "./App.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";
const STAGES = { UPLOAD:"upload", PROCESSING:"processing", REVIEW:"review", MATCHING:"matching", SUCCESS:"success" };

export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [view, setView] = useState("dashboard");
  const [team, setTeam] = useState(null); // active team
  const [teams, setTeams] = useState([]);

  // Invoice flow state
  const [stage, setStage] = useState(STAGES.UPLOAD);
  const [filePreview, setFilePreview] = useState(null);
  const [extractedData, setExtractedData] = useState(null);
  const [matchResult, setMatchResult] = useState(null);
  const [erpResult, setErpResult] = useState(null);
  const [statusMsg, setStatusMsg] = useState("");
  const [showAIPopup, setShowAIPopup] = useState(false);

  // Auth listener
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Load teams when user logs in + handle invite token
  useEffect(() => {
    if (user) {
      loadTeams();
      // Check for invite token in URL
      const params = new URLSearchParams(window.location.search);
      const inviteToken = params.get("invite");
      const emailAgentConnected = params.get("emailAgentConnected");
      const emailAgentError = params.get("emailAgentError");

      if (inviteToken) {
        fetch(`${API}/api/invite/accept`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: inviteToken, userId: user.id })
        }).then(r => r.json()).then(data => {
          if (data.success) {
            window.history.replaceState({}, "", "/login");
            loadTeams();
          }
        }).catch(console.error);
      }

      if (emailAgentConnected) {
        window.history.replaceState({}, "", "/login");
        setView("emailAgent");
      }

      if (emailAgentError) {
        window.history.replaceState({}, "", "/login");
        alert("Gmail connection failed. Please try again.");
      }
    }
  }, [user]);

  const loadTeams = async () => {
    try {
      const res = await fetch(`${API}/api/teams/user/${user.id}`);
      const data = await res.json();
      if (data.success && data.teams.length > 0) {
        setTeams(data.teams);
        setTeam(data.teams[0]); // default to first team
      }
    } catch (e) { console.error("Team load error:", e); }
  };

  const handleSignOut = async () => { await supabase.auth.signOut(); setUser(null); setTeam(null); setTeams([]); };

  // Invoice processing flow
  const handleFileSelected = async (file) => {
    // Check usage limit
    if (team) {
      try {
        const r = await fetch(`${API}/api/billing/check/${team.id}`);
        const d = await r.json();
        if (d.success && !d.allowed) {
          alert(`You've reached your ${d.plan} plan limit of ${d.limit} documents/month. Please upgrade your plan.`);
          setView("billing");
          return;
        }
      } catch(e) { console.error("Usage check failed:", e); }
    }
    setFilePreview(URL.createObjectURL(file));
    setStage(STAGES.PROCESSING);
    setStatusMsg("Extracting invoice data...");

    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`${API}/api/extract`, { method: "POST", body: formData });
      const result = await res.json();
      if (!result.success) throw new Error(result.error);

      // ── DUPLICATE DETECTION ──────────────────────────────────────
      const extracted = result.data;
      if (extracted.invoiceNumber || extracted.vendor?.name) {
        try {
          let query = supabase.from("invoices").select("*").eq("user_id", user.id);
          if (team) query = query.eq("team_id", team.id);
          if (extracted.invoiceNumber) query = query.eq("invoice_number", extracted.invoiceNumber);
          const { data: existing } = await query;

          if (existing && existing.length > 0) {
            const dup = existing[0];
            const dupDate = new Date(dup.created_at).toLocaleDateString("en-US", { day:"numeric", month:"short", year:"numeric" });
            const proceed = window.confirm(
              `⚠️ Duplicate Invoice Detected!\n\n` +
              `Invoice #${extracted.invoiceNumber} from ${extracted.vendor?.name || "this vendor"} ` +
              `was already processed on ${dupDate}.\n` +
              `ERP Ref: ${dup.erp_reference || "N/A"}\n\n` +
              `Do you want to proceed anyway?`
            );
            if (!proceed) {
              setStage(STAGES.UPLOAD);
              return;
            }
          }
        } catch (e) { console.error("Duplicate check error:", e); }
      }
      // ────────────────────────────────────────────────────────────

      setExtractedData(result.data);
      setStage(STAGES.REVIEW);
    } catch (err) { alert("Extraction error: " + err.message); setStage(STAGES.UPLOAD); }
  };

  const handleApprove = async (data) => {
    setStage(STAGES.PROCESSING);

    // PO Matching (if team exists)
    let match = null;
    if (team) {
      setStatusMsg("Matching against purchase orders...");
      try {
        const res = await fetch(`${API}/api/match-po`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ invoiceData: data, teamId: team.id }),
        });
        const matchData = await res.json();
        if (matchData.success) match = matchData.match;
        setMatchResult(match);
      } catch (e) { console.error("PO match error:", e); }
    }

    setStatusMsg("Pushing to ERP...");
    try {
      const res = await fetch(`${API}/api/push-erp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceData: data, userId: user?.id, teamId: team?.id, matchResult: match }),
      });
      const result = await res.json();

      // Save invoice to Supabase
      await supabase.from("invoices").insert({
        user_id: user.id,
        team_id: team?.id,
        invoice_number: data.invoiceNumber,
        vendor_name: data.vendor?.name,
        invoice_date: data.invoiceDate,
        due_date: data.dueDate,
        total: data.total,
        status: "pushed",
        match_status: match?.matchStatus || "unmatched",
        match_details: match,
        po_id: match?.matchedPoId || null,
        erp_reference: result.erpReference,
        submitted_by: user.id,
        raw_data: data,
      });

      setErpResult(result);
      setStage(STAGES.SUCCESS);
    } catch (err) { alert("ERP push failed: " + err.message); setStage(STAGES.REVIEW); }
  };

  const handleReset = () => {
    setStage(STAGES.UPLOAD); setFilePreview(null);
    setExtractedData(null); setMatchResult(null); setErpResult(null);
    setView("dashboard");
  };

  const startNewInvoice = () => {
    setStage(STAGES.UPLOAD); setFilePreview(null);
    setExtractedData(null); setMatchResult(null); setErpResult(null);
    setView("invoice");
  };

  if (authLoading) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", minHeight:"100vh", background:"#f5f2eb" }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ fontFamily:"Syne,sans-serif", fontWeight:800, fontSize:24, marginBottom:12 }}>AP<span style={{color:"#e8531a"}}>Flow</span></div>
        <div style={{ color:"#7a7a6e", fontSize:14 }}>Loading...</div>
      </div>
    </div>
  );

  if (!user) {
    // If on /login path or has invite token, show Auth
    const path = window.location.pathname;
    const hash = window.location.hash;
    const search = window.location.search;
    if (path === "/login" || search.includes("invite=") || search.includes("signup=") || hash.includes("access_token")) {
      return <Auth />;
    }
    // Otherwise redirect to landing page
    window.location.href = "/landing.html";
    return null;
  }

  const stageIndex = { upload:0, processing:1, review:2, matching:2, success:3 }[stage];

  // Route views
  if (view === "batchUpload") return <BatchUpload user={user} team={team} onBack={() => setView("dashboard")} onDone={() => setView("dashboard")} />;
  if (view === "support") return <Support user={user} team={team} onBack={() => setView("dashboard")} />;
  if (view === "emailAgent") return <EmailAgent user={user} team={team} onBack={() => setView("dashboard")} />;
  if (view === "analytics") return <Analytics user={user} team={team} onBack={() => setView("dashboard")} />;
  if (view === "privacy") return <Legal page="privacy" onBack={() => setView("dashboard")} />;
  if (view === "terms") return <Legal page="terms" onBack={() => setView("dashboard")} />;
  if (view === "erp") return (
    <ERPConnections user={user} team={team} onBack={() => setView("dashboard")} />
  );

  if (view === "billing") return (
    <Billing user={user} team={team} onBack={() => setView("dashboard")} />
  );

  if (view === "settings") return <Settings user={user} onBack={() => setView("dashboard")} />;
  if (view === "team") return <TeamManagement user={user} team={team} onBack={() => setView("dashboard")} />;
  if (view === "pos") return <PurchaseOrders user={user} team={team} onBack={() => setView("dashboard")} />;

  if (view === "dashboard") return (
    <Dashboard
      user={user} team={team} teams={teams}
      onTeamChange={t => setTeam(t)}
      onNewInvoice={startNewInvoice}
      onSignOut={handleSignOut}
      onSettings={() => setView("settings")}
      onTeam={() => setView("team")}
      onPOs={() => setView("pos")} onBilling={() => setView("billing")} onERP={() => setView("erp")}
      onAnalytics={() => setView("analytics")}
      onEmailAgent={() => setView("emailAgent")}
      onBatchUpload={() => setView("batchUpload")}
      onSupport={() => setView("support")}
      onPrivacy={() => setView("privacy")} onTerms={() => setView("terms")}
      onReport={async () => {
        if (!team) return alert("Please create a team first");
        try {
          const res = await fetch(`${API}/api/agent/report`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ teamId: team.id, userId: user.id })
          });
          const data = await res.json();
          if (data.success) alert("📊 Monthly report sent to your email!");
          else alert("Error: " + data.error);
        } catch (e) { alert("Failed to generate report"); }
      }}
    />
  );

  // Invoice processing flow
  return (
    <div className="app">
      <header className="header">
        <div className="logo" style={{ cursor:"pointer" }} onClick={() => setView("dashboard")}>AP<span>Flow</span></div>
        <div className="header-right">
          <button className="reset-btn" onClick={() => setView("dashboard")}>← Dashboard</button>
          <span className="ai-badge" style={{ cursor:"pointer" }} onClick={() => setShowAIPopup(true)}>⚡ AI Powered</span>
        </div>
      </header>

      {/* AI Features Popup */}
      {showAIPopup && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }} onClick={() => setShowAIPopup(false)}>
          <div style={{ background:"#fff", borderRadius:16, padding:32, maxWidth:520, width:"100%", fontFamily:"DM Sans, sans-serif" }} onClick={e => e.stopPropagation()}>
            
            {/* Header */}
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:24 }}>
              <div>
                <div style={{ fontFamily:"Syne, sans-serif", fontWeight:800, fontSize:22, marginBottom:4 }}>⚡ Powered by Claude AI</div>
                <div style={{ fontSize:13, color:"#7a7a6e" }}>Anthropic's Claude Vision — the world's most accurate document AI</div>
              </div>
              <button onClick={() => setShowAIPopup(false)} style={{ background:"none", border:"none", fontSize:20, cursor:"pointer", color:"#7a7a6e" }}>×</button>
            </div>

            {/* Stats */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12, marginBottom:24 }}>
              {[
                { num:"92%", label:"Less manual entry" },
                { num:"4 sec", label:"Per invoice" },
                { num:"$40K", label:"Saved per year" },
              ].map((s,i) => (
                <div key={i} style={{ background:"#f5f2eb", borderRadius:10, padding:"14px 12px", textAlign:"center" }}>
                  <div style={{ fontFamily:"Syne, sans-serif", fontWeight:800, fontSize:22, color:"#e8531a" }}>{s.num}</div>
                  <div style={{ fontSize:11, color:"#7a7a6e", marginTop:2 }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* Features */}
            <div style={{ display:"flex", flexDirection:"column", gap:12, marginBottom:24 }}>
              {[
                { icon:"🔍", title:"AI Data Extraction", desc:"Reads any invoice in 4 seconds — PDFs, scans, photos. Extracts vendor, amounts, dates, line items automatically." },
                { icon:"🔗", title:"Smart PO Matching", desc:"Automatically matches invoices against your purchase orders. Flags mismatches before you approve payment." },
                { icon:"⚠️", title:"Duplicate Detection", desc:"Catches duplicate invoices before they're paid. Saves companies thousands in accidental double payments." },
                { icon:"🚀", title:"ERP Integration", desc:"One-click push to Oracle Fusion, QuickBooks, SAP and more. No copy-pasting, no manual entry." },
              ].map((f,i) => (
                <div key={i} style={{ display:"flex", gap:12, alignItems:"flex-start", padding:"12px 14px", background:"#faf9f7", borderRadius:10, border:"1px solid #e2ddd4" }}>
                  <div style={{ fontSize:20, flexShrink:0 }}>{f.icon}</div>
                  <div>
                    <div style={{ fontWeight:600, fontSize:13, marginBottom:2 }}>{f.title}</div>
                    <div style={{ fontSize:12, color:"#7a7a6e", lineHeight:1.5 }}>{f.desc}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Demo video link */}
            <a
              href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
              target="_blank"
              rel="noopener noreferrer"
              style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8, background:"#0a0f1e", color:"#fff", borderRadius:10, padding:"12px 20px", textDecoration:"none", fontSize:14, fontWeight:500, marginBottom:12 }}
            >
              ▶ Watch Demo Video
            </a>

            <button onClick={() => setShowAIPopup(false)} style={{ width:"100%", background:"transparent", border:"1px solid #e2ddd4", color:"#7a7a6e", borderRadius:10, padding:"11px 20px", fontSize:14, cursor:"pointer", fontFamily:"DM Sans, sans-serif" }}>
              Close
            </button>
          </div>
        </div>
      )}
      <div className="progress-bar">
        {["Upload","Extract","Review","Push to ERP"].map((label, i) => (
          <div key={i} className={`progress-step ${i<=stageIndex?"active":""} ${i<stageIndex?"done":""}`}>
            <div className="progress-dot">{i<stageIndex?"✓":i+1}</div>
            <div className="progress-label">{label}</div>
            {i<3 && <div className={`progress-line ${i<stageIndex?"done":""}`} />}
          </div>
        ))}
      </div>
      <main className="main">
        {stage === STAGES.UPLOAD && <Upload onFileSelected={handleFileSelected} />}
        {stage === STAGES.PROCESSING && <Processing statusMsg={statusMsg} />}
        {stage === STAGES.REVIEW && <Review data={extractedData} filePreview={filePreview} onApprove={handleApprove} onBack={() => setStage(STAGES.UPLOAD)} />}
        {stage === STAGES.SUCCESS && <Success result={erpResult} data={extractedData} matchResult={matchResult} onReset={handleReset} />}
      </main>
    </div>
  );
}
