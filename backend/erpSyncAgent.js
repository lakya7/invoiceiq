// erpSyncAgent.js — Billtiq ERP Sync Agent
// Checks Oracle Fusion (and later QuickBooks) hourly for payment / status updates,
// then syncs back to Billtiq's invoices table so the UI reflects real ERP state.
//
// Bug-fix history (May 16 2026):
//   1. OLD filter `.like(erp_reference, "ERP-%")` skipped all real Oracle invoices
//      (which use "ORA-..." prefix). Now matches by erp_type via erp_connections.
//   2. OLD code read `conn.credentials` which doesn't exist on the schema.
//      Now reads conn.base_url / conn.username / conn.password directly.
//   3. OLD field name `oracleInvoice.InvoiceStatus` doesn't exist in Oracle's response.
//      Now uses the real fields: ValidationStatus, PaidStatus, CanceledFlag.
//   4. OLD status values like "PAID" / "VALIDATED" don't match Oracle's "Paid" / "Validated".
//      Now compares against the real values seen in production.
//   5. OLD looked up Oracle invoices by InvoiceNumber (collides on duplicate pushes).
//      Now looks up by InvoiceId — extracted from erp_reference ("ORA-300000324579131").
//   6. OLD wrote to `erp_sync_at` column which doesn't exist. Use `last_synced_at`
//      to match what the manual mark-paid endpoint writes.

const axios = require("axios");
const qb = require("./quickbooks");
const { createClient } = require("@supabase/supabase-js");
const { decrypt } = require("./lib/crypto");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// ── ORACLE FUSION SYNC ───────────────────────────────────────────
async function syncOraclePayments({ teamId, connection }) {
  const results = { updated: 0, errors: 0, checked: 0, details: [] };

  try {
    const { base_url: baseUrl, username } = connection;
    // Password is stored encrypted (v1:...) since May 2026; decrypt() passes
    // through legacy plaintext unchanged. Mirrors oracle.js getOracleToken().
    const password = decrypt(connection.password);
    if (!baseUrl || !username || !password) {
      console.warn(`Oracle Sync: missing connection fields for team ${teamId}, skipping`);
      return results;
    }
    const auth = Buffer.from(`${username}:${password}`).toString("base64");

    // Get all invoices for this team that have been pushed to Oracle.
    // We look for ones still in non-terminal states — no point re-querying invoices
    // that are already marked paid/cancelled.
    const { data: invoices, error } = await supabase
      .from("invoices")
      .select("id, invoice_number, erp_reference, status, payment_status, total")
      .eq("team_id", teamId)
      .like("erp_reference", "ORA-%")
      .not("payment_status", "in", "(paid,cancelled)");

    if (error) {
      console.error("Oracle Sync: Supabase query failed:", error.message);
      return { ...results, error: error.message };
    }

    if (!invoices?.length) {
      console.log(`Oracle Sync: No invoices to check for team ${teamId}`);
      return results;
    }

    console.log(`Oracle Sync: Checking ${invoices.length} invoice(s) for team ${teamId}`);
    results.checked = invoices.length;

    for (const invoice of invoices) {
      try {
        // Extract Oracle InvoiceId from erp_reference (format: "ORA-300000324579131")
        const invoiceId = String(invoice.erp_reference || "").replace(/^ORA-/, "");
        if (!invoiceId || !/^\d+$/.test(invoiceId)) {
          console.warn(`Oracle Sync: invalid InvoiceId in erp_reference "${invoice.erp_reference}"`);
          continue;
        }

        // Query Oracle by InvoiceId (unique). Avoids the duplicate-InvoiceNumber problem
        // that happens when the same invoice is pushed twice during testing.
        const oracleRes = await fetch(
          `${baseUrl}/fscmRestApi/resources/11.13.18.05/invoices/${invoiceId}?onlyData=true`,
          {
            headers: {
              "Authorization": `Basic ${auth}`,
              "Content-Type": "application/json",
              "Accept": "application/json",
            },
          }
        );

        if (!oracleRes.ok) {
          console.error(`Oracle Sync: API ${oracleRes.status} for InvoiceId ${invoiceId}`);
          results.errors++;
          continue;
        }

        const oracleInvoice = await oracleRes.json();

        // Map Oracle status fields to Billtiq updates.
        // Status precedence (highest wins): Cancelled > Paid > Partial > Validated > Pushed.
        const update = mapOracleToBilltiq(oracleInvoice, invoice);
        if (!update) continue; // nothing changed — skip

        const { error: updateErr } = await supabase
          .from("invoices")
          .update(update)
          .eq("id", invoice.id);

        if (updateErr) {
          console.error(`Oracle Sync: update failed for ${invoice.invoice_number}: ${updateErr.message}`);
          results.errors++;
          continue;
        }

        results.updated++;
        results.details.push({
          invoiceNumber: invoice.invoice_number,
          oldPaymentStatus: invoice.payment_status,
          newPaymentStatus: update.payment_status,
          oracleValidation: oracleInvoice.ValidationStatus,
          oraclePaid: oracleInvoice.PaidStatus,
          erp: "oracle",
        });
        console.log(`Oracle Sync: #${invoice.invoice_number} → payment_status=${update.payment_status} (Oracle: ${oracleInvoice.ValidationStatus}/${oracleInvoice.PaidStatus})`);
      } catch (e) {
        console.error(`Oracle Sync: error for ${invoice.invoice_number}:`, e.message);
        results.errors++;
      }
    }

    return results;
  } catch (err) {
    console.error("Oracle Sync: top-level error:", err.message);
    return { ...results, error: err.message };
  }
}

// ── ORACLE → BILLTIQ STATUS MAPPING ───────────────────────────────
// Returns a partial update object, or null if no change needed.
// Oracle status fields (confirmed from production curl on May 16 2026):
//   ValidationStatus: "Validated" | "Needs revalidation" | "Cannot be paid" | "Held"
//   PaidStatus:        "Not paid" | "Partial" | "Paid"
//   CanceledFlag:      true | false
//   ApprovalStatus:    "Required" | "Initiated" | "Approved" | "Rejected" | "Not required"
function mapOracleToBilltiq(oracleInvoice, billtiqInvoice) {
  const validation = oracleInvoice.ValidationStatus;
  const paid = oracleInvoice.PaidStatus;
  const cancelled = oracleInvoice.CanceledFlag === true;

  let newPaymentStatus = billtiqInvoice.payment_status || "unpaid";
  let newPaidAmount = null;
  let newPaymentDate = null;
  let agentReason = null;

  if (cancelled) {
    newPaymentStatus = "cancelled";
    agentReason = "Oracle: invoice cancelled in Payables";
  } else if (paid === "Paid") {
    newPaymentStatus = "paid";
    newPaidAmount = oracleInvoice.InvoiceAmount || billtiqInvoice.total || null;
    // Oracle doesn't return a header-level PaymentDate; the actual date lives on the
    // payment record. Use LastUpdateDate as a reasonable approximation since the
    // invoice was last touched when paid. Better than nothing for now.
    newPaymentDate = oracleInvoice.LastUpdateDate
      ? String(oracleInvoice.LastUpdateDate).slice(0, 10)
      : null;
    agentReason = "Oracle: invoice marked Paid in Payables";
  } else if (paid === "Partial") {
    newPaymentStatus = "partial";
    const unpaid = oracleInvoice.UnpaidAmount ?? 0;
    const total = oracleInvoice.InvoiceAmount ?? billtiqInvoice.total ?? 0;
    newPaidAmount = Math.max(0, total - unpaid);
    agentReason = `Oracle: partial payment, ${newPaidAmount} of ${total} paid`;
  } else if (validation === "Cannot be paid") {
    newPaymentStatus = "blocked";
    agentReason = "Oracle: invoice cannot be paid (validation failure or hold)";
  }
  // Note: "Validated" (without payment) doesn't change payment_status — invoice is
  // approved but not yet paid. That's still effectively "unpaid" from Billtiq's view.

  // Skip update if nothing changed (avoid pointless writes and last_synced_at churn).
  if (newPaymentStatus === billtiqInvoice.payment_status) {
    return null;
  }

  const update = {
    payment_status: newPaymentStatus,
    last_synced_at: new Date().toISOString(),
  };
  if (newPaidAmount !== null) update.paid_amount = newPaidAmount;
  if (newPaymentDate) update.payment_date = newPaymentDate;
  if (agentReason) update.agent_reason = agentReason;

  return update;
}

// ── QUICKBOOKS SYNC ──────────────────────────────────────────────
// Polls QBO for Bills pushed by Billtiq and updates local invoice status.
// Maps Balance===0 → paid, Balance<TotalAmt → partially_paid.
// Uses qb.refreshToken() which handles encrypted token storage transparently.
async function syncQuickBooksPayments({ teamId, connection }) {
  const result = { updated: 0, errors: 0, checked: 0, details: [] };
  if (!connection?.realm_id) {
    console.log("QB Sync: skipped — no realm_id on connection");
    return result;
  }
  const { data: invoices, error } = await supabase
    .from("invoices")
    .select("id, erp_reference, status, total, invoice_number")
    .eq("team_id", teamId)
    .like("erp_reference", "QB-%")
    .not("status", "in", "(paid,rejected_duplicate)");
  if (error) {
    console.error("QB Sync: invoices query failed:", error.message);
    return { ...result, errors: 1 };
  }
  if (!invoices?.length) {
    console.log("QB Sync: no QB invoices need status check");
    return result;
  }
  let accessToken;
  try {
    accessToken = await qb.refreshToken(teamId);
  } catch (e) {
    console.error("QB Sync: token refresh failed:", e.message);
    return { ...result, errors: invoices.length };
  }
  const realmId = connection.realm_id;
  const qbBase = process.env.QB_SANDBOX === "true"
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";
  for (const inv of invoices) {
    result.checked++;
    try {
      const billId = String(inv.erp_reference || "").replace(/^QB-/, "");
      if (!billId || !/^\d+$/.test(billId)) {
        console.warn(`QB Sync: invalid erp_reference ${inv.erp_reference} for invoice ${inv.id}`);
        continue;
      }
      const billRes = await axios.get(
        `${qbBase}/v3/company/${realmId}/bill/${billId}`,
        {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
          timeout: 8000,
        }
      );
      const bill = billRes.data?.Bill;
      if (!bill) {
        console.warn(`QB Sync: Bill ${billId} not returned`);
        continue;
      }
      const balance = Number(bill.Balance);
      const totalAmt = Number(bill.TotalAmt);
      let newStatus = inv.status;
      if (balance === 0) {
        newStatus = "paid";
      } else if (balance > 0 && balance < totalAmt) {
        newStatus = "partially_paid";
      }
      if (newStatus !== inv.status) {
        const { error: upErr } = await supabase
          .from("invoices")
          .update({ status: newStatus, last_synced_at: new Date().toISOString() })
          .eq("id", inv.id);
        if (upErr) {
          console.error(`QB Sync: failed to update invoice ${inv.id}: ${upErr.message}`);
          result.errors++;
        } else {
          result.updated++;
          result.details.push({ invoice_id: inv.id, invoice_number: inv.invoice_number, from: inv.status, to: newStatus });
          console.log(`QB Sync: invoice #${inv.invoice_number} ${inv.status} → ${newStatus}`);
        }
      }
    } catch (e) {
      console.error(`QB Sync: error checking invoice ${inv.id}: ${e.message}`);
      result.errors++;
    }
  }
  return result;
}

// ── MAIN: RUN ERP SYNC FOR A TEAM ───────────────────────────────
async function runErpSync({ teamId }) {
  console.log(`ERP Sync Agent: Starting sync for team ${teamId}`);
  const allResults = { oracle: null, quickbooks: null, totalUpdated: 0, totalChecked: 0 };

  try {
    const { data: connections, error } = await supabase
      .from("erp_connections")
      .select("erp_type, base_url, username, password, status, access_token, refresh_token, realm_id, expires_at")
      .eq("team_id", teamId)
      .eq("status", "connected");

    if (error) {
      console.error("ERP Sync: erp_connections query failed:", error.message);
      return { ...allResults, error: error.message };
    }

    if (!connections?.length) {
      console.log(`ERP Sync: No connected ERPs for team ${teamId}`);
      return allResults;
    }

    for (const conn of connections) {
      if (conn.erp_type === "oracle") {
        const result = await syncOraclePayments({ teamId, connection: conn });
        allResults.oracle = result;
        allResults.totalUpdated += result.updated || 0;
        allResults.totalChecked += result.checked || 0;
      }
      if (conn.erp_type === "quickbooks") {
        const result = await syncQuickBooksPayments({ teamId, connection: conn });
        allResults.quickbooks = result;
        allResults.totalUpdated += result.updated || 0;
        allResults.totalChecked += result.checked || 0;
      }
    }

    // Log sync run (best-effort; don't fail if usage_events doesn't exist yet)
    try {
      await supabase.from("usage_events").insert({
        team_id: teamId,
        event_type: "erp_sync",
        metadata: {
          totalUpdated: allResults.totalUpdated,
          totalChecked: allResults.totalChecked,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (_) { /* ignore */ }

    console.log(`ERP Sync Agent: Done — checked ${allResults.totalChecked}, updated ${allResults.totalUpdated}`);
    return allResults;
  } catch (err) {
    console.error("ERP Sync Agent error:", err.message);
    return { ...allResults, error: err.message };
  }
}

// ── HOURLY SCHEDULER ─────────────────────────────────────────────
async function startErpSyncScheduler() {
  console.log("ERP Sync Agent: Scheduler started (runs every 60 minutes)");

  const runForAllTeams = async () => {
    try {
      const { data: connections } = await supabase
        .from("erp_connections")
        .select("team_id")
        .eq("status", "connected");

      const teamIds = [...new Set((connections || []).map(c => c.team_id))];
      console.log(`ERP Sync: Running for ${teamIds.length} team(s)`);

      for (const teamId of teamIds) {
        await runErpSync({ teamId });
      }
    } catch (err) {
      console.error("ERP Sync scheduler error:", err.message);
    }
  };

  await runForAllTeams();
  setInterval(runForAllTeams, 60 * 60 * 1000);
}

module.exports = { runErpSync, startErpSyncScheduler };
