import { useState } from "react";

function Field({ label, value, onChange }) {
  return (
    <div className="field">
      <label className="field-label">{label}</label>
      <input
        className="field-input"
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export default function Review({ data, filePreview, onApprove, onBack }) {
  const [form, setForm] = useState(data || {});

  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }));
  const setVendor = (key, val) => setForm((f) => ({ ...f, vendor: { ...f.vendor, [key]: val } }));

  const confidence = Math.round((form.confidence || 0.9) * 100);
  const currency = form.currency || "USD";
  const sym = currency === "INR" ? "₹" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : "$";

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

      <div className="review-layout">
        {/* Left: extracted fields */}
        <div className="review-form">
          <div className="form-section">
            <div className="form-section-title">📋 Invoice Details</div>
            <div className="fields-grid">
              <Field label="Invoice Number" value={form.invoiceNumber} onChange={(v) => set("invoiceNumber", v)} />
              <Field label="PO Number" value={form.poNumber} onChange={(v) => set("poNumber", v)} />
              <Field label="Invoice Date" value={form.invoiceDate} onChange={(v) => set("invoiceDate", v)} />
              <Field label="Due Date" value={form.dueDate} onChange={(v) => set("dueDate", v)} />
              <Field label="Payment Terms" value={form.paymentTerms} onChange={(v) => set("paymentTerms", v)} />
              <Field label="Currency" value={form.currency} onChange={(v) => set("currency", v)} />
            </div>
          </div>

          <div className="form-section">
            <div className="form-section-title">🏢 Vendor</div>
            <div className="fields-grid">
              <Field label="Vendor Name" value={form.vendor?.name} onChange={(v) => setVendor("name", v)} />
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
                  <th>Qty</th>
                  <th>Unit Price</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {(form.lineItems || []).map((item, i) => (
                  <tr key={i}>
                    <td>{item.description}</td>
                    <td>{item.quantity}</td>
                    <td>{sym}{Number(item.unitPrice || 0).toFixed(2)}</td>
                    <td>{sym}{Number(item.amount || 0).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="totals">
              <div className="total-row"><span>Subtotal</span><span>{sym}{Number(form.subtotal || 0).toFixed(2)}</span></div>
              <div className="total-row"><span>Tax</span><span>{sym}{Number(form.tax || 0).toFixed(2)}</span></div>
              <div className="total-row total-grand"><span>Total</span><span>{sym}{Number(form.total || 0).toFixed(2)}</span></div>
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
        <button className="btn-approve" onClick={() => onApprove(form)}>
          Approve & Push to ERP →
        </button>
      </div>
    </div>
  );
}
