export default function Success({ result, data, onReset }) {
  return (
    <div className="success-page">
      <div className="success-card">
        <div className="success-icon">✅</div>
        <h2>Pushed to ERP Successfully</h2>
        <p>Invoice has been processed and sent to your ERP system.</p>

        <div className="success-details">
          <div className="success-row">
            <span className="success-label">ERP Reference</span>
            <span className="success-val">{result?.erpReference}</span>
          </div>
          <div className="success-row">
            <span className="success-label">Invoice Number</span>
            <span className="success-val">{data?.invoiceNumber || "N/A"}</span>
          </div>
          <div className="success-row">
            <span className="success-label">Vendor</span>
            <span className="success-val">{data?.vendor?.name || "N/A"}</span>
          </div>
          <div className="success-row">
            <span className="success-label">Total Amount</span>
            <span className="success-val success-amount">${Number(data?.total || 0).toFixed(2)}</span>
          </div>
          <div className="success-row">
            <span className="success-label">Processed At</span>
            <span className="success-val">{new Date(result?.timestamp).toLocaleString()}</span>
          </div>
        </div>

        <button className="btn-approve" onClick={onReset}>Process Another Invoice →</button>
      </div>
    </div>
  );
}
