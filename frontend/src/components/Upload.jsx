import { useState, useRef } from "react";

export default function Upload({ onFileSelected }) {
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef();

  const handleFile = (file) => {
    if (!file) return;
    const allowed = ["image/jpeg","image/png","image/webp","application/pdf"];
    if (!allowed.includes(file.type)) {
      alert("Please upload a PDF or image (JPG, PNG, WEBP)");
      return;
    }
    onFileSelected(file);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer.files[0]);
  };

  return (
    <div className="upload-page">
      <div className="upload-hero">
        <h1>Upload Invoice or PO</h1>
        <p>AI extracts all data in seconds. Works with PDFs, scans, and photos.</p>
      </div>

      <div
        className={`dropzone ${dragOver ? "dragover" : ""}`}
        onClick={() => fileRef.current.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <div className="dropzone-icon">📄</div>
        <div className="dropzone-title">Drop your invoice here</div>
        <div className="dropzone-sub">or click to browse files</div>
        <div className="dropzone-formats">PDF · JPG · PNG · WEBP</div>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,image/jpeg,image/png,image/webp"
          style={{ display: "none" }}
          onChange={(e) => handleFile(e.target.files[0])}
        />
      </div>

      <div className="upload-features">
        {[
          { icon: "🧠", text: "AI reads any invoice format" },
          { icon: "⚡", text: "Extracts in under 5 seconds" },
          { icon: "✅", text: "99.2% extraction accuracy" },
        ].map((f, i) => (
          <div className="upload-feature" key={i}>
            <span>{f.icon}</span> {f.text}
          </div>
        ))}
      </div>
    </div>
  );
}
