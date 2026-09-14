// Negative tenant-isolation tests for the /api auth layer.
//
// Runs against a REAL Supabase project (staging — never prod). It boots
// server.js with AUTH_ENFORCE=on on a random port, creates two users + two
// teams with the service-role key, signs each user in to get a JWT, and proves
// that cross-tenant requests are refused.
//
//   SUPABASE_URL=https://<staging>.supabase.co \
//   SUPABASE_SERVICE_KEY=... SUPABASE_ANON_KEY=... \
//   node --test test/
//
// All rows it creates are prefixed "authtest-" and removed afterwards.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const crypto = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !SUPABASE_ANON_KEY) {
  throw new Error("SUPABASE_URL, SUPABASE_SERVICE_KEY and SUPABASE_ANON_KEY are required (staging project)");
}
if (/cwsubqfynnntrzfshldy/.test(SUPABASE_URL)) throw new Error("Refusing to run tests against production");

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 4100 + Math.floor(Math.random() * 500);
const API = `http://127.0.0.1:${PORT}`;
const run = crypto.randomBytes(4).toString("hex");

let server;
const ctx = { a: {}, b: {} }; // per tenant: user, token, team, invoice

async function makeUser(tag) {
  const email = `authtest-${run}-${tag}@example.com`;
  const password = crypto.randomBytes(12).toString("hex") + "Aa1!";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: s, error: e2 } = await anon.auth.signInWithPassword({ email, password });
  if (e2) throw e2;
  return { id: data.user.id, email, token: s.session.access_token };
}

async function makeTeam(user, tag) {
  const { data: team, error } = await admin.from("teams").insert({ name: `authtest-${run}-${tag}`, slug: `authtest-${run}-${tag}`, owner_id: user.id }).select().single();
  if (error) throw error;
  const { error: e2 } = await admin.from("team_members").insert({
    team_id: team.id, user_id: user.id, email: user.email, role: "admin", status: "active", joined_at: new Date().toISOString(),
  });
  if (e2) throw e2;
  const { data: inv, error: e3 } = await admin.from("invoices").insert({
    user_id: user.id, team_id: team.id, vendor_name: `authtest-${tag}`, invoice_number: `AT-${run}-${tag}`, total: 10, status: "pending",
  }).select().single();
  if (e3) throw e3;
  return { team, invoice: inv };
}

function call(method, url, token, body) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers["Content-Type"] = "application/json";
  return fetch(`${API}${url}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

before(async () => {
  server = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(PORT),
      AUTH_ENFORCE: "on",
      AUTH_MEMBERSHIP_CACHE_MS: "0",
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString("hex"),
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "test",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write(d));
  const ready = new Promise((res, rej) => {
    server.stdout.on("data", (d) => { if (String(d).includes("backend on port")) res(); });
    server.on("exit", (c) => rej(new Error(`server exited early (${c})`)));
  });
  await Promise.race([ready, new Promise((_, rej) => setTimeout(() => rej(new Error("server boot timeout")), 20000))]);

  ctx.a.user = await makeUser("a");
  ctx.b.user = await makeUser("b");
  Object.assign(ctx.a, await makeTeam(ctx.a.user, "a"));
  Object.assign(ctx.b, await makeTeam(ctx.b.user, "b"));
}, { timeout: 60000 });

after(async () => {
  if (server) server.kill();
  for (const t of [ctx.a, ctx.b]) {
    if (t.team) {
      await admin.from("invoices").delete().eq("team_id", t.team.id);
      await admin.from("team_members").delete().eq("team_id", t.team.id);
      await admin.from("subscriptions").delete().eq("team_id", t.team.id);
      await admin.from("teams").delete().eq("id", t.team.id);
    }
    if (t.user) await admin.auth.admin.deleteUser(t.user.id);
  }
});

test("health endpoint stays public", async () => {
  const r = await fetch(`${API}/health`);
  assert.equal(r.status, 200);
});

test("unauthenticated request to /api is rejected with 401", async () => {
  const r = await call("GET", `/api/teams/${ctx.a.team.id}/members`);
  assert.equal(r.status, 401);
});

test("garbage bearer token is rejected with 401", async () => {
  const r = await call("GET", `/api/teams/${ctx.a.team.id}/members`, "not-a-jwt");
  assert.equal(r.status, 401);
});

test("member can read own team", async () => {
  const r = await call("GET", `/api/teams/${ctx.a.team.id}/members`, ctx.a.user.token);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(body.members.some((m) => m.user_id === ctx.a.user.id));
});

test("Buyer A cannot read Buyer B's team members (403)", async () => {
  const r = await call("GET", `/api/teams/${ctx.b.team.id}/members`, ctx.a.user.token);
  assert.equal(r.status, 403);
});

test("Buyer A cannot list teams for Buyer B's userId (403)", async () => {
  const r = await call("GET", `/api/teams/user/${ctx.b.user.id}`, ctx.a.user.token);
  assert.equal(r.status, 403);
});

test("client-supplied teamId in body cannot target another tenant (403)", async () => {
  const r = await call("POST", `/api/teams/${ctx.b.team.id}/invite`, ctx.a.user.token, {
    email: "x@example.com", role: "member", invitedBy: ctx.a.user.id,
  });
  assert.equal(r.status, 403);
});

test("client-supplied userId cannot impersonate another user (403)", async () => {
  const r = await call("POST", `/api/check-duplicate`, ctx.a.user.token, {
    invoiceNumber: "x", teamId: ctx.a.team.id, userId: ctx.b.user.id,
  });
  assert.equal(r.status, 403);
});

test("Buyer A cannot read Buyer B's invoice audit trail (403)", async () => {
  const r = await call("GET", `/api/invoices/${ctx.b.invoice.id}/audit`, ctx.a.user.token);
  assert.equal(r.status, 403);
});

test("Buyer A cannot mark Buyer B's invoice paid (403) and it stays unchanged", async () => {
  const r = await call("POST", `/api/invoices/${ctx.b.invoice.id}/mark-paid`, ctx.a.user.token, { userId: ctx.a.user.id });
  assert.equal(r.status, 403);
  const { data } = await admin.from("invoices").select("status").eq("id", ctx.b.invoice.id).single();
  assert.equal(data.status, "pending");
});

test("member can read own invoice audit trail", async () => {
  const r = await call("GET", `/api/invoices/${ctx.a.invoice.id}/audit`, ctx.a.user.token);
  assert.equal(r.status, 200);
});

test("non-existent invoice returns 404, not data", async () => {
  const r = await call("GET", `/api/invoices/${crypto.randomUUID()}/audit`, ctx.a.user.token);
  assert.equal(r.status, 404);
});

test("revoked member loses access to team data (403)", async () => {
  // the app removes members by deleting the row (DELETE /api/teams/:teamId/members/:memberId)
  const { error } = await admin.from("team_members").delete().eq("team_id", ctx.a.team.id).eq("user_id", ctx.a.user.id);
  assert.ifError(error);
  const r = await call("GET", `/api/teams/${ctx.a.team.id}/members`, ctx.a.user.token);
  assert.equal(r.status, 403);
});

test("pending (not yet accepted) member has no access (403)", async () => {
  const { error } = await admin.from("team_members").insert({
    team_id: ctx.a.team.id, user_id: ctx.a.user.id, email: ctx.a.user.email, role: "admin", status: "pending",
  });
  assert.ifError(error);
  const r = await call("GET", `/api/teams/${ctx.a.team.id}/members`, ctx.a.user.token);
  assert.equal(r.status, 403);
});
