import { useEffect, useState } from "react";

const steps = [
  "Reading document...",
  "Identifying vendor details...",
  "Extracting line items...",
  "Calculating totals...",
  "Matching PO references...",
  "Finalizing extraction...",
];

export default function Processing() {
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setStepIndex((i) => Math.min(i + 1, steps.length - 1));
    }, 900);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="processing-page">
      <div className="processing-card">
        <div className="processing-spinner">
          <div className="spinner-ring" />
          <div className="spinner-icon">⚡</div>
        </div>
        <h2>AI is reading your invoice</h2>
        <div className="processing-step">{steps[stepIndex]}</div>
        <div className="processing-steps-list">
          {steps.map((s, i) => (
            <div key={i} className={`step-item ${i < stepIndex ? "done" : i === stepIndex ? "active" : ""}`}>
              <span className="step-check">{i < stepIndex ? "✓" : "·"}</span>
              <span>{s}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
