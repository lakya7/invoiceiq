# Billtiq — Oracle Fusion AP Exception Handling

AI-native B2B SaaS for mid-market AP teams using Oracle Fusion (and eventually QuickBooks,
NetSuite, etc). Extracts invoice PDFs with Claude, runs anomaly checks, matches POs,
pushes to Oracle Fusion. Solo-founder build. Invite-only as of May 2026.

**Live ERP:** Oracle Fusion only. Everything else on the landing page is "SOON" status.
Do not assume QB/NetSuite/Xero/Zoho/Dynamics works — those connectors are stubs.

---

## Stack

- **Backend:** Node.js + Express on Render (URL: `invoiceiq-backend-w42q.onrender.com`)
- **Frontend:** Vite + React on Vercel (domain: `billtiq.com`)
- **Landing page:** Static HTML at `frontend/public/landing.html`, served at `/` per `frontend/vercel.json`
- **DB + Auth:** Supabase (PostgreSQL + Google OAuth)
- **AI:** Claude API (`@anthropic-ai/sdk`) for invoice extraction + anomaly detection
- **Email:** Resend primary (`notifications@billtiq.com`), Gmail SMTP fallback
- **ERP:** Oracle Fusion REST API (`/fscmRestApi/resources/.../invoices`)

---

## Directory map

```
/
├── backend/
│   ├── server.js              ← Express routes (~1700 lines, all endpoints)
│   ├── oracle.js              ← Oracle Fusion integration (push, lookup, attach PDF)
│   ├── approvalAgent.js       ← Routes invoices to approvers
│   ├── anomalyAgent.js        ← Flags suspicious invoices (6 anomaly types)
│   ├── supplierAgent.js       ← Supplier notification logic
│   ├── erpSyncAgent.js        ← Pulls paid/voided status FROM Oracle back to Billtiq
│   ├── notificationAgent.js   ← Webhooks + email notifications
│   └── uploads/               ← Temp PDF storage (multer)
├── frontend/
│   ├── public/
│   │   ├── landing.html       ← Marketing site (billtiq.com)
│   │   ├── privacy.html, terms.html, security.html
│   ├── src/                   ← React app (the actual product at /app)
│   ├── index.html             ← Vite entry for React app
│   └── vercel.json            ← Routes config; / → landing.html
└── .gitignore                 ← node_modules, .env, dist
```

---

## Commands

```bash
# Backend (run from backend/)
node server.js                  # Starts Express on PORT 3001

# Frontend dev (run from frontend/)
npm run dev                     # Vite dev server

# Deploy (auto on git push to main)
git push                        # Vercel rebuilds frontend, Render rebuilds backend
```

⚠️ **There is no staging / test environment.** Every `git push` to `main` deploys
straight to production. No dev → staging → prod promotion. No automated tests run.
This is a known gap (see SDLC audit item #11). Before pushing any non-trivial change:
test locally with `node server.js`, run the change through manually, and only then push.

No CI/CD yet. No automated tests yet. Both are in the roadmap.

---

## Critical Rules

- **NEVER hardcode credentials.** Use `process.env.*`. Anthropic key, Resend key, Supabase
  service key, and ERP credentials all live in Render env vars.
- **NEVER commit `node_modules/`.** This broke Vercel for weeks (May 2026) because the
  vite binary lost its +x permission on Linux. `.gitignore` now prevents this.
- **NEVER deploy code that requires a file not yet committed.** This broke Render
  (`Cannot find module './lib/crypto'`) when encryption was partially staged.
- **Oracle is the only LIVE ERP.** Do not change landing page copy to claim others are
  live. Marketing honesty is a hard rule — we just did a full rewrite to remove overclaims.
- **Extraction prompt changes need testing.** No automated suite exists yet, but at
  minimum: re-run against a known invoice PDF and verify fields match expected output
  before pushing.
- **Plan before coding.** For any non-trivial feature, write the plan in chat first,
  get agreement, then implement. The user is non-technical and needs to see the plan
  before code lands.

---

## Conventions

- **API responses:** `{ success: true, data }` on success, `{ error: "..." }` on failure.
  Status codes matter (400 validation, 401 auth, 404 not found, 500 internal).
- **Defensive input handling:** All user-facing endpoints validate required fields,
  cap string lengths, strip `<>`. See `/api/demo-request` for the pattern.
- **Logging:** `console.log("[module-name] message", data)` — these show up in Render
  logs and are how we debug prod.
- **Email sending:** Use `sendEmail({ to, subject, html })`. Try Resend, fall back to
  Gmail SMTP. Never let email-provider failure break the user-facing request.
- **Encryption (planned, parked):** AES-256-GCM, `v1:` prefix. Code is in artifacts
  but NOT deployed. Blocked on Oracle pod login. See memory #14.

---

## Critical Context

### Oracle Fusion integration

- **Supplier resolution is dynamic.** `findMatchingSupplierSite()` extracts ZIP +
  street number from Oracle's concatenated `Address` string. Strong-match requires both
  to equal. Falls back to primary pay site if no match.
- **Field names that took forever to figure out:** `SupplierSite`, `ProcurementBU`,
  `SitePurposePayFlag`, `SitePurposePrimaryPayFlag`. Don't rename these.
- **PDF attachment payload is narrow:** Only `Title`, `FileName`, `FileContents`
  (base64). Oracle rejects `CategoryName`, `DatatypeCode`, `ContentRepositoryFileShared`.
- **`erp_reference` in DB = real Oracle InvoiceId** (pattern `ORA-30000...`). Not
  the Billtiq internal ID.
- **Hard-coded fallback values still exist** in `oracle.js` as safety net. Don't
  remove until first paying customer is stable.
- **Pod URL:** `https://fa-euth-dev20-saasfademo1.ds-fa.oraclepdemos.com` — this is
  a temporary Oracle-provided demo instance used only for development and prospect
  demos. It refreshes regularly and wipes user accounts. **NOT production.** Real
  customers will connect via their own Oracle Fusion instance with their own
  credentials. If login fails, contact the pod provisioner; it's not a code bug.

### Supabase

- **RLS NOT enabled on `invoices` and `invoice_comments`.** Frontend queries these
  with anon key (grandfathered safe). Before first paying customer, MUST enable RLS —
  anon-key holders can currently query all teams' data via raw HTTP. (Memory #6)
- **Confirm email is OFF** (intentional). Invite-only model gates real access via
  `team_members` table. No `/auth/callback` page needed.
- **Ghost-user audit:** Weekly, check `auth.users` rows with no matching `team_members`
  entry. Cold Google OAuth signups accumulate. If 10+/week, lock down Google OAuth.
- **After Oct 30 2026:** New tables need explicit GRANTs for Data API access.

### Anomaly agent (`anomalyAgent.js`)

6 active anomaly types. A 7th (payment-terms mismatch) is coded but NOT shipped —
only in artifacts, uncommitted. Touches 3 files; revisit when first real customer
shows actual mismatches. (Memory #9)

### ERP Sync Agent (`erpSyncAgent.js`)

- Filter is `ORA-%` (not `ERP-%`).
- Looks up by `InvoiceId`, not `InvoiceNumber`.
- Oracle status fields: `ValidationStatus` + `PaidStatus` + `CanceledFlag` (not
  `InvoiceStatus`).
- Values: `Paid` / `Validated` (capitalized).
- `last_synced_at` column (not `erp_sync_at`).
- QuickBooks sync is stubbed pending OAuth.
- **Will need `decrypt()` calls** once encryption #6 deploys.

### Landing page (`frontend/public/landing.html`)

- Inline demo form posts to `/api/demo-request` on the Render backend.
- Backend URL resolved via `<meta name="api-base" content="...">` tag (required
  because billtiq.com on Vercel and backend on Render are different domains).
- Cal.com integration REMOVED as of May 17 2026.
- 5 medium-severity copy issues still need fixing: pricing tier mentions non-LIVE
  ERPs, multi-language section untested, "5 min connect" overstated, supplier portal
  language implies non-existent feature, /security page unaudited.

---

## What's NOT in this codebase yet (known gaps)

These are documented so future-you doesn't waste time looking:

- ❌ No automated tests (extraction, ERP push, anomaly logic)
- ❌ No CI/CD pipeline (push = deploy with zero gates)
- ❌ **No staging or test environment.** Production is the only environment.
  Every git push deploys to billtiq.com (frontend) and the Render backend (prod).
  Acceptable while solo + invite-only; mandatory to fix before first paying customer.
- ❌ No status page or uptime monitoring
- ❌ No secrets manager (env vars only)
- ❌ ERP credentials in plaintext in Supabase (encryption #6 parked)
- ❌ No RLS on `invoices` / `invoice_comments`
- ❌ No ADR log (this file is the closest thing)

See the SDLC audit PDF for the full prioritized list.

---

## Key past decisions (mini-ADRs)

- **Invite-only via `team_members` table** (May 9 2026) — gates real product access
  without requiring Supabase email confirmation. Tradeoff: cold OAuth signups create
  ghost rows that need weekly audit.
- **Resend over SendGrid** — cheaper, simpler API, `notifications@billtiq.com`
  domain verified.
- **Removed Cal.com from landing page** (May 17 2026) — inline form gives more control
  over lead data and routes directly to founder inbox.
- **Encryption parked, not abandoned** (May 17 2026) — code complete, deployment
  blocked on Oracle pod login restoration. Key: see memory #14.
- **Hard-coded Oracle fallbacks kept** (May 14 2026) — safety net for first prospect.
  Remove only after a real customer integration is stable.

---

## Encryption (SHIPPED May 19 2026)

- **AES-256-GCM** for ERP credentials. Implementation: `backend/lib/crypto.js`
- `encrypt()` on save, `decrypt()` on read, with passthrough for legacy plaintext values (no `v1:` prefix)
- `ENCRYPTION_KEY` env var on Render (64-char hex, never in git)
- `server.js` boot-time `assertKeyConfigured()` fails fast if key missing
- Migration script: `backend/scripts/encrypt-erp-credentials.js` (dry-run by default, `--apply` to commit)
- Verified via Supabase: passwords show `v1:...` prefix in `erp_connections` table

## Oracle pod gotcha (learned May 19 2026)

- **HTTP 401 on Oracle API but web UI works fine = password issue, not roles.**
- When pod gets refreshed and you do a "forgot password" reset, the new password sometimes only updates web UI auth, not REST API Basic Auth.
- **Fix: reset password again to a simple alphanumeric** (no special chars), then update Billtiq's stored credentials via Settings → ERP → Disconnect → Reconnect.
- Don't chase role/permission fixes when the symptom is 401 (Forbidden = 403 would be the role issue).
- Pod URLs change between provisions. Previously `fa-euth-dev20`, now `fa-eseb-dev24`. Always read from `erp_connections.base_url`, never hardcode.


---

## RLS status (verified May 20 2026)

**RLS is ALREADY enabled on production.** Memory previously claimed RLS was off — this was incorrect.

Verified via SQL queries on prod (cwsubqfynnntrzfshldy):
- invoices.rowsecurity = true
- invoice_comments.rowsecurity = true
- 27 policies exist across the public schema

Policies on invoices: Users can view/insert/update/delete own invoices (by user_id); Team members can view/update team invoices (by team_id); Admins can delete team invoices.

Policies on invoice_comments: invoice_comments_select/insert/update/delete.

Note: invoices has BOTH user_id (NOT NULL) and team_id (nullable) — legacy + team patterns coexist. New inserts should set both.

## Staging status (May 20 2026)

Supabase staging project exists at aosgfxbmaupsccfvwovv.supabase.co (us-east-1).
- Created with secure defaults (Data API ON, auto-expose-tables OFF, auto-RLS OFF)
- Supabase CLI installed locally (v2.100.1)
- Schema dump blocked by Docker Desktop dependency
- Decision: parked. RLS testable on prod safely via service-role-bypass + one-line rollback. Revisit post-customer #1.
- Note: supabase-schema.sql in repo root is OUTDATED (36 lines, only invoices table). Do not use as source of truth.

## Hard-learned lesson (May 20 2026)

**Always verify current state with SQL queries before applying changes.**

Spent 90+ minutes setting up staging to safely test RLS — only to discover RLS was already enabled. A 30-second SQL query at the start would have saved 90 minutes.

Run these diagnostic queries BEFORE any schema/policy change:
- Check RLS: SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public';
- List policies: SELECT tablename, policyname, cmd FROM pg_policies WHERE schemaname='public';
- Inspect table: SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='TABLE_NAME';
