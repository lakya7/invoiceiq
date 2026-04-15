const MATCH_COLORS = { matched:"#16a34a", partial:"#92400e", mismatch:"#dc2626", unmatched:"#6b7280", no_po:"#6b7280" };
const MATCH_BG = { matched:"#dcfce7", partial:"#fef9c3", mismatch:"#fee2e2", unmatched:"#f3f4f6", no_po:"#f3f4f6" };
const MATCH_LABEL = { matched:"✅ PO Matched", partial:"⚠️ Partial Match", mismatch:"🔴 PO Mismatch", unmatched:"➖ No PO Match", no_po:"➖ No POs on File" };

const VALIDATION_STATUS = {
  needs_validation: { bg:"#fef9c3", color:"#92400e", icon:"⏳", label:"Needs Validation", desc:"Invoice submitted to ERP. Awaiting Oracle validation before posting." },
  validated:        { bg:"#dcfce7", color:"#16a34a", icon:"✅", label:"Validated",         desc:"Oracle validated the invoice. Ready for payment processing." },
  validation_error: { bg:"#fee2e2", color:"#dc2626", icon:"🔴", label:"Validation Error",  desc:"Oracle found issues. Check ERP for details." },
  mock:             { bg:"#dbeafe", color:"#1d4ed8", icon:"🔵", label:"Mock ERP",           desc:"No real ERP connected. Data saved to APFlow database only." },
};

export default function Success({ result, data, matchResult, onReset }) {
  const matchStatus = matchResult?.matchStatus || "unmatched";
  const erpType = result?.erpType || "mock";
  const validationStatus = result?.validationStatus || (erpType === "mock" ? "mock" : "needs_validation");
  const vs = VALIDATION_STATUS[validationStatus] || VALIDATION_STATUS.mock;

  const currency = data?.currency || "USD";
  const sym = currency === "INR" ? "₹" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : "$";

  return (
    <div className="success-page">
      <div className="success-card" style={{ maxWidth:580 }}>
        <div className="success-icon">✅</div>
        <h2>Pushed to ERP Successfully</h2>
        <p>Invoice processed and synced to your ERP system.</p>

        {/* Validation Status */}
        <div style={{ background:vs.bg, border:`1px solid ${vs.color}30`, borderRadius:10, padding:"14px 16px", marginBottom:16, textAlign:"left" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
            <span style={{ fontSize:16 }}>{vs.icon}</span>
            <span style={{ fontWeight:700, color:vs.color, fontSize:14 }}>ERP Validation: {vs.label}</span>
            <span style={{ marginLeft:"auto", fontSize:11, color:"#888", background:"rgba(0,0,0,0.06)", padding:"2px 8px", borderRadius:10 }}>
              {erpType === "oracle" ? "Oracle Fusion" : erpType === "quickbooks" ? "QuickBooks" : "Mock ERP"}
            </span>
          </div>
          <div style={{ fontSize:13, color:"#555", lineHeight:1.5 }}>{vs.desc}</div>
          {validationStatus === "needs_validation" && (
            <div style={{ marginTop:8, fontSize:12, color:"#92400e" }}>
              💡 In Oracle: Go to <strong>Payables → Invoices → Validate</strong> to complete validation
            </div>
          )}
          {validationStatus === "mock" && (
            <div style={{ marginTop:8, fontSize:12, color:"#1d4ed8" }}>
              💡 Connect QuickBooks or Oracle Fusion in <strong>ERP Connections</strong> for real sync
            </div>
          )}
        </div>

        {/* PO Match result */}
        {matchResult && (
          <div style={{ background:MATCH_BG[matchStatus], border:`1px solid ${MATCH_COLORS[matchStatus]}30`, borderRadius:10, padding:"14px 16px", marginBottom:16, textAlign:"left" }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
              <span style={{ fontWeight:700, color:MATCH_COLORS[matchStatus], fontSize:14 }}>{MATCH_LABEL[matchStatus]}</span>
              {matchResult.confidenceScore && <span style={{ fontSize:11, color:"#888", marginLeft:"auto" }}>{Math.round(matchResult.confidenceScore*100)}% confidence</span>}
            </div>
            <div style={{ fontSize:13, color:"#555", lineHeight:1.5 }}>{matchResult.summary}</div>
            {matchResult.variances?.length > 0 && (
              <div style={{ marginTop:10, display:"flex", flexDirection:"column", gap:4 }}>
                {matchResult.variances.map((v,i) => (
                  <div key={i} style={{ fontSize:12, color:"#666", display:"flex", gap:6 }}>
                    <span style={{ color: v.severity==="high"?"#dc2626":v.severity==="medium"?"#92400e":"#555", fontWeight:600 }}>•</span>
                    <span><strong>{v.field}:</strong> Invoice {v.invoiceValue} vs PO {v.poValue}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="success-details">
          {[
            ["ERP Reference", result?.erpReference],
            ["ERP Type", erpType === "oracle" ? "Oracle Fusion" : erpType === "quickbooks" ? "QuickBooks" : "Mock ERP"],
            ["Invoice #", data?.invoiceNumber||"N/A"],
            ["Vendor", data?.vendor?.name||"N/A"],
            ["Total", `${sym}${Number(data?.total||0).toFixed(2)}`],
            ["Processed At", result?.timestamp ? new Date(result.timestamp).toLocaleString() : "—"],
          ].map(([l,v]) => (
            <div key={l} className="success-row">
              <span className="success-label">{l}</span>
              <span className="success-val" style={l==="Total"?{color:"var(--accent)",fontSize:17,fontWeight:700}:{}}>{v}</span>
            </div>
          ))}
        </div>
        <button className="btn-approve" onClick={onReset}>Process Another Invoice →</button>
      </div>
    </div>
  );
}
