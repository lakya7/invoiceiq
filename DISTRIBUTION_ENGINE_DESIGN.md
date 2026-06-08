# Non-PO Distribution Engine — Design Spec

**Status: DESIGN / ROADMAP — NOT yet implemented. No code exists for any of this.**

Purpose: assign a valid Oracle GL account (CoA combination) to every **non-PO** invoice line
before push, so Billtiq stops relying on Oracle to default distributions (the Section 2 gap in
`ORACLE_VALIDATION_ROADMAP.md`). PO-matched lines derive their account from the PO and are out of
scope here.

> **Scope note:** the 16-entity schema, the rule precedence, and the phase boundaries below are a
> proposed design capture — confirm they match intent before any build. Entity/column names are
> indicative, not final.

---

## 1. Key dependency — Oracle CoA Sync (prerequisite for everything)

Nothing here works without first pulling the customer's chart of accounts into Billtiq:
- **Account combinations** (valid, enabled code combinations) — needed to *validate* any resolved
  account before push, and to power account pickers in the UI.
- **Segment structure + valid segment values** — needed to build/validate combinations and to
  render segment-aware pickers.
- **Ledgers + Business Units** — needed to scope defaults/rules and to validate BU.

Without CoA sync there is no CoA validation and no safe account picker. **Build this first.**

---

## 2. Data model — 16 entities

Grouped by purpose. Phase tags indicate when each is introduced (see §6).

### A. Oracle CoA Sync — reference data pulled from Oracle (Phase 1)
1. **`oracle_ledgers`** — ledger id/name, currency, period set. (sync)
2. **`oracle_business_units`** — BU id/name, ledger ref, enabled flag. (sync)
3. **`coa_structures`** — per-ledger segment definitions (order, segment labels, value-set refs). (sync)
4. **`coa_segment_values`** — valid values per segment + enabled/effective dates. (sync)
5. **`coa_account_combinations`** — valid GL code combinations, enabled flag, allow-posting flag. (sync)

### B. Configuration — customer setup (Phase 1–2)
6. **`distribution_defaults`** — catch-all/default account scoped by team and optionally BU
   (Phase 1 MVP: the per-customer/BU default GL account + the `(a)` safety net).
7. **`supplier_account_map`** — per-supplier default account override (Phase 1).
8. **`expense_categories`** — category taxonomy used to classify lines (Phase 2).
9. **`category_account_map`** — category → account mapping, scoped by team/BU (Phase 2).
10. **`distribution_templates`** — named reusable distributions (e.g. a standard multi-account
    split) (Phase 2).
11. **`distribution_template_lines`** — template detail: account + split (percent or amount) (Phase 2).

### C. Rules engine + learning (Phase 3)
12. **`distribution_rules`** — priority-ordered rules: priority, scope, target account/template,
    active flag (Phase 3).
13. **`distribution_rule_conditions`** — predicate rows for a rule (field, operator, value;
    AND/OR grouping) (Phase 3).
14. **`distribution_learning`** — learned signals: (supplier, normalized description/keywords) →
    historically chosen account + confidence (Phase 3).

### D. Runtime output + audit (Phase 1)
15. **`invoice_line_distributions`** — the resolved distribution(s) per invoice line: account
    combination, amount/split, resolution source, validation status. **This is what the push path
    reads to build the Oracle payload.**
16. **`distribution_resolution_audit`** — how each line resolved (which rule/default/override fired),
    the pre-override vs final account, who overrode and when.

---

## 3. Priority-ordered rule model (resolution precedence)

For each non-PO line, resolve the account by walking this precedence, highest first; first hit wins:

1. **Manual override** (from the review UI for this specific line/invoice) — always wins.
2. **Rule match** (`distribution_rules`, evaluated by `priority` ascending; conditions in
   `distribution_rule_conditions`) — Phase 3.
3. **Template** (if a rule or supplier maps to a `distribution_template`) — Phase 2.
4. **Supplier default** (`supplier_account_map`) — Phase 1.
5. **Category default** (`category_account_map`, after line classification) — Phase 2.
6. **BU default** (`distribution_defaults` scoped to BU) — Phase 1.
7. **Customer safety-net default** (`distribution_defaults` team-wide `(a)`) — Phase 1.

Whatever resolves, the chosen account is then **CoA-validated** against
`coa_account_combinations` (must exist, be enabled, allow posting). Invalid/unresolved → the line
is flagged and routed to the review UI (it does **not** silently push).

---

## 4. Processing flow (push-time)

```
for each non-PO invoice line:
  1. classify line → expense category (Phase 2; skipped in Phase 1)
  2. resolve account via the precedence chain (§3)
  3. CoA-validate the resolved account (coa_account_combinations: exists + enabled + postable)
  4a. valid  → write invoice_line_distributions (source = which step resolved it) + audit
  4b. invalid/unresolved → mark line "needs distribution review" → invoice → review status
  5. if any line needs review → invoice goes to Review (ties to APPROVAL_FLOW_BUG.md model);
     otherwise proceed
  6. push path builds Oracle payload line distributions from invoice_line_distributions
  7. record resolution + any override in distribution_resolution_audit
```

Resolution is **deterministic and auditable** — every line records which step produced its account.

---

## 5. UI flow

- **Setup UI** (admin) — configure: team/BU default account(s) + safety net (P1), supplier
  account map (P1), categories + category→account (P2), templates/splits (P2), rules (P3). All
  account inputs are CoA-validated pickers driven by the sync.
- **Review UI** (per invoice) — for lines flagged "needs distribution review": show resolved
  account + resolution source + validation status; allow **override** via a CoA-validated picker.
  Shared surface with the Fix-&-Resubmit review in `APPROVAL_FLOW_BUG.md`.
- **Audit view** — per line: how it resolved, override history (`distribution_resolution_audit`).

---

## 6. Three-phase rollout

### Phase 1 — Default GL + override + CoA validation (MVP)
- Oracle CoA sync (entities 1–5) + `distribution_defaults` (6), `supplier_account_map` (7),
  `invoice_line_distributions` (15), `distribution_resolution_audit` (16).
- Precedence subset: manual override → supplier default → BU default → safety-net default.
- CoA validation on every resolved account; unresolved/invalid → review override.
- **Goal:** non-PO invoices push with a valid account, every time, with human override.

### Phase 2 — Templates & splits
- `expense_categories` (8), `category_account_map` (9), `distribution_templates` (10),
  `distribution_template_lines` (11).
- Adds line classification → category default, and multi-account splits via templates.

### Phase 3 — Rules engine + learning
- `distribution_rules` (12), `distribution_rule_conditions` (13), `distribution_learning` (14).
- Priority-ordered conditional rules; learning suggests accounts from historical overrides
  (supplier + description), surfaced as defaults the user confirms.

---

## 7. Open questions (resolve before build)
- CoA sync cadence + scale (full account-combination sets can be very large) — full vs.
  on-demand/segment-validated combinations.
- Split granularity in Phase 1 (single account per line assumed) vs. deferring all splits to P2.
- How distribution review interacts with the existing approval/Review states (one review surface
  vs. distinct flags).
- Multi-currency / intercompany accounts (likely Phase 3).

---

## Related docs
- `ORACLE_VALIDATION_ROADMAP.md` — Section 2 "distribution/CoA for non-PO lines" gap this engine
  closes; Section 9 accounting/period items it depends on.
- `APPROVAL_FLOW_BUG.md` — Review / Fix-&-Resubmit surface the distribution-review UI reuses.
