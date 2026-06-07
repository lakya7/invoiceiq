# Approval Flow — Bug Findings & Design Decision

**Status: DESIGN — decision direction set, NOT yet implemented. No code changes.**
Last updated this session (2026-06-06).

---

## 🟠 BUG (separate from the redesign): failed ERP pushes are mislabeled as "pushed"

**This is a real code bug, tracked here but independent of the approval-flow redesign.**
**Urgency downgraded** (2026-06-06) from "may be corrupting live production data" to
**"real code bug, LOW data impact"** after the audit below — the affected rows look like test
data, not customer data. Still worth fixing, but not an emergency.

In `server.js` `/api/push-erp`, the Oracle-push **catch block (~lines 522–527)** sets
`validationStatus = "push_failed"` but **does NOT `return`**. Execution falls through, and the
invoice is then saved (~line 662) with:
- `status: "pushed"` — even though the real push failed, and
- a **fake** `erp_reference` of the form `ERP-${Date.now()}` — because the real Oracle InvoiceId
  was never obtained (the genuine refs look like `ORA-…`).

**Consequences:**
- Invoices that **never reached the ERP** are recorded in Billtiq as `"pushed"` with bogus
  `ERP-…` references that don't correspond to anything in Oracle.
- The `push_failed` status/message exist **only in the HTTP response** (line 703) — they are
  **never persisted**, so the dashboard/DB show these as successfully pushed.
- (Pre-validation failures write `status:"validation_failed"`, but that update matches by
  `invoice_number + team_id` and only hits **already-saved** rows — not first-time pushes.)

### Audit findings (read-only, 2026-06-06)

Ran a read-only prefix audit of `status='pushed'` rows on prod (cwsubqfynnntrzfshldy). **67 pushed
rows total:**

| Prefix | Count | Meaning |
|---|---|---|
| `ORA-` | 16 | Real Oracle pushes ✅ |
| `QB-` | 5 | QuickBooks pushes |
| `BATCH-` | 10 | Batch-processor ingested |
| `EMAIL-` | 1 | Email-agent ingested |
| `ERP-` | 35 | Fallback ref — see refinement below |
| `(null)` | 0 | — |

**KEY REFINEMENT — `ERP-%` does NOT mean "failed push".** `ERP-${Date.now()}` is the *initial
fallback* reference (`server.js:475`), used in **two** situations:
- **(a) Mock mode** — no ERP connected → saved as `status:"pushed"` with an `ERP-` ref **by
  design** (`validationStatus:"mock"`). Not a failure.
- **(b) The actual bug** — an ERP *was* connected but the push threw → ref never overwritten →
  mislabeled `"pushed"`.

**Prefix alone cannot separate (a) from (b)**; the distinguishing field is `validationStatus`,
which is **never persisted** (that's the bug). So **35 is an upper bound**, not the true count.

The 35 `ERP-` rows **look like test data** — `$0`/`$5` totals; vendors like `"Your Company Name"`,
`"Anthropic, PBC"`, `"Sonic Solutions"`; date range 2026-04-12 → 2026-06-03. ⇒ **genuine
customer-data corruption is likely minimal.** Hence the urgency downgrade above.

**Next-session isolation step (read-only)** — to count genuine case-(b) failures, cross-reference
each `ERP-` row against:
- **`erp_connections`** — was an ERP actually connected for that team at the time? (separates
  mock-mode (a) from real-failure (b))
- **`agent_reason`** — does it carry push/validation failure text?
- **`total > 0` + a real vendor name** — filters out the obvious test rows.

**Also flag (possibly a SEPARATE correctness question):** verify that **`BATCH-` / `EMAIL-`
invoices are actually pushed to an ERP**, versus just being labeled `"pushed"` on ingest. If those
paths stamp `"pushed"` without a real ERP push, that's a second mislabeling issue distinct from
the catch-block bug.

**Fix scope:** the code fix (return/short-circuit on push failure + persist a real failed status)
is small. Any **data cleanup** should be scoped only after the case-(b) isolation above — likely
minimal given the test-data finding.

> Note: the persisted-failed-status work here overlaps with prerequisite (a) of Q3 below — a real
> "ERP-rejected / Review" status is needed for both. Coordinate the two.

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

## Resolved decisions — model level (M1, M2)

> Numbering note: an earlier revision labeled these two "Q1/Q2". They are renumbered here to
> **M1/M2** so that **Q1/Q2/Q3** can refer to the duplicate/Review sub-questions below (the
> current working numbering).

### M1 — RESOLVED: "Approve" becomes "Fix & Resubmit"
Push-at-upload stays; there is **no pre-approval gate**. The dead Approve/Reject buttons are
replaced (on Review invoices) by a **"Fix & Resubmit"** action that corrects the data and
re-attempts the ERP push.

### M2 — RESOLVED (direction): "$ Pending Approval" tile becomes "$ in Review"
The tile (and its filter) shift from "pending approval" to **"$ in Review"**, matching the
outcome-based model. Still to settle in implementation: whether the underlying filter value
(`"pending"`) is also renamed, and the exact tile copy/threshold.

---

## NEW nuance to design next: "Review" has TWO distinct reasons → DIFFERENT actions

The "Review" state is not one thing. It bundles two causes that need different user actions:

| Review reason | What happened | Correct action |
|---|---|---|
| **(a) ERP-rejected** | Push attempted, ERP refused it (e.g. supplier name / address mismatch, validation failure) | **"Fix & Resubmit"** — correct the data, retry the push |
| **(b) Duplicate-suspect** | Flagged as a possible duplicate of an existing invoice | **A decision, not a fix** — **"Push anyway"** vs **"Block / Reject"** |

Key point: (b) is **not** a data-correction flow. Offering "Fix & Resubmit" on a duplicate would
be wrong — the user needs to *decide* whether it's truly a duplicate, not edit fields. The Review
UI must branch the action by reason.

---

## Duplicate / Review sub-questions (Q1, Q2, Q3)

### Q1 — RESOLVED: three-tier duplicate model
Duplicates are handled in **three distinct tiers**, each with its own behavior:
1. **Exact duplicates → Rule 0 hard-block, stays as-is.** The existing `/api/push-erp` Rule 0
   (exact `invoice_number + vendor + amount` against already-pushed/paid rows) continues to
   auto-reject with a `409` and a `rejected_duplicate` row. No change.
2. **Soft duplicate-suspects → Review with a decision.** Anomaly-style soft signals (e.g. same
   number different amount, same amount different number) route to **Review** with a
   **"Push anyway" / "Block"** decision — not a fix.
3. **ERP-rejected → Fix & Resubmit.** Push attempted and refused → Review with the
   **"Fix & Resubmit"** data-correction action (see M1).

### Q2 — RESOLVED: human-blocked duplicates get a distinct status
When a user chooses **"Block"** on a soft suspect, the invoice gets a **distinct status, e.g.
`blocked_duplicate`** — kept **separate** from Rule 0's automated `rejected_duplicate`. This
preserves the audit distinction between "the system auto-rejected an exact dupe" vs. "a human
reviewed a suspect and decided to block it."

### Q3 — OPEN, and NOT a simple design question: it's blocked on prerequisites (mini-project)

Originally phrased as "what does 'Fix' involve in the UI?" The code investigation this session
found that the **assumptions behind "Fix & Resubmit" don't hold**, so it cannot be built as a
straightforward UI feature:

- **The `vendor_mappings` / `vendorMatcher.js` system is effectively unwired.** `matchVendor` and
  `saveVendorSelection` have **no call sites**; the table is **never written** by running code;
  and `matchVendor` doesn't even **read** `vendor_mappings`. So "the fix persists a mapping for
  next time" would be built **largely from scratch**, not wired onto something working.
- **Supplier/address mismatches do NOT reject today.** `oracle.js` `validateInvoice` **warns and
  pushes anyway**, using a partial name match or a hard-coded demo fallback. So the
  **"ERP-rejected → Review" trigger our design assumes does not currently exist.** Making it real
  requires a **behavior change** in `validateInvoice`/`pushInvoice` to decide which mismatches
  become hard Review stops vs. continue warn-and-pushing.
- **Reusable pieces that DO exist:** `Review.jsx`'s editable `Field` components +
  `POST /api/erp/oracle/validate` (`validateOnly`, returns `{errors, warnings, matchedSupplier}`)
  give a ready **"edit fields → re-check"** UX — **but only at upload time.** There is **no
  equivalent for an already-pushed/failed invoice**, **no endpoint to update an existing
  invoice's vendor**, and **no resubmit/re-push endpoint**.

**Q3's three prerequisites — must land BEFORE any Fix & Resubmit build:**
- **(a)** Introduce a real **persisted "ERP-rejected / Review" status** on the invoice row.
  *(Overlaps with the high-priority bug above — coordinate.)*
- **(b)** Decide **which mismatches become hard Review stops vs. stay warn-and-push** (the
  `validateInvoice`/`pushInvoice` behavior change).
- **(c)** If fixes should persist: **wire up `vendor_mappings`** — write a mapping on fix, **and**
  make `oracle.js`'s supplier lookup actually **consult** it.

**Q3 stays OPEN — it is a mini-project, not a one-line decision.**

---

## NOT decided yet / depends on the above
- Whether to delete the `/approve` + `/reject` frontend handlers, or repoint them at a new
  `/resubmit` endpoint (the "Fix & Resubmit" action).
- Whether to build the Slack interactions endpoint at all (may be moot if approval-as-gate is
  gone and Review is dashboard-driven).
- How to fix the line-511-before-approval inconsistency once the `pending` concept is replaced
  by the outcome-based `Pushed` / `Review` model.

**Resolved: M1, M2, Q1, Q2. Still open: Q3 (a mini-project, blocked on prerequisites a/b/c).
Also tracking the separate 🟠 data-integrity bug at the top (urgency downgraded after audit —
real bug, low data impact). Do not write code: Q3's prerequisites must be scoped first, and the
data-integrity bug's genuine-failure subset should be isolated (read-only) before any fix.**
