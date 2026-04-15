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

  // Load teams when user logs in
  useEffect(() => {
    if (user) loadTeams();
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

  if (!user) return <Auth />;

  const stageIndex = { upload:0, processing:1, review:2, matching:2, success:3 }[stage];

  // Route views
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
      onPrivacy={() => setView("privacy")} onTerms={() => setView("terms")}
    />
  );

  // Invoice processing flow
  return (
    <div className="app">
      <header className="header">
        <div className="logo" style={{ cursor:"pointer" }} onClick={() => setView("dashboard")}>AP<span>Flow</span></div>
        <div className="header-right">
          <button className="reset-btn" onClick={() => setView("dashboard")}>← Dashboard</button>
          <span className="ai-badge">⚡ AI Powered</span>
        </div>
      </header>
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
