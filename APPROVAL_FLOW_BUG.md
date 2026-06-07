# Approval Flow — Bug Findings & Design Decision

**Status: DESIGN — decision direction set, NOT yet implemented. No code changes.**
Last updated this session (2026-06-06).

---

## The bug (what's actually wired today)

Traced end-to-end this session. Two findings:

### 1. The dashboard Approve/Reject buttons are dead
- `Dashboard.jsx:190` `approveInvoice()` POSTs to `/api/invoices/:invoiceId/approve`.
- `Dashboard.jsx:203` `rejectInvoice()` POSTs to `/api/invoices/:invoiceId/reject`.
- **Neither route exists in the backend.** The only `/api/invoices/:invoiceId/*` routes are
  `comments`, `mark-paid`, `audit`, `audit/comment` (server.js:1055–1169). No catch-all 404
  handler exists, so the POST returns Express's default 404; the frontend's `res.json()` then
  throws → `catch` → `alert("Error: …")`. Net effect: **no-op + error popup; invoice stays
  `pending`.**

### 2. The Slack approval path is also unhandled
- For `pending_approval`, the backend sends a Slack notification with Approve/Reject buttons
  (server.js:603, `value: {invoiceId, teamId}`).
- **No endpoint receives Slack button clicks** — no `interactions`/`actions`/`slack` route
  (only `/api/billing/webhook` exists).

**Consequence:** there is currently **no implemented path** that moves a `pending` invoice
forward, via dashboard *or* Slack. Pending invoices are stuck.

### Where the ERP push actually happens
- Inside `POST /api/push-erp` (server.js:425), **at upload time**, the real Oracle push fires at
  **line 511** (`oracle.pushInvoice`) — **before** the approval agent runs (line 573).
- Approval only decides the recorded *status*: clean → `status:"pushed"` with real
  `erp_reference` (line 662); `pending_approval` → separate `status:"pending"` row with
  `erp_reference:null` (line 582), then early `return`.
- **Latent inconsistency:** because push (line 511) precedes the approval agent, if Oracle is the
  connected ERP and the agent returns `pending_approval`, the invoice is pushed to Oracle yet
  recorded as `pending` / `erp_reference:null`. The `pending_approval` branch reads as
  QuickBooks/Slack-oriented (comment at line 579; `erpType` defaults to `"quickbooks"` at
  line 610). Confirm whether `approvalAgent.js` can ever return `pending_approval` for Oracle.

---

## Decision direction (set this session)

### KEEP push-at-upload — do NOT add a pre-push human approval gate
**Rationale:** the email agent (`emailAgent.js`) and ZIP batch processing (`batchProcessor.js`)
are **automated, no-human-in-the-loop** ingestion paths. A pre-push approval gate would block
them — invoices would pile up waiting for a human that those flows assume isn't there. Pushing at
upload is correct for the automated model; we keep it.

### Status reflects the ERP outcome, not a human gate
Re-frame status around what the ERP actually did with the push:

| ERP outcome | Status |
|---|---|
| Push succeeded | **Pushed** |
| ERP rejected the push (e.g. supplier name/address mismatch, validation failure) | **Review** |

So "Review" = "the ERP wouldn't accept this; a human needs to fix and resubmit," **not** "a human
must pre-approve before it goes out." This replaces the current `pending` (pre-approval) framing.

---

## Open questions to resolve NEXT SESSION (before any code)

1. **Does a manual "Approve" action still have meaning?**
   Under the push-at-upload model there's nothing to pre-approve. So either:
   - (a) Drop the dead Approve/Reject buttons entirely, **or**
   - (b) Replace them on **Review** invoices with a **"Retry / Fix & Resubmit"** action that
     re-attempts the ERP push after the user corrects the issue (e.g. supplier match).
   Leaning toward (b) — needs confirmation.

2. **Should the "$ Pending Approval" tile become "$ in Review"?**
   To match the outcome-based model, the tile (and its filter) would shift from "pending
   approval" to "in Review" (ERP-rejected, needs fixing). Decide whether to rename the tile +
   its `setFilter` target, and whether the underlying filter value (`"pending"`) is renamed too.

---

## NOT decided yet / depends on the above
- Whether to delete the `/approve` + `/reject` frontend handlers, or repoint them at a new
  `/resubmit` endpoint.
- Whether to build the Slack interactions endpoint at all (may be moot if approval-as-gate is
  gone and Review is dashboard-driven).
- How to fix the line-511-before-approval inconsistency once the `pending` concept is replaced.

**Do not write code until Q1 and Q2 are finalized.**
