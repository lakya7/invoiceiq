// operationsAgent.js — Billtiq Operations module (3 on-demand agents)
//
//   exception_triage   — prioritizes invoices with match exceptions / anomalies
//   vendor_status      — flags vendors not yet resolved to an ERP supplier
//   po_acknowledgment  — tracks invoices with a PO that need supplier acknowledgment
//
// Each run() builds/refreshes rows in the operations_tasks table (see
// supabase/migrations/0002_operations_tasks.sql). Reuses existing agents rather
// than re-implementing logic:
//   - runAnomalyAgent (anomalyAgent.js) for triage risk scoring
//   - vendor_mappings (maintained by vendorMatcher.js) for vendor resolution state
//   - notifySupplier (supplierAgent.js) for the PO-ack email
//
// On-demand only — no scheduler. Triggered from the Operations screen.

const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const { runAnomalyAgent } = require("./anomalyAgent");
const { notifySupplier } = require("./supplierAgent");

const VALID_TYPES = ["exception_triage", "vendor_status", "po_acknowledgment"];

// ── HELPERS ──────────────────────────────────────────────────────
function poNumberOf(inv) {
  const rd = inv.raw_data || {};
  return rd.poNumber || rd.po_number || rd.purchaseOrder || null;
}

function isException(inv) {
  const badMatch = ["unmatched", "mismatch", "partial"].includes(inv.match_status);
  const hasAnomalies = Array.isArray(inv.anomalies) && inv.anomalies.length > 0;
  return badMatch || hasAnomalies;
}

// Insert only tasks whose stable key isn't already present (open or otherwise)
// for this team+type — keeps run() idempotent without a DB unique constraint.
// Sets BOTH user_id and team_id per the invoices-table convention.
async function upsertTasks(teamId, userId, type, candidates) {
  const { data: existing, error } = await supabase
    .from("operations_tasks")
    .select("payload")
    .eq("team_id", teamId)
    .eq("type", type);
  if (error) throw error;

  const existingKeys = new Set((existing || []).map(t => t.payload?.key).filter(Boolean));
  const toInsert = candidates
    .filter(c => !existingKeys.has(c.key))
    .map(c => ({
      team_id: teamId,
      user_id: userId,
      type,
      status: "open",
      payload: { ...c.payload, key: c.key, source: "auto" },
      related_invoice_id: c.related_invoice_id || null,
    }));

  if (toInsert.length) {
    const { error: insErr } = await supabase.from("operations_tasks").insert(toInsert);
    if (insErr) throw insErr;
  }
  return toInsert.length;
}

// ── AGENT 1: AP EXCEPTION TRIAGE ─────────────────────────────────
async function runExceptionTriage({ teamId, userId }) {
  const { data: invoices, error } = await supabase
    .from("invoices")
    .select("id, invoice_number, vendor_name, total, invoice_date, match_status, anomalies, status, payment_status, raw_data, created_at")
    .eq("team_id", teamId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;

  const exceptions = (invoices || []).filter(isException);
  const candidates = [];

  for (const inv of exceptions) {
    // Reuse the anomaly agent (pure DB heuristics, no external calls) for risk scoring.
    const risk = await runAnomalyAgent({
      invoiceData: {
        id: inv.id,
        total: inv.total,
        invoiceNumber: inv.invoice_number,
        invoiceDate: inv.invoice_date,
        vendor: { name: inv.vendor_name },
      },
      teamId,
      userId,
    });

    candidates.push({
      key: `exc:${inv.id}`,
      related_invoice_id: inv.id,
      payload: {
        invoice_number: inv.invoice_number,
        vendor_name: inv.vendor_name,
        total: inv.total,
        match_status: inv.match_status || null,
        risk_level: risk.riskLevel,
        risk_score: risk.riskScore,
        anomalies: risk.anomalies,
        summary: risk.summary,
      },
    });
  }

  const created = await upsertTasks(teamId, userId, "exception_triage", candidates);
  console.log(`[operations] exception_triage team=${teamId} scanned=${invoices?.length || 0} exceptions=${exceptions.length} created=${created}`);
  return { scanned: invoices?.length || 0, exceptions: exceptions.length, created };
}

// ── AGENT 2: VENDOR STATUS ───────────────────────────────────────
async function runVendorStatus({ teamId, userId }) {
  const { data: invoices, error } = await supabase
    .from("invoices")
    .select("vendor_name, total, raw_data, created_at")
    .eq("team_id", teamId)
    .not("vendor_name", "is", null)
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw error;

  // Aggregate distinct vendors from invoice history.
  const byVendor = new Map();
  for (const inv of invoices || []) {
    const name = (inv.vendor_name || "").trim();
    if (!name) continue;
    const e = byVendor.get(name) || { name, count: 0, total: 0, email: null };
    e.count += 1;
    e.total += Number(inv.total || 0);
    if (!e.email) e.email = inv.raw_data?.vendor?.email || inv.raw_data?.vendor_email || null;
    byVendor.set(name, e);
  }

  // Resolution state lives in vendor_mappings (maintained by vendorMatcher.js).
  const { data: mappings } = await supabase
    .from("vendor_mappings")
    .select("invoice_vendor_name, oracle_supplier_id, oracle_supplier_name")
    .eq("team_id", teamId);
  const mapped = new Map((mappings || []).map(m => [(m.invoice_vendor_name || "").trim().toLowerCase(), m]));

  const candidates = [];
  let matched = 0;
  for (const v of byVendor.values()) {
    const m = mapped.get(v.name.toLowerCase());
    if (m) { matched += 1; continue; } // resolved — nothing to action
    candidates.push({
      key: `vendor:${v.name.toLowerCase()}`,
      related_invoice_id: null,
      payload: {
        vendor_name: v.name,
        invoice_count: v.count,
        total_billed: v.total,
        vendor_email: v.email,
        match_status: "needs_review",
      },
    });
  }

  const created = await upsertTasks(teamId, userId, "vendor_status", candidates);
  console.log(`[operations] vendor_status team=${teamId} vendors=${byVendor.size} matched=${matched} needs_review=${candidates.length} created=${created}`);
  return { vendors: byVendor.size, matched, needs_review: candidates.length, created };
}

// ── AGENT 3: PO ACKNOWLEDGMENT ───────────────────────────────────
async function runPoAcknowledgment({ teamId, userId }) {
  const { data: invoices, error } = await supabase
    .from("invoices")
    .select("id, invoice_number, vendor_name, total, raw_data, status, match_status, created_at")
    .eq("team_id", teamId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;

  const withPo = (invoices || []).filter(inv => poNumberOf(inv));
  const candidates = withPo.map(inv => ({
    key: `po:${inv.id}`,
    related_invoice_id: inv.id,
    payload: {
      invoice_number: inv.invoice_number,
      vendor_name: inv.vendor_name,
      total: inv.total,
      po_number: poNumberOf(inv),
      supplier_email: inv.raw_data?.vendor?.email || inv.raw_data?.vendor_email || null,
      ack_status: "pending",
    },
  }));

  const created = await upsertTasks(teamId, userId, "po_acknowledgment", candidates);
  console.log(`[operations] po_acknowledgment team=${teamId} with_po=${withPo.length} created=${created}`);
  return { with_po: withPo.length, created };
}

// ── SEND PO ACKNOWLEDGMENT EMAIL (explicit action) ───────────────
// Outward-facing — only fired when the user clicks "Send" on a PO-ack task.
// Reuses supplierAgent.notifySupplier (Claude copy + branded HTML + dedupe).
async function sendPoAcknowledgment({ taskId, teamId, sendEmail, teamName }) {
  const { data: task } = await supabase
    .from("operations_tasks")
    .select("*")
    .eq("id", taskId)
    .eq("team_id", teamId)
    .eq("type", "po_acknowledgment")
    .single();
  if (!task) return { sent: false, reason: "Task not found" };

  let invoice = null;
  if (task.related_invoice_id) {
    const { data } = await supabase.from("invoices").select("*").eq("id", task.related_invoice_id).single();
    invoice = data;
  }
  // Fall back to the task payload if the invoice row is gone.
  if (!invoice) {
    invoice = {
      id: task.related_invoice_id,
      team_id: teamId,
      invoice_number: task.payload?.invoice_number,
      vendor_name: task.payload?.vendor_name,
      total: task.payload?.total,
      raw_data: { vendor: { email: task.payload?.supplier_email } },
    };
  }
  invoice.po_number = task.payload?.po_number || invoice.po_number;

  const result = await notifySupplier({
    invoice,
    issueType: "po_acknowledgment",
    anomalyFlags: [],
    sendEmail,
    teamName,
    replyEmail: null,
  });

  if (result.sent) {
    await supabase
      .from("operations_tasks")
      .update({
        status: "in_progress",
        payload: { ...task.payload, ack_status: "sent", ack_sent_at: new Date().toISOString() },
        updated_at: new Date().toISOString(),
      })
      .eq("id", taskId)
      .eq("team_id", teamId);
  }
  return result;
}

// ── LIST / UPDATE ────────────────────────────────────────────────
async function listOperationsTasks({ teamId, type }) {
  let q = supabase.from("operations_tasks").select("*").eq("team_id", teamId);
  if (type && VALID_TYPES.includes(type)) q = q.eq("type", type);
  const { data, error } = await q.order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

async function updateOperationsTask({ taskId, teamId, status }) {
  const allowed = ["open", "in_progress", "resolved", "dismissed"];
  if (!allowed.includes(status)) return { error: "Invalid status" };
  const { data, error } = await supabase
    .from("operations_tasks")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", taskId)
    .eq("team_id", teamId)
    .select()
    .single();
  if (error) throw error;
  return { task: data };
}

module.exports = {
  runExceptionTriage,
  runVendorStatus,
  runPoAcknowledgment,
  sendPoAcknowledgment,
  listOperationsTasks,
  updateOperationsTask,
  VALID_TYPES,
};
