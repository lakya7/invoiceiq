// notificationAgent.js — APFlow Teams & Slack Notification Agent
// Notifies buyers and suppliers via Microsoft Teams and Slack webhooks

const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// ── EVENT TYPES ─────────────────────────────────────────────────
const EVENTS = {
  INVOICE_UPLOADED:        "invoice_uploaded",
  INVOICE_PROCESSED:       "invoice_processed",
  INVOICE_PO_MATCHED:      "invoice_po_matched",
  INVOICE_FLAGGED:         "invoice_flagged",
  INVOICE_NEEDS_APPROVAL:  "invoice_needs_approval",
  PAYMENT_CONFIRMED:       "payment_confirmed",
};

// ── FORMAT CURRENCY ─────────────────────────────────────────────
function formatAmount(amount, currency = "USD") {
  const sym = currency === "INR" ? "₹" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : "$";
  return `${sym}${Number(amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
}

// ── SEND SLACK NOTIFICATION ──────────────────────────────────────
async function sendSlackNotification({ webhookUrl, event, invoice, recipient }) {
  if (!webhookUrl) return;

  const { emoji, title, color, fields } = buildMessageContent({ event, invoice, recipient });

  const needsApproval = event === EVENTS.INVOICE_FLAGGED || invoice.status === "pending";
  const backendUrl = process.env.BACKEND_URL || "https://invoiceiq-backend-w42q.onrender.com";

  const actionButtons = needsApproval && invoice.id ? [
    {
      type: "button",
      text: { type: "plain_text", text: "✓ Approve" },
      style: "primary",
      action_id: "approve_invoice",
      value: JSON.stringify({ invoiceId: invoice.id, teamId: invoice.team_id }),
      confirm: {
        title: { type: "plain_text", text: "Approve invoice?" },
        text: { type: "mrkdwn", text: `Approve *${invoice.invoice_number}* for *${formatAmount(invoice.total, invoice.currency)}* and push to ERP?` },
        confirm: { type: "plain_text", text: "Yes, approve" },
        deny: { type: "plain_text", text: "Cancel" },
      },
    },
    {
      type: "button",
      text: { type: "plain_text", text: "✗ Reject" },
      style: "danger",
      action_id: "reject_invoice",
      value: JSON.stringify({ invoiceId: invoice.id, teamId: invoice.team_id }),
      confirm: {
        title: { type: "plain_text", text: "Reject invoice?" },
        text: { type: "mrkdwn", text: `Reject invoice *${invoice.invoice_number}*? The supplier will be notified.` },
        confirm: { type: "plain_text", text: "Yes, reject" },
        deny: { type: "plain_text", text: "Cancel" },
      },
    },
    {
      type: "button",
      text: { type: "plain_text", text: "View in APFlow →" },
      url: process.env.FRONTEND_URL || "https://www.apflow.app",
    },
  ] : [{
    type: "button",
    text: { type: "plain_text", text: "View in APFlow →" },
    url: process.env.FRONTEND_URL || "https://www.apflow.app",
    style: "primary",
  }];

  const payload = {
    attachments: [{
      color,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${emoji} *${title}*`,
          },
        },
        {
          type: "section",
          fields: fields.map(f => ({
            type: "mrkdwn",
            text: `*${f.label}*\n${f.value}`,
          })),
        },
        {
          type: "actions",
          elements: actionButtons,
        },
      ],
    }],
  };

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) throw new Error(`Slack webhook failed: ${res.status}`);
  return true;
}

// ── SEND TEAMS NOTIFICATION ──────────────────────────────────────
async function sendTeamsNotification({ webhookUrl, event, invoice, recipient }) {
  if (!webhookUrl) return;

  const { emoji, title, color, fields } = buildMessageContent({ event, invoice, recipient });

  // Teams Adaptive Card format
  const payload = {
    type: "message",
    attachments: [{
      contentType: "application/vnd.microsoft.card.adaptive",
      content: {
        type: "AdaptiveCard",
        version: "1.4",
        body: [
          {
            type: "Container",
            style: "emphasis",
            items: [{
              type: "TextBlock",
              text: `${emoji} ${title}`,
              weight: "Bolder",
              size: "Medium",
              color: event === EVENTS.INVOICE_FLAGGED ? "Attention" : "Good",
            }],
          },
          {
            type: "FactSet",
            facts: fields.map(f => ({ title: f.label, value: f.value })),
          },
          {
            type: "TextBlock",
            text: `Powered by APFlow · ${new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`,
            size: "Small",
            color: "Default",
            isSubtle: true,
          },
        ],
        actions: [{
          type: "Action.OpenUrl",
          title: "View in APFlow →",
          url: process.env.FRONTEND_URL || "https://www.apflow.app",
        }],
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
      },
    }],
  };

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) throw new Error(`Teams webhook failed: ${res.status}`);
  return true;
}

// ── BUILD MESSAGE CONTENT ────────────────────────────────────────
function buildMessageContent({ event, invoice, recipient }) {
  const amount = formatAmount(invoice.total, invoice.currency || invoice.raw_data?.currency);
  const vendor = invoice.vendor_name || "Unknown Vendor";
  const invoiceNum = invoice.invoice_number || "—";
  const erpRef = invoice.erp_reference || "—";
  const poNum = invoice.raw_data?.poNumber || "—";
  const isBuyer = recipient === "buyer";

  const messages = {
    [EVENTS.INVOICE_UPLOADED]: {
      emoji: "📥",
      title: isBuyer ? `New invoice received from ${vendor}` : `Your invoice was received`,
      color: "#1a6be8",
      fields: [
        { label: "Invoice #", value: invoiceNum },
        { label: "Vendor", value: vendor },
        { label: "Amount", value: amount },
        { label: "Status", value: "Received — processing started" },
      ],
    },
    [EVENTS.INVOICE_PROCESSED]: {
      emoji: "✅",
      title: isBuyer ? `Invoice #${invoiceNum} processed & pushed to ERP` : `Your invoice #${invoiceNum} has been processed`,
      color: "#16a34a",
      fields: [
        { label: "Invoice #", value: invoiceNum },
        { label: "Vendor", value: vendor },
        { label: "Amount", value: amount },
        { label: "ERP Reference", value: erpRef },
        { label: "Status", value: "Pushed to ERP" },
      ],
    },
    [EVENTS.INVOICE_PO_MATCHED]: {
      emoji: "🎯",
      title: isBuyer ? `Invoice #${invoiceNum} matched to PO` : `Your invoice #${invoiceNum} matched a purchase order`,
      color: "#7c3aed",
      fields: [
        { label: "Invoice #", value: invoiceNum },
        { label: "Vendor", value: vendor },
        { label: "Amount", value: amount },
        { label: "PO Number", value: poNum },
        { label: "Match Status", value: "Matched ✓" },
      ],
    },
    [EVENTS.INVOICE_FLAGGED]: {
      emoji: "⚠️",
      title: isBuyer ? `Invoice #${invoiceNum} flagged for review` : `Your invoice #${invoiceNum} needs attention`,
      color: "#dc2626",
      fields: [
        { label: "Invoice #", value: invoiceNum },
        { label: "Vendor", value: vendor },
        { label: "Amount", value: amount },
        { label: "Reason", value: invoice.agent_reason || invoice.flag_reason || "Flagged by anomaly detection" },
        { label: "Action Required", value: isBuyer ? "Review in APFlow" : "Please resubmit or contact AP team" },
      ],
    },
    [EVENTS.INVOICE_NEEDS_APPROVAL]: {
      emoji: "🔔",
      title: `Invoice #${invoiceNum} needs your approval`,
      color: "#f59e0b",
      fields: [
        { label: "Invoice #", value: invoiceNum },
        { label: "Vendor", value: vendor },
        { label: "Amount", value: amount },
        { label: "PO Number", value: poNum },
        { label: "Action Required", value: "Approve or Reject below" },
      ],
    },
    [EVENTS.PAYMENT_CONFIRMED]: {
      emoji: "💰",
      title: isBuyer ? `Payment confirmed for invoice #${invoiceNum}` : `Payment confirmed for your invoice #${invoiceNum}`,
      color: "#16a34a",
      fields: [
        { label: "Invoice #", value: invoiceNum },
        { label: "Vendor", value: vendor },
        { label: "Amount Paid", value: amount },
        { label: "ERP Reference", value: erpRef },
        { label: "Payment Status", value: "Paid ✓" },
        ...(invoice.payment_date ? [{ label: "Payment Date", value: new Date(invoice.payment_date).toLocaleDateString("en-US", { dateStyle: "medium" }) }] : []),
      ],
    },
  };

  return messages[event] || messages[EVENTS.INVOICE_PROCESSED];
}

// ── GET NOTIFICATION SETTINGS ────────────────────────────────────
async function getNotificationSettings(teamId) {
  const { data } = await supabase
    .from("notification_settings")
    .select("*")
    .eq("team_id", teamId)
    .single();
  return data;
}

// ── SAVE NOTIFICATION SETTINGS ───────────────────────────────────
async function saveNotificationSettings({ teamId, settings }) {
  const { data, error } = await supabase
    .from("notification_settings")
    .upsert({ team_id: teamId, ...settings, updated_at: new Date().toISOString() }, { onConflict: "team_id" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ── MAIN: NOTIFY ─────────────────────────────────────────────────
async function notify({ teamId, event, invoice, supplierWebhooks }) {
  const results = { buyer: { slack: null, teams: null }, supplier: { slack: null, teams: null } };

  try {
    // Get buyer notification settings
    const buyerSettings = await getNotificationSettings(teamId);

    // ── BUYER NOTIFICATIONS ──────────────────────────────────────
    if (buyerSettings?.enabled) {
      // Check if this event is enabled
      const eventEnabled = {
        [EVENTS.INVOICE_UPLOADED]:   buyerSettings.notify_on_uploaded,
        [EVENTS.INVOICE_PROCESSED]:  buyerSettings.notify_on_processed,
        [EVENTS.INVOICE_PO_MATCHED]: buyerSettings.notify_on_matched,
        [EVENTS.INVOICE_FLAGGED]:    buyerSettings.notify_on_flagged,
        [EVENTS.PAYMENT_CONFIRMED]:  buyerSettings.notify_on_payment,
      }[event];

      if (eventEnabled) {
        if (buyerSettings.slack_webhook_url) {
          try {
            await sendSlackNotification({ webhookUrl: buyerSettings.slack_webhook_url, event, invoice, recipient: "buyer" });
            results.buyer.slack = "sent";
            console.log(`Slack notification sent to buyer for ${event}`);
          } catch (e) {
            results.buyer.slack = `error: ${e.message}`;
            console.error("Buyer Slack notification error:", e.message);
          }
        }
        if (buyerSettings.teams_webhook_url) {
          try {
            await sendTeamsNotification({ webhookUrl: buyerSettings.teams_webhook_url, event, invoice, recipient: "buyer" });
            results.buyer.teams = "sent";
            console.log(`Teams notification sent to buyer for ${event}`);
          } catch (e) {
            results.buyer.teams = `error: ${e.message}`;
            console.error("Buyer Teams notification error:", e.message);
          }
        }
      }
    }

    // ── SUPPLIER NOTIFICATIONS ───────────────────────────────────
    // Supplier webhooks are optional — passed in from invoice raw_data or supplier profile
    const supplierSlack = supplierWebhooks?.slack || invoice.raw_data?.supplier_slack_webhook;
    const supplierTeams = supplierWebhooks?.teams || invoice.raw_data?.supplier_teams_webhook;

    const supplierEvents = [
      EVENTS.INVOICE_UPLOADED,
      EVENTS.INVOICE_PROCESSED,
      EVENTS.INVOICE_FLAGGED,
      EVENTS.PAYMENT_CONFIRMED,
    ];

    if (supplierEvents.includes(event)) {
      if (supplierSlack) {
        try {
          await sendSlackNotification({ webhookUrl: supplierSlack, event, invoice, recipient: "supplier" });
          results.supplier.slack = "sent";
          console.log(`Slack notification sent to supplier for ${event}`);
        } catch (e) {
          results.supplier.slack = `error: ${e.message}`;
          console.error("Supplier Slack notification error:", e.message);
        }
      }
      if (supplierTeams) {
        try {
          await sendTeamsNotification({ webhookUrl: supplierTeams, event, invoice, recipient: "supplier" });
          results.supplier.teams = "sent";
          console.log(`Teams notification sent to supplier for ${event}`);
        } catch (e) {
          results.supplier.teams = `error: ${e.message}`;
          console.error("Supplier Teams notification error:", e.message);
        }
      }
    }

    // Log notification
    await supabase.from("notification_log").insert({
      team_id: teamId,
      invoice_id: invoice.id,
      event_type: event,
      results: JSON.stringify(results),
      created_at: new Date().toISOString(),
    });

    return results;
  } catch (err) {
    console.error("Notification agent error:", err.message);
    return results;
  }
}

// ── TEST WEBHOOK ─────────────────────────────────────────────────
async function testWebhook({ platform, webhookUrl }) {
  const testInvoice = {
    id: "test",
    invoice_number: "TEST-001",
    vendor_name: "Test Vendor Inc.",
    total: 1250.00,
    currency: "USD",
    erp_reference: "ERP-TEST-123",
    raw_data: { poNumber: "PO-2024-001" },
    agent_reason: "This is a test notification from APFlow",
  };

  if (platform === "slack") {
    return sendSlackNotification({ webhookUrl, event: EVENTS.INVOICE_PROCESSED, invoice: testInvoice, recipient: "buyer" });
  } else if (platform === "teams") {
    return sendTeamsNotification({ webhookUrl, event: EVENTS.INVOICE_PROCESSED, invoice: testInvoice, recipient: "buyer" });
  }
  throw new Error("Unknown platform");
}

module.exports = { notify, EVENTS, getNotificationSettings, saveNotificationSettings, testWebhook };
