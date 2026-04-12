import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import Auth from "./components/Auth";
import Dashboard from "./components/Dashboard";
import Upload from "./components/Upload";
import Processing from "./components/Processing";
import Review from "./components/Review";
import Success from "./components/Success";
import "./App.css";

const STAGES = { UPLOAD: "upload", PROCESSING: "processing", REVIEW: "review", SUCCESS: "success" };

export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [view, setView] = useState("dashboard"); // dashboard | invoice
  const [stage, setStage] = useState(STAGES.UPLOAD);
  const [file, setFile] = useState(null);
  const [filePreview, setFilePreview] = useState(null);
  const [extractedData, setExtractedData] = useState(null);
  const [erpResult, setErpResult] = useState(null);

  // Listen for auth changes
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  const handleFileSelected = async (selectedFile) => {
    setFile(selectedFile);
    setFilePreview(URL.createObjectURL(selectedFile));
    setStage(STAGES.PROCESSING);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const API = import.meta.env.VITE_API_URL || "http://localhost:4000";
      const res = await fetch(`${API}/api/extract`, {
        method: "POST",
        body: formData,
      });
      const result = await res.json();
      if (result.success) {
        setExtractedData(result.data);
        setStage(STAGES.REVIEW);
      } else throw new Error(result.error || "Extraction failed");
    } catch (err) {
      alert("Error: " + err.message);
      setStage(STAGES.UPLOAD);
    }
  };

  const handleApprove = async (data) => {
    setStage(STAGES.PROCESSING);
    try {
      const API = import.meta.env.VITE_API_URL || "http://localhost:4000";
      const res = await fetch(`${API}/api/push-erp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceData: data }),
      });
      const result = await res.json();

      // Save to Supabase
      if (user) {
        await supabase.from("invoices").insert({
          user_id: user.id,
          invoice_number: data.invoiceNumber,
          vendor_name: data.vendor?.name,
          invoice_date: data.invoiceDate,
          due_date: data.dueDate,
          total: data.total,
          status: "pushed",
          erp_reference: result.erpReference,
          raw_data: data,
        });
      }

      setErpResult(result);
      setStage(STAGES.SUCCESS);
    } catch (err) {
      alert("ERP push failed: " + err.message);
      setStage(STAGES.REVIEW);
    }
  };

  const handleReset = () => {
    setStage(STAGES.UPLOAD);
    setFile(null);
    setFilePreview(null);
    setExtractedData(null);
    setErpResult(null);
    setView("dashboard");
  };

  const startNewInvoice = () => {
    setStage(STAGES.UPLOAD);
    setFile(null);
    setFilePreview(null);
    setExtractedData(null);
    setErpResult(null);
    setView("invoice");
  };

  if (authLoading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#f5f2eb" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 800, fontSize: 24, marginBottom: 12 }}>
          Invoice<span style={{ color: "#e8531a" }}>IQ</span>
        </div>
        <div style={{ color: "#7a7a6e", fontSize: 14 }}>Loading...</div>
      </div>
    </div>
  );

  if (!user) return <Auth />;

  if (view === "dashboard") return (
    <Dashboard user={user} onNewInvoice={startNewInvoice} onSignOut={handleSignOut} />
  );

  // Invoice processing flow
  const stageIndex = { upload: 0, processing: 1, review: 2, success: 3 }[stage];
  return (
    <div className="app">
      <header className="header">
        <div className="logo" style={{ cursor: "pointer" }} onClick={() => setView("dashboard")}>
          Invoice<span>IQ</span>
        </div>
        <div className="header-right">
          <button className="reset-btn" onClick={() => setView("dashboard")}>← Dashboard</button>
          <span className="ai-badge">⚡ AI Powered</span>
        </div>
      </header>

      <div className="progress-bar">
        {["Upload", "Extract", "Review", "Push to ERP"].map((label, i) => (
          <div key={i} className={`progress-step ${i <= stageIndex ? "active" : ""} ${i < stageIndex ? "done" : ""}`}>
            <div className="progress-dot">{i < stageIndex ? "✓" : i + 1}</div>
            <div className="progress-label">{label}</div>
            {i < 3 && <div className={`progress-line ${i < stageIndex ? "done" : ""}`} />}
          </div>
        ))}
      </div>

      <main className="main">
        {stage === STAGES.UPLOAD && <Upload onFileSelected={handleFileSelected} />}
        {stage === STAGES.PROCESSING && <Processing />}
        {stage === STAGES.REVIEW && (
          <Review data={extractedData} filePreview={filePreview} onApprove={handleApprove} onBack={() => setStage(STAGES.UPLOAD)} />
        )}
        {stage === STAGES.SUCCESS && (
          <Success result={erpResult} data={extractedData} onReset={handleReset} />
        )}
      </main>
    </div>
  );
}
