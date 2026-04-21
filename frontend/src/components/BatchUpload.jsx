import { useState, useRef } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

export default function BatchUpload({ user, team, onBack, onDone }) {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef();

  const handleFile = (f) => {
    if (f && (f.name.endsWith(".zip") || f.type === "application/zip")) {
      setFile(f);
      setResult(null);
    } else {
      alert("Please upload a ZIP file containing PDF invoices");
    }
  };

  const handleUpload = async () => {
    if (!file || !team) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("zip", file);
      formData.append("teamId", team.id);
      formData.append("userId", user.id);

      const res = await fetch(`${API}/api/batch/upload`, { method: "POST", body: formData });
      const data = await res.json();
      setResult(data);
    } catch (e) { alert("Upload failed: " + e.message); }
    setUploading(false);
  };

  const statusColor = { processed: "#16a34a", duplicate: "#d97706", skipped: "#6b7280", failed: "#dc2626" };
  const statusIcon = { processed: "✅", duplicate: "⚠️", skipped: "⏭️", failed: "❌" };

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "32px 24px", fontFamily: "DM Sans,sans-serif" }}>
      <button onClick={onBack} style={{ background: "none", border: "none", color: "#9ca3af", fontSize: 13, cursor: "pointer", marginBottom: 20, fontFamily: "DM Sans,sans-serif" }}>← Back</button>

      {/* Header */}
      <div style={{ background: "linear-gradient(135deg,#0a0f1e,#1a2040)", borderRadius: 16, padding: "32px", marginBottom: 24, color: "white" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 12 }}>
          <div style={{ fontSize: 40 }}>📦</div>
          <div>
            <h1 style={{ fontFamily: "Syne,sans-serif", fontSize: 24, fontWeight: 800, margin: 0 }}>Batch ZIP Upload</h1>
            <p style={{ color: "rgba(255,255,255,0.45)", fontSize: 14, margin: "4px 0 0" }}>Process multiple invoices at once</p>
          </div>
        </div>
        <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 14, lineHeight: 1.7, margin: 0 }}>
          Upload a ZIP file containing multiple PDF invoices. Billtiq will extract, validate and process each one automatically — duplicates are detected and skipped.
        </p>
      </div>

      {/* Upload Area */}
      {!result && (
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
          onClick={() => fileRef.current?.click()}
          style={{ border: `2px dashed ${dragging ? "#e8531a" : file ? "#16a34a" : "#e5e7eb"}`, borderRadius: 16, padding: "48px 32px", textAlign: "center", cursor: "pointer", background: dragging ? "#fff7f4" : file ? "#f0fdf4" : "#fafafa", transition: "all 0.2s", marginBottom: 20 }}
        >
          <input ref={fileRef} type="file" accept=".zip" style={{ display: "none" }} onChange={e => handleFile(e.target.files[0])} />
          <div style={{ fontSize: 48, marginBottom: 16 }}>{file ? "📦" : "⬆️"}</div>
          {file ? (
            <>
              <div style={{ fontFamily: "Syne,sans-serif", fontWeight: 700, fontSize: 18, color: "#16a34a", marginBottom: 8 }}>{file.name}</div>
              <div style={{ fontSize: 13, color: "#6b7280" }}>{(file.size / 1024).toFixed(1)} KB · Click to change</div>
            </>
          ) : (
            <>
              <div style={{ fontFamily: "Syne,sans-serif", fontWeight: 700, fontSize: 18, color: "#1a1a2e", marginBottom: 8 }}>Drop ZIP file here</div>
              <div style={{ fontSize: 13, color: "#9ca3af" }}>or click to browse · ZIP files containing PDF invoices only</div>
            </>
          )}
        </div>
      )}

      {/* Instructions */}
      {!result && !file && (
        <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 12, padding: "16px 20px", marginBottom: 20 }}>
          <div style={{ fontWeight: 600, color: "#92400e", marginBottom: 8, fontSize: 13 }}>⚠️ How to prepare your ZIP file</div>
          <ol style={{ paddingLeft: 18, fontSize: 13, color: "#78350f", lineHeight: 2 }}>
            <li>Put all your invoice PDFs into a single folder</li>
            <li>Right-click the folder → <strong>Send to → Compressed (zipped) folder</strong></li>
            <li>Upload the ZIP file here</li>
            <li>Billtiq will process each PDF automatically</li>
          </ol>
        </div>
      )}

      {/* Upload Button */}
      {file && !result && (
        <button onClick={handleUpload} disabled={uploading} style={{ width: "100%", background: uploading ? "#9ca3af" : "#e8531a", color: "white", border: "none", padding: "16px", borderRadius: 12, fontSize: 15, fontWeight: 600, cursor: uploading ? "not-allowed" : "pointer", fontFamily: "DM Sans,sans-serif", marginBottom: 12 }}>
          {uploading ? "⏳ Processing invoices..." : `🚀 Process ${file.name}`}
        </button>
      )}

      {uploading && (
        <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 12, padding: "16px 20px", textAlign: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 13, color: "#1d4ed8" }}>🤖 Claude AI is reading each PDF... This may take a moment depending on the number of invoices.</div>
        </div>
      )}

      {/* Results */}
      {result && (
        <>
          {/* Summary */}
          <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
            {[
              { label: "Processed", value: result.processed, color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0" },
              { label: "Duplicates", value: result.skipped, color: "#d97706", bg: "#fffbeb", border: "#fde68a" },
              { label: "Failed", value: result.failed, color: "#dc2626", bg: "#fef2f2", border: "#fecaca" },
            ].map((s, i) => (
              <div key={i} style={{ flex: 1, background: s.bg, border: `1px solid ${s.border}`, borderRadius: 12, padding: "16px 20px", textAlign: "center" }}>
                <div style={{ fontFamily: "Syne,sans-serif", fontSize: 32, fontWeight: 800, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: 12, color: s.color, marginTop: 4 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Invoice List */}
          <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 14, overflow: "hidden", marginBottom: 20 }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #f3f4f6", fontFamily: "Syne,sans-serif", fontWeight: 700, fontSize: 15, color: "#1a1a2e" }}>
              Invoice Results ({result.invoices?.length || 0} files)
            </div>
            {result.invoices?.map((inv, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 20px", borderBottom: i < result.invoices.length - 1 ? "1px solid #f3f4f6" : "none", background: i % 2 === 0 ? "white" : "#fafafa" }}>
                <span style={{ fontSize: 18 }}>{statusIcon[inv.status] || "•"}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#1a1a2e" }}>{inv.filename}</div>
                  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                    {inv.status === "processed" && `#${inv.invoiceNumber} · ${inv.vendor} · $${inv.amount}`}
                    {inv.status === "duplicate" && `#${inv.invoiceNumber} — already processed on ${inv.originalDate}`}
                    {inv.status === "skipped" && inv.reason}
                    {inv.status === "failed" && inv.reason}
                  </div>
                </div>
                <span style={{ fontSize: 11, color: statusColor[inv.status], background: `${statusColor[inv.status]}15`, padding: "3px 10px", borderRadius: 20, fontWeight: 600, fontFamily: "DM Mono,monospace" }}>
                  {inv.status.toUpperCase()}
                </span>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 12 }}>
            <button onClick={() => { setFile(null); setResult(null); }} style={{ flex: 1, background: "white", color: "#1a1a2e", border: "1.5px solid #e5e7eb", padding: "13px", borderRadius: 12, fontSize: 14, fontWeight: 500, cursor: "pointer", fontFamily: "DM Sans,sans-serif" }}>
              Upload Another ZIP
            </button>
            <button onClick={onDone} style={{ flex: 1, background: "#e8531a", color: "white", border: "none", padding: "13px", borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "DM Sans,sans-serif" }}>
              View Dashboard →
            </button>
          </div>
        </>
      )}
    </div>
  );
}
