// Request authentication + tenant authorization for the Express API.
//
// The backend talks to Supabase with the service-role key, which bypasses RLS.
// Every /api route therefore has to establish WHO is calling and WHICH team they
// belong to from a verified Supabase access token — never from ids in the URL
// or body, which anyone can type.
//
// Rollout is controlled by AUTH_ENFORCE:
//   "off"    – (default) nothing is blocked; requests are still inspected and any
//              violation is logged as "[auth] shadow ..." so we can see what would
//              break before flipping the switch.
//   "on"     – missing/invalid token → 401, tenant mismatch → 403.
//
// Frontend must send `Authorization: Bearer <supabase access token>`; see
// frontend/src/api.js.

const PUBLIC_PATHS = [
  /^\/api\/demo-request$/,
  /^\/api\/support$/,
  /^\/api\/billing\/webhook$/,
  /^\/api\/erp\/[a-z]+\/callback$/,
  /^\/api\/agent\/email\/gmail\/callback$/,
];

// app-level middleware runs before route matching, so req.params is empty;
// tenant ids embedded in the path are recovered from these patterns instead.
const UUID = "([0-9a-fA-F-]{36})";
const PATH_TEAM_ID = [
  new RegExp(`^/api/teams/${UUID}(/|$)`),
  new RegExp(`^/api/(?:pos|billing|billing/check|erp/[a-z]+/auth|erp/[a-z]+/status|erp/connections|agent/settings|agent/email|operations|debug/email-log|distribution-defaults)/${UUID}$`),
];
const PATH_USER_ID = [
  new RegExp(`^/api/(?:teams/user|settings|notifications/settings)/${UUID}$`),
];

function idFromPath(path, patterns) {
  for (const re of patterns) {
    const m = re.exec(path);
    if (m) return m[1];
  }
  return null;
}

function enforcing() {
  return (process.env.AUTH_ENFORCE || "off").toLowerCase() === "on";
}

function isPublic(path) {
  return PUBLIC_PATHS.some((re) => re.test(path));
}

// req.path is relative to the mount point inside app.use("/api", ...)
function fullPath(req) {
  return ((req.baseUrl || "") + req.path).split("?")[0];
}

function bearerToken(req) {
  const h = req.headers.authorization || "";
  const [scheme, token] = h.split(" ");
  return scheme === "Bearer" && token ? token : null;
}

function deny(req, res, status, message) {
  if (enforcing()) return res.status(status).json({ error: message });
  console.warn(`[auth] shadow ${status} ${req.method} ${fullPath(req)}: ${message}`);
  return null;
}

/**
 * Build the middleware set bound to a Supabase service-role client.
 */
function createAuth(supabase) {
  const membershipCache = new Map(); // `${userId}:${teamId}` → { role, exp }
  const CACHE_MS = Number(process.env.AUTH_MEMBERSHIP_CACHE_MS ?? 30 * 1000);

  async function getMembership(userId, teamId) {
    const key = `${userId}:${teamId}`;
    const hit = membershipCache.get(key);
    if (CACHE_MS > 0 && hit && hit.exp > Date.now()) return hit.role;
    const { data } = await supabase
      .from("team_members")
      .select("role")
      .eq("team_id", teamId)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    const role = data?.role || null;
    membershipCache.set(key, { role, exp: Date.now() + CACHE_MS });
    return role;
  }

  function clearMembershipCache() {
    membershipCache.clear();
  }

  /**
   * Verifies the bearer token and sets req.user = { id, email }.
   * Public paths pass through untouched.
   */
  async function authenticate(req, res, next) {
    if (isPublic(fullPath(req))) return next();
    const token = bearerToken(req);
    if (!token) {
      const r = deny(req, res, 401, "Missing Authorization bearer token");
      return r || next();
    }
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
      const r = deny(req, res, 401, "Invalid or expired token");
      return r || next();
    }
    req.user = { id: data.user.id, email: data.user.email };
    return next();
  }

  /**
   * Generic tenant check applied to every /api route after authenticate.
   *  - if the request names a userId (params/body/query) it must equal req.user.id
   *  - if the request names a teamId, req.user must be an active member
   * Routes that identify the tenant indirectly (e.g. by invoiceId) use the
   * resource-specific guards below.
   */
  async function enforceTenantParams(req, res, next) {
    if (isPublic(fullPath(req)) || !req.user) return next();
    const path = fullPath(req);
    const src = { ...(req.query || {}), ...(req.body || {}), ...(req.params || {}) };

    const userId = idFromPath(path, PATH_USER_ID) || src.userId || src.user_id;
    if (userId && userId !== req.user.id) {
      const r = deny(req, res, 403, `userId ${userId} does not match token user`);
      if (r) return r;
    }

    const teamId = idFromPath(path, PATH_TEAM_ID) || src.teamId || src.team_id;
    if (teamId) {
      const role = await getMembership(req.user.id, teamId);
      if (!role) {
        const r = deny(req, res, 403, `user is not an active member of team ${teamId}`);
        if (r) return r;
      }
      req.teamRole = role;
    }
    return next();
  }

  /**
   * Route guard: caller must be an active member of the team identified by
   * `getTeamId(req)`; optionally restricted to specific roles.
   */
  function requireTeam(getTeamId, roles) {
    return async (req, res, next) => {
      if (!req.user) {
        const r = deny(req, res, 401, "Not authenticated");
        return r || next();
      }
      const teamId = getTeamId(req);
      if (!teamId) {
        const r = deny(req, res, 400, "teamId required");
        return r || next();
      }
      const role = await getMembership(req.user.id, teamId);
      if (!role) {
        const r = deny(req, res, 403, `user is not an active member of team ${teamId}`);
        return r || next();
      }
      if (roles && !roles.includes(role)) {
        const r = deny(req, res, 403, `role ${role} not permitted (needs ${roles.join("/")})`);
        return r || next();
      }
      req.teamRole = role;
      return next();
    };
  }

  /**
   * Route guard for /api/invoices/:invoiceId/*: caller must own the invoice or
   * be an active member of its team. Sets req.invoice = { id, team_id, user_id }.
   */
  async function requireInvoiceAccess(req, res, next) {
    if (!req.user) {
      const r = deny(req, res, 401, "Not authenticated");
      return r || next();
    }
    const { data: inv } = await supabase
      .from("invoices")
      .select("id, team_id, user_id")
      .eq("id", req.params.invoiceId)
      .maybeSingle();
    if (!inv) {
      if (enforcing()) return res.status(404).json({ error: "Invoice not found" });
      return next();
    }
    let ok = inv.user_id === req.user.id;
    if (!ok && inv.team_id) ok = !!(await getMembership(req.user.id, inv.team_id));
    if (!ok) {
      const r = deny(req, res, 403, `no access to invoice ${inv.id}`);
      return r || next();
    }
    req.invoice = inv;
    return next();
  }

  /**
   * Route guard for rows addressed by their own id in a team-scoped table.
   */
  function requireRowInTeam(table, idParam = "id") {
    return async (req, res, next) => {
      if (!req.user) {
        const r = deny(req, res, 401, "Not authenticated");
        return r || next();
      }
      const { data: row } = await supabase
        .from(table)
        .select("id, team_id")
        .eq("id", req.params[idParam])
        .maybeSingle();
      if (!row) {
        if (enforcing()) return res.status(404).json({ error: "Not found" });
        return next();
      }
      const role = row.team_id ? await getMembership(req.user.id, row.team_id) : null;
      if (!role) {
        const r = deny(req, res, 403, `no access to ${table}/${row.id}`);
        return r || next();
      }
      req.teamRole = role;
      return next();
    };
  }

  return {
    authenticate,
    enforceTenantParams,
    requireTeam,
    requireInvoiceAccess,
    requireRowInTeam,
    clearMembershipCache,
    enforcing,
  };
}

module.exports = { createAuth, isPublic, PUBLIC_PATHS };
