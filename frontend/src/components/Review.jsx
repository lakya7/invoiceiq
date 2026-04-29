import { useState, useEffect } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

function Field({ label, value, onChange, warning }) {
  return (
    <div className="field">
      <label className="field-label">{label}</label>
      <input
        className="field-input"
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        style={warning ? { borderColor: "#f59e0b", background: "#fffbeb" } : {}}
      />
      {warning && <div style={{ fontSize: 11, color: "#d97706", marginTop: 3 }}>⚠ {warning}</div>}
    </div>
  );
}

// ── LOCAL VALIDATION (runs instantly, no API) ─────────────────
function runLocalValidation(form) {
  const errors = [];
  const warnings = [];

  if (!form.invoiceNumber) errors.push("Invoice number is required");
  if (!form.total || form.total <= 0) errors.push("Invoice total must be greater than zero");
  if (!form.invoiceDate) errors.push("Invoice date is required");
  if (!form.vendor?.name) errors.push("Vendor name is required");

  if (form.invoiceDate) {
    const invDate = new Date(form.invoiceDate);
    if (invDate > new Date()) errors.push("Invoice date is in the future — ERP will reject this");
  }

  if (form.dueDate && form.invoiceDate) {
    if (new Date(form.dueDate) < new Date(form.invoiceDate)) {
      errors.push("Due date is before invoice date");
    }
  }

  if (!form.poNumber) warnings.push("No PO number — will be processed as a non-PO direct expense");

  if (form.lineItems?.length > 0) {
    const lineTotal = form.lineItems.reduce((s, l) => s + (l.amount || 0), 0);
    const tax = form.tax || 0;
    const expected = lineTotal + tax;
    if (Math.abs(expected - (form.total || 0)) > 0.05) {
      errors.push(`Amount mismatch: line items (${lineTotal.toFixed(2)}) + tax (${tax.toFixed(2)}) = ${expected.toFixed(2)}, but total is ${form.total}`);
    }
  }

  const validCurrencies = ["USD", "EUR", "GBP", "INR", "CAD", "AUD", "SGD", "JPY"];
  if (form.currency && !validCurrencies.includes(form.currency.toUpperCase())) {
    warnings.push(`Currency "${form.currency}" may not be supported in your ERP`);
  }

  if (form.invoiceNumber?.length > 50) {
    errors.push("Invoice number exceeds 50 characters — Oracle limit");
  }

  return { errors, warnings };
}

export default function Review({ data, filePreview, onApprove, onBack, team, pdfBase64, pdfFilename }) {
  const [form, setForm] = useState(data || {});
  const [showModal, setShowModal] = useState(false);
  const [oracleValidating, setOracleValidating] = useState(false);
  const [oracleResult, setOracleResult] = useState(null);

  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }));
  const setVendor = (key, val) => setForm((f) => ({ ...f, vendor: { ...f.vendor, [key]: val } }));

  const confidence = Math.round((form.confidence || 0.9) * 100);
  const currency = form.currency || "USD";
  const sym = currency === "INR" ? "₹" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : "$";

  // Run local validation live as user edits
  const { errors: localErrors, warnings: localWarnings } = runLocalValidation(form);
  const hasLocalErrors = localErrors.length > 0;

  // Handle Push button click — show modal with validation
  const handlePushClick = async () => {
    setShowModal(true);
    setOracleResult(null);

    // Run Oracle-specific validation if team has Oracle connected
    if (team?.id) {
      setOracleValidating(true);
      try {
        const res = await fetch(`${API}/api/erp/oracle/validate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ teamId: team.id, invoiceData: form }),
        });
        const data = await res.json();
        setOracleResult(data);
      } catch (e) {
        setOracleResult({ valid: true, errors: [], warnings: ["Could not run Oracle validation — proceeding with local checks only"] });
      }
      setOracleValidating(false);
    }
  };

  // Combine local + oracle validation
  const allErrors = [...localErrors, ...(oracleResult?.errors || [])];
  const allWarnings = [...localWarnings, ...(oracleResult?.warnings || [])];
  const canPush = allErrors.length === 0;

  return (
    <div className="review-page">
      <div className="review-header">
        <div>
          <h2>Review Extracted Data</h2>
          <p>AI extracted the fields below. Edit anything before approving.</p>
        </div>
        <div className={`confidence-badge ${confidence >= 90 ? "high" : confidence >= 70 ? "med" : "low"}`}>
          {confidence}% confidence
        </div>
      </div>

      {/* Inline validation banner */}
      {(localErrors.length > 0 || localWarnings.length > 0) && (
        <div style={{ marginBottom: 20 }}>
          {localErrors.length > 0 && (
            <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12, padding: "14px 18px", marginBottom: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: "#dc2626", marginBottom: 6 }}>🔴 {localErrors.length} issue(s) must be fixed before pushing</div>
              {localErrors.map((e, i) => <div key={i} style={{ fontSize: 12, color: "#dc2626", marginTop: 3 }}>• {e}</div>)}
            </div>
          )}
          {localWarnings.length > 0 && (
            <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 12, padding: "14px 18px" }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: "#d97706", marginBottom: 6 }}>⚠️ {localWarnings.length} warning(s) — review before pushing</div>
              {localWarnings.map((w, i) => <div key={i} style={{ fontSize: 12, color: "#d97706", marginTop: 3 }}>• {w}</div>)}
            </div>
          )}
        </div>
      )}

      <div className="review-layout">
        {/* Left: extracted fields */}
        <div className="review-form">
          <div className="form-section">
            <div className="form-section-title">📋 Invoice Details</div>
            <div className="fields-grid">
              <Field label="Invoice Number" value={form.invoiceNumber} onChange={(v) => set("invoiceNumber", v)}
                warning={!form.invoiceNumber ? "Required" : form.invoiceNumber?.length > 50 ? "Too long (50 char max)" : null} />
              <Field label="PO Number" value={form.poNumber} onChange={(v) => set("poNumber", v)}
                warning={!form.poNumber ? "Optional — leave blank for non-PO invoices" : null} />
              <Field label="Invoice Date" value={form.invoiceDate} onChange={(v) => set("invoiceDate", v)}
                warning={form.invoiceDate && new Date(form.invoiceDate) > new Date() ? "Future date — ERP will reject" : null} />
              <Field label="Due Date" value={form.dueDate} onChange={(v) => set("dueDate", v)}
                warning={form.dueDate && form.invoiceDate && new Date(form.dueDate) < new Date(form.invoiceDate) ? "Before invoice date" : null} />
              <Field label="Payment Terms" value={form.paymentTerms} onChange={(v) => set("paymentTerms", v)} />
              <Field label="Currency" value={form.currency} onChange={(v) => set("currency", v)} />
            </div>
          </div>

          <div className="form-section">
            <div className="form-section-title">🏢 Vendor</div>
            <div className="fields-grid">
              <Field label="Vendor Name" value={form.vendor?.name} onChange={(v) => setVendor("name", v)}
                warning={!form.vendor?.name ? "Required" : null} />
              <Field label="Email" value={form.vendor?.email} onChange={(v) => setVendor("email", v)} />
              <Field label="Phone" value={form.vendor?.phone} onChange={(v) => setVendor("phone", v)} />
              <Field label="Address" value={form.vendor?.address} onChange={(v) => setVendor("address", v)} />
            </div>
          </div>

          <div className="form-section">
            <div className="form-section-title">📦 Line Items</div>
            <table className="line-items-table">
              <thead>
                <tr>
                  <th>Description</th>
                  <th style={{ width: 70 }}>Qty</th>
                  <th style={{ width: 110 }}>Unit Price</th>
                  <th style={{ width: 110 }}>Amount</th>
                  <th style={{ width: 30 }}></th>
                </tr>
              </thead>
              <tbody>
                {(form.lineItems || []).map((item, i) => (
                  <tr key={i}>
                    <td>
                      <input
                        style={{ width: "100%", border: "1px solid #e5e7eb", borderRadius: 6, padding: "6px 8px", fontSize: 13, fontFamily: "inherit" }}
                        value={item.description || ""}
                        onChange={(e) => {
                          const newItems = [...form.lineItems];
                          newItems[i] = { ...newItems[i], description: e.target.value };
                          set("lineItems", newItems);
                        }}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        style={{ width: "100%", border: "1px solid #e5e7eb", borderRadius: 6, padding: "6px 8px", fontSize: 13, fontFamily: "inherit" }}
                        value={item.quantity || 0}
                        onChange={(e) => {
                          const qty = parseFloat(e.target.value) || 0;
                          const newItems = [...form.lineItems];
                          newItems[i] = { ...newItems[i], quantity: qty, amount: qty * (newItems[i].unitPrice || 0) };
                          set("lineItems", newItems);
                        }}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        style={{ width: "100%", border: "1px solid #e5e7eb", borderRadius: 6, padding: "6px 8px", fontSize: 13, fontFamily: "inherit" }}
                        value={item.unitPrice || 0}
                        onChange={(e) => {
                          const price = parseFloat(e.target.value) || 0;
                          const newItems = [...form.lineItems];
                          newItems[i] = { ...newItems[i], unitPrice: price, amount: (newItems[i].quantity || 0) * price };
                          set("lineItems", newItems);
                        }}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        style={{ width: "100%", border: "1px solid #e5e7eb", borderRadius: 6, padding: "6px 8px", fontSize: 13, fontFamily: "inherit", fontWeight: 600 }}
                        value={item.amount || 0}
                        onChange={(e) => {
                          const newItems = [...form.lineItems];
                          newItems[i] = { ...newItems[i], amount: parseFloat(e.target.value) || 0 };
                          set("lineItems", newItems);
                        }}
                      />
                    </td>
                    <td>
                      <button
                        onClick={() => {
                          const newItems = form.lineItems.filter((_, idx) => idx !== i);
                          set("lineItems", newItems);
                        }}
                        style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: 16 }}
                        title="Remove line"
                      >×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              onClick={() => {
                const newItems = [...(form.lineItems || []), { description: "", quantity: 1, unitPrice: 0, amount: 0 }];
                set("lineItems", newItems);
              }}
              style={{ marginTop: 10, background: "none", border: "1px dashed #9ca3af", color: "#6b7280", padding: "8px 16px", borderRadius: 8, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}
            >+ Add Line Item</button>
            <div className="totals">
              <div className="total-row">
                <span>Subtotal</span>
                <span>
                  <input
                    type="number"
                    step="0.01"
                    style={{ width: 120, border: "1px solid #e5e7eb", borderRadius: 6, padding: "6px 8px", fontSize: 13, textAlign: "right", fontFamily: "inherit" }}
                    value={form.subtotal || 0}
                    onChange={(e) => set("subtotal", parseFloat(e.target.value) || 0)}
                  />
                </span>
              </div>
              <div className="total-row">
                <span>Tax</span>
                <span>
                  <input
                    type="number"
                    step="0.01"
                    style={{ width: 120, border: "1px solid #e5e7eb", borderRadius: 6, padding: "6px 8px", fontSize: 13, textAlign: "right", fontFamily: "inherit" }}
                    value={form.tax || 0}
                    onChange={(e) => set("tax", parseFloat(e.target.value) || 0)}
                  />
                </span>
              </div>
              <div className="total-row total-grand">
                <span>Total</span>
                <span>
                  <input
                    type="number"
                    step="0.01"
                    style={{ width: 120, border: "1px solid #e5e7eb", borderRadius: 6, padding: "6px 8px", fontSize: 14, textAlign: "right", fontWeight: 700, fontFamily: "inherit" }}
                    value={form.total || 0}
                    onChange={(e) => set("total", parseFloat(e.target.value) || 0)}
                  />
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: document preview */}
        {filePreview && (
          <div className="review-preview">
            <div className="preview-label">Original Document</div>
            <img src={filePreview} alt="Invoice" className="preview-img" />
          </div>
        )}
      </div>

      <div className="review-actions">
        <button className="btn-back" onClick={onBack}>← Upload Different File</button>
        <button
          className="btn-approve"
          onClick={handlePushClick}
          style={hasLocalErrors ? { opacity: 0.6, cursor: "not-allowed" } : {}}
          title={hasLocalErrors ? "Fix errors before pushing" : ""}
        >
          {hasLocalErrors ? "⚠ Fix Errors First" : "Approve & Push to ERP →"}
        </button>
      </div>

      {/* VALIDATION MODAL */}
      {showModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
          onClick={(e) => e.target === e.currentTarget && setShowModal(false)}>
          <div style={{ background: "white", borderRadius: 20, padding: 32, maxWidth: 520, width: "100%", fontFamily: "DM Sans, sans-serif" }}>

            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 800, fontSize: 18, color: "#0a0f1e" }}>
                Pre-push Validation
              </div>
              <button onClick={() => setShowModal(false)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#9ca3af" }}>×</button>
            </div>

            {/* Oracle validating spinner */}
            {oracleValidating && (
              <div style={{ textAlign: "center", padding: "20px 0", color: "#6b7280", fontSize: 14 }}>
                <div style={{ fontSize: 24, marginBottom: 8 }}>🔍</div>
                Checking against your ERP...
              </div>
            )}

            {/* Results */}
            {!oracleValidating && (
              <>
                {/* Errors */}
                {allErrors.length > 0 && (
                  <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12, padding: "16px 18px", marginBottom: 12 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "#dc2626", marginBottom: 8 }}>🔴 Must fix before pushing</div>
                    {allErrors.map((e, i) => (
                      <div key={i} style={{ fontSize: 13, color: "#dc2626", marginTop: 5, display: "flex", gap: 6 }}>
                        <span>•</span><span>{e}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Warnings */}
                {allWarnings.length > 0 && (
                  <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 12, padding: "16px 18px", marginBottom: 12 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "#d97706", marginBottom: 8 }}>⚠️ Warnings — review before pushing</div>
                    {allWarnings.map((w, i) => (
                      <div key={i} style={{ fontSize: 13, color: "#92400e", marginTop: 5, display: "flex", gap: 6 }}>
                        <span>•</span><span>{w}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* All clear */}
                {allErrors.length === 0 && allWarnings.length === 0 && (
                  <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 12, padding: "16px 18px", marginBottom: 12 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "#16a34a", marginBottom: 4 }}>✅ All checks passed</div>
                    <div style={{ fontSize: 13, color: "#15803d" }}>Invoice is ready to push to ERP.</div>
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                  <button onClick={() => setShowModal(false)}
                    style={{ flex: 1, background: "none", border: "1px solid #e5e7eb", color: "#6b7280", padding: "12px", borderRadius: 10, fontSize: 14, cursor: "pointer", fontFamily: "DM Sans, sans-serif" }}>
                    {allErrors.length > 0 ? "Go Back & Fix" : "Cancel"}
                  </button>
                  {allErrors.length === 0 && (
                    <button onClick={() => { setShowModal(false); onApprove(form, pdfBase64, pdfFilename); }}
                      style={{ flex: 2, background: "#0a3d2f", color: "white", border: "none", padding: "12px", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "DM Sans, sans-serif" }}>
                      {allWarnings.length > 0 ? "Push Anyway →" : "Confirm & Push to ERP →"}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
