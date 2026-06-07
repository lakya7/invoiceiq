# Supabase service_role Key Rotation — Safe Runbook

**Status: RESEARCH / PLAN ONLY. Nothing here has been executed. Do not run any step until you've read the whole doc and decided on a path.**

Context: the legacy `service_role` JWT key was exposed and must be rotated. This project is
still on the **legacy JWT-based key system** (dashboard shows `anon` + `service_role` as JWTs,
with a "Disable JWT-based API keys" button and a nudge toward the new Secret API keys).

---

## TL;DR — the one fact that drives everything

**On the legacy system, `anon` and `service_role` are the same coin.** Both are JWTs signed by
the project's single JWT secret. You **cannot** revoke the exposed `service_role` in isolation:

- **Disabling legacy JWT keys** disables **both** `anon` and `service_role` at once.
- **Regenerating the legacy JWT secret** invalidates **both** `anon` and `service_role` at once.

So no matter which path you take, fully neutralizing the exposed `service_role` will also affect
the `anon` key the frontend depends on. The two viable paths differ only in *how much downtime*
and *how much future flexibility* you get:

| Path | Downtime | Future rotation | Recommended? |
|---|---|---|---|
| **A. Migrate to new API keys** (publishable + secret) | **Zero** (keys coexist; flip one at a time, disable legacy last) | Granular — revoke one secret key without touching anything else | ✅ **Yes** |
| **B. Regenerate legacy JWT secret** | Hard cutover; brief outage; may not even be offered on your project | Same coupled problem next time | ⚠️ Fallback only |

> Note on severity: the **`anon` key is public by design** — it's baked into the frontend JS
> bundle and shipped to every browser; RLS is what protects it. Its "exposure" is not an
> incident. The real incident is the **`service_role`** key, which **bypasses RLS** and has full
> DB access. The whole urgency here is about the `service_role` key; the `anon` key only enters
> the picture because the legacy system couples them.

---

## Is a new **Secret** key a clean drop-in for `SUPABASE_SERVICE_KEY`?

**For this backend: yes.** The backend uses `createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)`
and talks to the Data API / PostgREST. A new secret key (`sb_secret_...`):

- Works directly as the key argument to `createClient(...)` — no code change beyond the env value.
- Has the same privileged, **RLS-bypassing** access that `service_role` had.
- Adds a safety property: it returns **HTTP 401 if ever used from a browser**, so it can't be
  misused client-side.

**Caveats (don't apply to this backend's current usage, but know them):** new secret keys are
**not JWTs**, so anywhere a raw JWT was expected they must be passed on the **`apikey` header**,
not `Authorization: Bearer`:

- **Database Webhooks / `pg_net`** — if any are configured to call back with the service key in
  `Authorization: Bearer`, they'll get rejected; switch them to the `apikey` header.
- **Supabase Edge Functions** — a secret key in `Authorization: Bearer` gets parsed as a JWT and
  rejected; use the `apikey` header instead.

This repo's backend doesn't use Edge Functions and reads the key only via `supabase-js`, so the
secret key is a true drop-in for `SUPABASE_SERVICE_KEY`. (Verify no Database Webhooks/`pg_net`
jobs in the Supabase project rely on the service key in a Bearer header before disabling legacy.)

---

## Where each key lives (every place to update)

| Key | Env var | Production location | Local file |
|---|---|---|---|
| service_role / secret | `SUPABASE_SERVICE_KEY` | **Render** env vars (backend) | `backend/.env` |
| anon / publishable | `VITE_SUPABASE_ANON_KEY` | **Vercel** env vars (frontend) | `frontend/.env` |
| project URL (unchanged) | `SUPABASE_URL` / `VITE_SUPABASE_URL` | Render + Vercel | both `.env` files |

Two deploy-mechanics facts that affect sequencing:

1. **Render** picks up an env-var change only on **restart/redeploy**. A running process keeps the
   old key in memory until it reboots. (Same gotcha as the Anthropic key rotation.)
2. **Vercel + Vite**: `VITE_*` vars are **inlined into the JS bundle at build time** and shipped
   to browsers. Changing `VITE_SUPABASE_ANON_KEY` requires a **rebuild + redeploy**, and browsers
   holding a **cached old bundle** keep using the **old** anon key until they reload. This is
   exactly why you want the old/legacy anon key to **stay valid** until all clients have the new
   bundle — which Path A gives you and Path B does not.

---

## Path A — Migrate to new API keys (RECOMMENDED, zero downtime)

New and legacy keys **work simultaneously**. You add the new keys, swap clients one at a time,
verify each, and disable the legacy keys **only at the very end**. The exposed legacy
`service_role` remains technically valid until that final step — accepted risk for a short,
controlled window, in exchange for zero downtime.

> If you want to minimize the exposure window instead of downtime, you can do steps 1–4 (backend
> onto a secret key) immediately, then schedule the frontend swap + legacy disable. But remember:
> the exposed `service_role` is **not actually revoked** until step 7. There is no way to revoke
> just it on the legacy system.

### Step 1 — Create the new keys (dashboard, no impact yet)
- In Supabase → Project Settings → API Keys, opt in / create the **publishable** key
  (`sb_publishable_...`) and a **secret** key (`sb_secret_...`). Created under name `default`.
- Optionally create the secret key with a descriptive name (e.g. `backend-render`) so you can
  rotate it independently later. Legacy `anon`/`service_role` keep working untouched.

### Step 2 — Swap the backend (Render) to the secret key
- Update **Render** env var `SUPABASE_SERVICE_KEY` = the new `sb_secret_...` value.
- Trigger a redeploy/restart so the new value is actually loaded (Render restarts on env change;
  confirm the deploy log shows a boot **after** the change).

### Step 3 — CONFIRM the backend works on the secret key (before anything is revoked)
- Exercise a backend action that uses the service key against the DB (e.g. an invoice
  read/write, or an Operations agent run that hits `operations_tasks`).
- Confirm success in Render logs. If it fails, the legacy service_role is still valid — revert
  the Render var and investigate. **Do not proceed until this passes.**

### Step 4 — Update local `backend/.env`
- Set `SUPABASE_SERVICE_KEY` = the new `sb_secret_...` in `backend/.env` (git-ignored).
- Reminder: local backend hits **PROD** data with this key — see
  `memory/local-backend-hits-prod.md`.

### Step 5 — Swap the frontend (Vercel) to the publishable key
- Update **Vercel** env var `VITE_SUPABASE_ANON_KEY` = the new `sb_publishable_...` value.
- **Redeploy/rebuild** the frontend (Vite inlines it at build time — an env change without a
  rebuild does nothing).
- Update local `frontend/.env` `VITE_SUPABASE_ANON_KEY` to match.

### Step 6 — CONFIRM the frontend works on the publishable key
- Load billtiq.com (hard refresh / clear cache to get the new bundle), sign in, exercise a
  read that depends on RLS via the anon/publishable key.
- Because legacy `anon` is still valid, any user still on a cached old bundle keeps working —
  no rush, no breakage. Wait until you're satisfied all live clients are on the new bundle.

### Step 7 — Disable legacy JWT-based API keys (THE revoke step)
- Only after steps 3 and 6 both pass: in the dashboard, **"Disable JWT-based API keys."**
- This rejects **both** the legacy `service_role` (the exposed key — now neutralized) **and** the
  legacy `anon` (already replaced by publishable). This action is **reversible** (re-enable) if
  something was missed.
- This is the moment the exposed key actually stops working. Nothing should depend on legacy keys
  by now.

### Step 8 — Final verification
- Re-run a backend action and a frontend action. Confirm Supabase logs show traffic only on the
  new keys. Optionally re-enable-then-disable test is unnecessary; leave legacy disabled.

**Future rotations are now easy:** delete a secret key to revoke it instantly, create a
replacement, swap the one env var — no coupling to the frontend ever again.

---

## Path B — Regenerate the legacy JWT secret (FALLBACK; downtime; may be unavailable)

Use only if you explicitly do not want to migrate. Note Supabase has been **removing legacy JWT
secret rotation** from projects; the button may not be present. If it is:

- Regenerating the JWT secret **immediately invalidates both** `anon` and `service_role` and
  issues new JWTs for both. Every connection using the old keys is severed at once — **hard
  cutover with an outage window**.
- You must update **all four** locations in quick succession and redeploy both apps:
  - Render `SUPABASE_SERVICE_KEY` = new service_role JWT → restart backend.
  - Vercel `VITE_SUPABASE_ANON_KEY` = new anon JWT → **rebuild** frontend.
  - `backend/.env` and `frontend/.env` to match.
- Because there's no coexistence period, there's an unavoidable gap where live requests fail
  until both deploys finish and caches refresh. And you'll have the same coupled problem at the
  next rotation.

This path fully revokes the exposed `service_role` the instant you regenerate — but at the cost
of downtime and no future flexibility. **Prefer Path A** unless forced.

---

## Confirm-before-revoke checklist (applies to Path A)

1. [ ] New publishable + secret keys created; legacy still enabled.
2. [ ] Render `SUPABASE_SERVICE_KEY` = new secret; backend restarted **after** the change.
3. [ ] Backend DB action verified working on the secret key (Render logs).
4. [ ] `backend/.env` updated to the secret key.
5. [ ] Vercel `VITE_SUPABASE_ANON_KEY` = new publishable; frontend **rebuilt**.
6. [ ] `frontend/.env` updated; billtiq.com verified on a fresh bundle.
7. [ ] No Database Webhooks / `pg_net` / Edge Functions rely on the service key via
       `Authorization: Bearer` (they'd need the `apikey` header with a secret key).
8. [ ] **Only now:** Disable JWT-based API keys → exposed `service_role` neutralized.
9. [ ] Post-revoke smoke test of backend + frontend; logs show new keys only.

---

## Sources

- [Migrating to publishable and secret API keys — Supabase Docs](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys)
- [Understanding API keys — Supabase Docs](https://supabase.com/docs/guides/api/api-keys)
- [JWT Signing Keys — Supabase Docs](https://supabase.com/docs/guides/auth/signing-keys)
- [Upcoming changes to Supabase API Keys — Discussion #29260](https://github.com/orgs/supabase/discussions/29260)
- [Use of new API keys — Discussion #40300](https://github.com/orgs/supabase/discussions/40300)
- [Introducing JWT Signing Keys — Supabase Blog](https://supabase.com/blog/jwt-signing-keys)
