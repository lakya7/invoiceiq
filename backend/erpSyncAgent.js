// erpSyncAgent.js — APFlow ERP Sync Agent
// Checks Oracle Fusion and QuickBooks hourly for payment status updates

const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// ── ORACLE FUSION SYNC ───────────────────────────────────────────
async function syncOraclePayments({ teamId, connection }) {
  const results = { updated: 0, errors: 0, details: [] };

  try {
    const { baseUrl, username, password } = connection;
    const auth = Buffer.from(`${username}:${password}`).toString("base64");

    // Get all pushed invoices for this team with Oracle ERP refs
    const { data: invoices } = await supabase
      .from("invoices")
      .select("id, invoice_number, erp_reference, status, total")
      .eq("team_id", teamId)
      .eq("status", "pushed")
      .like("erp_reference", "ERP-%");

    if (!invoices?.length) {
      console.log("Oracle Sync: No pushed invoices to check");
      return results;
    }

    for (const invoice of invoices) {
      try {
        // Query Oracle Fusion Payables REST API for invoice status
        const oracleRes = await fetch(
          `${baseUrl}/fscmRestApi/resources/11.13.18.05/invoices?q=InvoiceNumber=${encodeURIComponent(invoice.invoice_number)}`,
          {
            headers: {
              "Authorization": `Basic ${auth}`,
              "Content-Type": "application/json",
              "Accept": "application/json",
            },
          }
        );

        if (!oracleRes.ok) {
          console.error(`Oracle API error for invoice ${invoice.invoice_number}: ${oracleRes.status}`);
          results.errors++;
          continue;
        }

        const oracleData = await oracleRes.json();
        const oracleInvoice = oracleData?.items?.[0];
        if (!oracleInvoice) continue;

        // Map Oracle status to APFlow status
        const oracleStatus = oracleInvoice.InvoiceStatus || "";
        let newStatus = null;
        let paymentDate = null;

        if (oracleStatus === "PAID" || oracleStatus === "CANCELLED") {
          newStatus = oracleStatus === "PAID" ? "paid" : "cancelled";
          paymentDate = oracleInvoice.PaymentDate || null;
        } else if (oracleStatus === "VALIDATED") {
          newStatus = "validated";
        } else if (oracleStatus === "NEEDS_REVALIDATION" || oracleStatus === "REJECTED") {
          newStatus = "rejected";
        }

        if (newStatus && newStatus !== invoice.status) {
          await supabase.from("invoices").update({
            status: newStatus,
            payment_date: paymentDate,
            erp_sync_at: new Date().toISOString(),
            agent_reason: `ERP Sync: Oracle status updated to ${oracleStatus}`,
          }).eq("id", invoice.id);

          results.updated++;
          results.details.push({
            invoiceNumber: invoice.invoice_number,
            oldStatus: invoice.status,
            newStatus,
            paymentDate,
            erp: "oracle",
          });
          console.log(`Oracle Sync: Invoice #${invoice.invoice_number} → ${newStatus}`);
        }
      } catch (e) {
        console.error(`Oracle sync error for ${invoice.invoice_number}:`, e.message);
        results.errors++;
      }
    }

    return results;
  } catch (err) {
    console.error("Oracle sync error:", err.message);
    return { ...results, error: err.message };
  }
}

// ── QUICKBOOKS SYNC ──────────────────────────────────────────────
async function syncQuickBooksPayments({ teamId, connection }) {
  const results = { updated: 0, errors: 0, details: [] };

  try {
    const { accessToken, realmId } = connection;

    // Get all pushed invoices for this team with QB ERP refs
    const { data: invoices } = await supabase
      .from("invoices")
      .select("id, invoice_number, erp_reference, status, total, vendor_name")
      .eq("team_id", teamId)
      .eq("status", "pushed")
      .like("erp_reference", "QB-%");

    if (!invoices?.length) {
      console.log("QuickBooks Sync: No pushed invoices to check");
      return results;
    }

    for (const invoice of invoices) {
      try {
        // Extract QB bill ID from erp_reference (format: QB-{billId})
        const billId = invoice.erp_reference?.replace("QB-", "");
        if (!billId) continue;

        // Query QuickBooks Bill endpoint
        const qbRes = await fetch(
          `https://quickbooks.api.intuit.com/v3/company/${realmId}/bill/${billId}`,
          {
            headers: {
              "Authorization": `Bearer ${accessToken}`,
              "Accept": "application/json",
            },
          }
        );

        if (!qbRes.ok) {
          console.error(`QB API error for invoice ${invoice.invoice_number}: ${qbRes.status}`);
          results.errors++;
          continue;
        }

        const qbData = await qbRes.json();
        const bill = qbData?.Bill;
        if (!bill) continue;

        // Map QB balance to payment status
        const balance = bill.Balance || 0;
        const totalAmt = bill.TotalAmt || invoice.total || 0;

        let newStatus = null;
        if (balance === 0 && totalAmt > 0) {
          newStatus = "paid";
        } else if (balance < totalAmt && balance > 0) {
          newStatus = "partial_payment";
        }

        if (newStatus && newStatus !== invoice.status) {
          await supabase.from("invoices").update({
            status: newStatus,
            erp_sync_at: new Date().toISOString(),
            agent_reason: `ERP Sync: QuickBooks balance updated — $${balance} remaining`,
          }).eq("id", invoice.id);

          results.updated++;
          results.details.push({
            invoiceNumber: invoice.invoice_number,
            oldStatus: invoice.status,
            newStatus,
            remainingBalance: balance,
            erp: "quickbooks",
          });
          console.log(`QuickBooks Sync: Invoice #${invoice.invoice_number} → ${newStatus} (balance: $${balance})`);
        }
      } catch (e) {
        console.error(`QB sync error for ${invoice.invoice_number}:`, e.message);
        results.errors++;
      }
    }

    return results;
  } catch (err) {
    console.error("QuickBooks sync error:", err.message);
    return { ...results, error: err.message };
  }
}

// ── MAIN: RUN ERP SYNC FOR A TEAM ───────────────────────────────
async function runErpSync({ teamId }) {
  console.log(`ERP Sync Agent: Starting sync for team ${teamId}`);
  const allResults = { oracle: null, quickbooks: null, totalUpdated: 0 };

  try {
    // Get ERP connections for this team
    const { data: connections } = await supabase
      .from("erp_connections")
      .select("*")
      .eq("team_id", teamId)
      .eq("status", "connected");

    if (!connections?.length) {
      console.log("ERP Sync: No connected ERPs for team");
      return allResults;
    }

    for (const conn of connections) {
      if (conn.erp_type === "oracle" && conn.credentials) {
        console.log("ERP Sync: Syncing Oracle Fusion...");
        const result = await syncOraclePayments({
          teamId,
          connection: conn.credentials,
        });
        allResults.oracle = result;
        allResults.totalUpdated += result.updated || 0;
      }

      if (conn.erp_type === "quickbooks" && conn.credentials) {
        console.log("ERP Sync: Syncing QuickBooks...");
        const result = await syncQuickBooksPayments({
          teamId,
          connection: conn.credentials,
        });
        allResults.quickbooks = result;
        allResults.totalUpdated += result.updated || 0;
      }
    }

    // Log sync run
    await supabase.from("usage_events").insert({
      team_id: teamId,
      event_type: "erp_sync",
      metadata: { totalUpdated: allResults.totalUpdated, timestamp: new Date().toISOString() },
    });

    console.log(`ERP Sync Agent: Done — ${allResults.totalUpdated} invoices updated`);
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
      // Get all teams with connected ERPs
      const { data: connections } = await supabase
        .from("erp_connections")
        .select("team_id")
        .eq("status", "connected");

      const teamIds = [...new Set((connections || []).map(c => c.team_id))];
      console.log(`ERP Sync: Running for ${teamIds.length} teams`);

      for (const teamId of teamIds) {
        await runErpSync({ teamId });
      }
    } catch (err) {
      console.error("ERP Sync scheduler error:", err.message);
    }
  };

  // Run immediately on start, then every 60 minutes
  await runForAllTeams();
  setInterval(runForAllTeams, 60 * 60 * 1000);
}

module.exports = { runErpSync, startErpSyncScheduler };
