# Oracle Fusion Pre-Push Validation — Roadmap & Design

**Status: ROADMAP / DESIGN — NOT yet implemented.** This is a forward-looking plan for hardening
Billtiq's pre-push validation against Oracle Fusion AP. Only the *current-state audit* of
Sections 1 & 2 below reflects shipped code (`backend/oracle.js`); everything else is design.

**Why this matters:** Billtiq inserts invoices **directly into live Oracle AP via REST**
(`POST /fscmRestApi/.../invoices`) — it does **not** stage into interface tables and run AP Import.
So Oracle's Import-program validation never runs; the REST API hard-rejects instead (opaque
`AP-xxxxx` / HTTP 400). That makes pre-push validation our responsibility: anything we don't catch
becomes a failed push (now correctly saved as `status:"review"` per the Tier 1 fix), not a
correctable import-batch row.

---

## 1. The 9-Section Oracle-Safe Validation Checklist

Sections 1 & 2 are detailed and code-audited (see §2 below). Sections 3–9 are the proposed
checklist scope — **code audit still pending** (requirements listed, current state not yet mapped).

### Section 1 — Header mandatory fields  *(audited)*
- Business unit valid/enabled
- Supplier exists (and is active)
- Pay site provided (valid, purpose = pay)
- Invoice number present + unique **per supplier**
- Invoice date valid
- Accounting date in an **open** period
- Currency valid for the BU/ledger
- Invoice type valid (STANDARD / CREDIT / PREPAYMENT)
- Invoice amount sign correct (positive Standard / negative Credit)

### Section 2 — Line & distribution  *(audited)*
- At least one line
- Valid line types (Item / Freight / Tax / Miscellaneous)
- Sum of lines == header amount (within tolerance)
- Accounting distribution / CoA for **non-PO** lines

### Section 3 — Tax  *(checklist scope — audit pending)*
- Tax lines present where required; tax line type valid
- Tax rate / tax code resolvable in Oracle
- Header tax total reconciles to line tax
- Recoverable vs non-recoverable handling

### Section 4 — PO matching  *(checklist scope — partially in code via §8/§8.5; full audit pending)*
- PO exists and is open/approved
- Match approval level honored (2-way / 3-way / 4-way)
- Quantity/price tolerances within Oracle config
- Goods receipt verification for 3-way; inspection for 4-way

### Section 5 — Payment & banking  *(checklist scope — audit pending)*
- Payment terms valid/enabled for supplier
- Payment method valid
- Bank account / remit-to present for EFT methods
- Supplier/site not on payment hold

### Section 6 — Duplicate detection  *(checklist scope — partially in code via §6; audit pending)*
- Same invoice number **per supplier** (not global)
- Same amount + date heuristics (near-duplicate)
- Reconcile with Billtiq-side Rule 0 hard-block

### Section 7 — Supplier & site validity  *(checklist scope — audit pending)*
- Supplier active (not inactive/end-dated)
- Site active and assigned to the BU
- Site purpose includes Pay
- Supplier not on hold

### Section 8 — Currency & cross-currency  *(checklist scope — audit pending)*
- Currency enabled for ledger
- Exchange rate present for foreign currency (rate, rate date, rate type)
- Rate type valid for the BU

### Section 9 — Accounting & periods  *(checklist scope — audit pending)*
- Accounting date supplied (currently omitted — Oracle defaults it)
- Period open for that accounting date
- CoA account combination valid & enabled
- Budgetary control / encumbrance (if enabled on the ledger)

> Note: the Section 3–9 requirement lists are a first-pass framework to be refined when each is
> audited against the code.

---

## 2. Current-State Code Audit — Sections 1 & 2

Mapped against `backend/oracle.js` (`validateInvoice` §1–10; `pushInvoice` resolution + payload,
lines 771–843), 2026-06-07.

### Section 1 — Header

| Requirement | Current state | Detail |
|---|---|---|
| Business unit valid/enabled | **NOT-CHECKED** | `BusinessUnit` resolved from matched site or hard-coded `FALLBACK "US1 Business Unit"`; never validated. |
| Supplier exists | **CHECKED — WARN only** | §7 name lookup; no match → warn + proceeds (falls back to demo `"ABC Consulting"`); partial → warn + uses it. Never blocks. |
| Pay site provided | **PARTIAL (warn)** | `findMatchingSupplierSite` always sends a site (strong ZIP+street match / primary pay site / `FALLBACK "ABC US1"`); warns on no address match; no validity check. Never blocks. |
| Invoice number present + unique-per-supplier | **present = CHECKED (block); unique = PARTIAL** | Present missing → block. Uniqueness §6 queries by `InvoiceNumber` **globally, not supplier-scoped** → block on any hit (can false-block same-number/different-supplier); degrades to warn on API failure; skipped without creds. |
| Invoice date valid | **CHECKED (block)** | Missing → block; future → block; >2yr → warn. Format only via loose JS `Date` parse. |
| Accounting date in open period | **NOT-CHECKED (not sent)** | Payload has no `AccountingDate`; Oracle defaults it; open period never verified. |
| Currency valid for BU/ledger | **PARTIAL (warn)** | §4 checks a static 10-code allowlist → warn; not validated against BU/ledger-enabled currencies. |
| Invoice type valid | **NOT-CHECKED** | `InvoiceType` hard-coded `"Standard"`; no credit/prepayment detection. |
| Amount sign correct | **PARTIAL (block on ≤0)** | §1 requires `total > 0` → blocks zero/negative; with hard-coded Standard, credit memos (negative) are blocked entirely. No credit path. |

### Section 2 — Line & distribution

| Requirement | Current state | Detail |
|---|---|---|
| At least one line | **NOT-CHECKED** | No minimum-line check; empty `lineItems` → `invoiceLines: []` sent. |
| Valid line types | **COVERED by mapping (no validation)** | `getOracleLineType` maps each to Item/Freight/Tax/Miscellaneous (default Item). Can't emit an invalid type, but can misclassify. |
| Sum of lines == header (tolerance) | **CHECKED (block)** | §5: `lineTotal + tax` vs `total` within $0.02 → block. Caveat: only runs when `lineItems` non-empty. |
| Accounting distribution / CoA for non-PO lines | **NOT-CHECKED / NOT-PROVIDED** | Payload sends no distributions, GL account, or CoA segments. Relies entirely on Oracle defaulting (e.g. supplier-site distribution set) or it rejects/requires manual. |

### Cross-cutting caveats
- **API-dependent checks degrade silently:** uniqueness (§6), supplier (§7), PO (§8), match (§8.5)
  `catch` and continue (warn or proceed on fallbacks) when Oracle is unreachable/401; **skipped
  entirely in mock mode** (no creds).
- **Direct-REST bypasses AP Import validation**, so NOT-CHECKED items surface as opaque REST
  rejections at push time rather than correctable import rows.

### Key gaps (today) — the ones most likely to cause real Oracle rejections
1. **No "at least one line" check** — an invoice with no lines sends `invoiceLines: []`.
2. **Uniqueness is global, not per-supplier** — §6 queries by `InvoiceNumber` only, so it can
   *false-block* a legitimate same-number/different-supplier invoice (Oracle's rule is per-supplier).
3. **No distributions / CoA for non-PO lines** — payload sends no GL account at all; entirely
   reliant on Oracle defaulting. (Addressed by `DISTRIBUTION_ENGINE_DESIGN.md`.)
4. **No BU / accounting-period / invoice-type validation** — BU is fallback-filled but never
   validated; accounting date isn't even sent (period never checked); `InvoiceType` is hard-coded
   `"Standard"` (no credit/prepayment).

### Shipped / deferred status of the gaps

- **Gap 1 (min-line):** ✅ FIXED — `validateInvoice` §5 now hard-blocks zero-line invoices.
- **Gap 2 (per-supplier uniqueness):**
  - ✅ *Message* improved — the §6 duplicate error now names the existing invoice's supplier
    (`Supplier` + `SupplierNumber`, both confirmed in the default invoices response) and tells the
    reviewer a different-supplier collision may be acceptable.
  - ⏳ *Logic* DEFERRED (**Option B**) — reorder so supplier resolution (§7) runs **before** the
    duplicate check (§6), then scope the dup query by `SupplierNumber` (confirmed a queryable
    attribute on the `invoices` resource, e.g. `q=InvoiceNumber=<n>;SupplierNumber=<id>`). Current
    behavior is **safe** (it over-blocks, never under-blocks) but can **false-block** a legitimate
    cross-supplier same-number invoice. Defer until the supplier-resolution reorder is done so the
    resolved `SupplierNumber` is available at the check.
- **Gap 3 (distributions/CoA):** ⏳ deferred — see `DISTRIBUTION_ENGINE_DESIGN.md`.
- **Gap 4 (BU/period/type):** ⏳ not started — checklist Sections 1 & 9.

---

## 3. Distributions Strategy — Decision

> **⛔ PARKED — pending an upstream architecture fork.** The strategy below assumes **Path A**
> (direct REST into AP tables → Billtiq validates CoA before push). If we instead move to **Path B**
> (stage into interface tables → Oracle's Import process validates CoA/distributions), this whole
> strategy is superseded by import-rejection handling. Lakya is reviewing Oracle docs to decide.
> **Do not build the CoA sync / distribution engine until the fork is resolved** — see the PARKED
> banner in `DISTRIBUTION_ENGINE_DESIGN.md`.

**The Section 2 "accounting distribution / CoA for non-PO lines" gap is the biggest blocker** for
reliable non-PO invoice pushes. Decision below.

### Options (definitions)
- **(a) Safety-net default** — a single catch-all GL account / distribution set so a push never
  fails purely for a missing distribution. Coarse, but guarantees no hard-stop.
- **(b) Per-customer default GL account** — each customer configures default account(s) (e.g. per
  BU and/or expense category) that Billtiq stamps onto non-PO lines.
- **(c) Distribution rules engine** — rules mapping supplier / line-type / category (and similar)
  → a specific GL account combination, for accurate coding without manual touch.

> These (a)/(b)/(c) definitions are this doc's capture of the decision — confirm they match intent.

### Decision: **Hybrid (b) + (c), with (a) as safety net**
Resolution order at push time: **(c) rules → (b) per-customer default → (a) safety-net default**,
so a line is always codeable and a push is never blocked solely on distribution, while still
allowing accurate rules-based coding where configured.

### MVP scope (first build)
- **(b) Per-customer default GL account** — the minimum to push non-PO invoices reliably.
- **Review override** — user can view/change the resolved account before push (Fix-&-Resubmit-style
  review UI; ties into the M-series review model in `APPROVAL_FLOW_BUG.md`).
- **CoA validation** — validate the chosen account combination against Oracle's chart of accounts
  before push (don't send an invalid combination).

Deferred beyond MVP: the full **(c) rules engine** and the broader **(a)** catch-all policy
(MVP's per-customer default effectively serves as the initial fallback).

---

## 4. Dependencies (for the future build — none exist yet)

- **Distribution-rules data model** — new tables for per-customer default account(s) and (later)
  the rules engine; tie to team/BU/category.
- **Oracle CoA sync** — pull the customer's chart-of-accounts structure + valid account
  combinations into Billtiq to enable CoA validation and account pickers.
- **Setup UI** — for customers to configure default account(s) and (later) distribution rules.
- **Review UI** — surface the resolved distribution and allow override before push (shares the
  Review/Fix-&-Resubmit surface).
- **Push-path changes** — `oracle.js` `pushInvoice` must build and send line distributions
  (account combinations) in the payload; `validateInvoice` must add the CoA-validation +
  distribution-presence checks (Section 2 + Section 9 items above).

---

## Related docs
- `APPROVAL_FLOW_BUG.md` — review/outcome status model (M1/M2, Q1–Q3), the Tier 1 push-status fix,
  and the Fix-&-Resubmit review surface this roadmap's review override builds on.
- `supabase/migrations/20260607_extend_invoices_status_check.sql` — status vocabulary now includes
  `review` / `validation_failed`, which failed-validation pushes will use.
