import type { Context } from "hono";
import {
  Prisma,
  type PrismaClient,
  hasScope,
  ROLES,
  SCOPE_TYPES,
  type Role,
  type ScopeType,
} from "@admitto/db";
import {
  canManageInstance,
  createUser,
  findUserByEmail,
  hashPassword,
  isPasswordTooCommon,
  isValidEmailFormat,
  passwordTooCommonJsonBody,
  normalizeEmail,
  PASSWORD_MIN_LENGTH,
  resetUserMfa,
  revokeAllTrustedDevicesForUser,
  revokeUserAuthState,
  userHasConfirmedTotp,
} from "@admitto/auth";
import { writeAdminAuditLog, type OpsAuditContext } from "@admitto/tickets";
import { emitSystemLog } from "@admitto/shared/system-log";
import {
  adminAuditFromContext,
  positiveIntQuery,
  resolveActorEmailForLog,
} from "./admin-helpers.js";
import { withStepUpGate } from "./account-routes.js";
import type { RateLimitStore } from "../rate-limit/types.js";
import { resolveInstanceOrganizationId } from "./instance-org.js";
import { runSerializableTransaction } from "./event-items-api-routes.js";
import {
  assertLastSuperadminDeactivationAllowed,
  assertLastSuperadminDeleteAllowed,
  assertLastSuperadminRemovalAllowed,
  LastSuperadminError,
} from "./users-lockout-guards.js";

async function requireSuperadmin(c: Context, db: PrismaClient): Promise<Response | null> {
  const auth = c.get("auth");
  if (!(await canManageInstance(db, auth.userId))) return c.json({ error: "forbidden" }, 403);
  return null;
}

/** True when an admin-assisted MFA/password reset of `targetId` must step up the ACTOR beyond
 * the ordinary requireSuperadmin gate: resetting another superadmin's credentials, not their
 * own. Without this, a compromised superadmin session (phished cookie, XSS, stolen device, a
 * malicious insider) could silently strip any OTHER superadmin's MFA and set a new password,
 * then sign in as them - a full identity takeover indistinguishable in the audit log from a
 * routine helpdesk reset, and one that never trips the last-superadmin-lockout guard (role
 * assignments never change). Resetting your OWN account this way stays exempt, same as today -
 * you can't use a stolen session to escalate past what that session already grants you. */
async function actorMustStepUpForReset(
  db: PrismaClient,
  actorId: string,
  targetId: string,
): Promise<boolean> {
  if (actorId === targetId) return false;
  return canManageInstance(db, targetId);
}

/** Runs `perform` inside a transaction, requiring the ACTOR to prove themselves with their own
 * TOTP/recovery code first when `requiresStepUp` is true (actorMustStepUpForReset). Deliberately
 * does NOT defer to withStepUpGate's own userRequiresMfaStepUp check for that decision: that
 * check is `userRequiresMfa && userHasConfirmedTotp`, so it silently reads "no confirmed local
 * TOTP" as "step-up not needed" - correct for withStepUpGate's other, self-service callers (an
 * account-routes.ts action about the user's own data, gated by the instance's configurable
 * MFA-required-roles policy), but wrong here: a superadmin actor can reach this endpoint with a
 * fully-privileged SESSION_STAGE.FULL session and zero local TOTP simply by authenticating
 * entirely through OIDC (finalizeOidcLogin never depends on local MFA state), and letting that
 * fall through as "skip" would silently defeat the entire privilege-escalation protection this
 * feature exists to add. So this check is unconditional whenever requiresStepUp is true,
 * independent of the instance's MFA-required-roles setting: an actor with no confirmed TOTP has
 * nothing to step up with and is denied outright (actor_mfa_required) rather than waved through. */
async function runAdminResetWithActorStepUp<T extends { ok: boolean }>(
  c: Context,
  db: PrismaClient,
  rateLimitStore: RateLimitStore,
  params: {
    requiresStepUp: boolean;
    actorUserId: string;
    currentSessionId: string | undefined;
    rawCode: string | undefined;
    rateLimitAction: string;
  },
  perform: (tx: Prisma.TransactionClient, orgId: string, audit: OpsAuditContext) => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; response: Response }> {
  const { requiresStepUp, actorUserId, currentSessionId, rawCode, rateLimitAction } = params;

  if (!requiresStepUp) {
    const orgId = await resolveInstanceOrganizationId(db);
    const audit = adminAuditFromContext(c);
    return { ok: true, value: await db.$transaction((tx) => perform(tx, orgId, audit)) };
  }

  if (!(await userHasConfirmedTotp(db, actorUserId))) {
    return { ok: false, response: c.json({ code: "actor_mfa_required" }, 403) };
  }

  // forceRequired: true - withStepUpGate's own default behavior re-derives "is step-up needed"
  // via userRequiresMfaStepUp (userRequiresMfa && userHasConfirmedTotp), so without this an
  // instance whose configurable mfa_required_roles setting omits "superadmin" would make
  // userRequiresMfa false for this actor and skip requiring/validating rawCode entirely, even
  // though the userHasConfirmedTotp check just above already committed to demanding one.
  return withStepUpGate(
    c,
    db,
    rateLimitStore,
    { userId: actorUserId, currentSessionId, rawCode, rateLimitAction, forceRequired: true },
    perform,
  );
}

/**
 * Shared admin-assisted-reset flow for handlePostResetUserMfa/handlePostResetUserPassword: loads
 * the target, blocks SSO-managed accounts (an SSO-managed account signs in via its identity
 * provider, not a local credential - resetting one here would silently open or modify an
 * unmonitored second sign-in path; unlink the identity provider first if the account needs to go
 * local) - this is a fast pre-check only, `perform` (performResetUserMfa/performResetUserPassword)
 * re-checks the same condition fresh inside its own transaction (TOCTOU) - computes whether the
 * ACTOR must step up (actorMustStepUpForReset) and runs `perform` accordingly
 * (runAdminResetWithActorStepUp - see its own docstring for the actor step-up/fail-closed
 * semantics), then emits the security system log. `rawCode` is resolved by the caller and simply
 * unused here when step-up isn't required.
 */
async function handleAdminAssistedReset<T extends { ok: true } | { ok: false; code: string }>(
  c: Context,
  db: PrismaClient,
  rateLimitStore: RateLimitStore,
  params: {
    id: string;
    rawCode: string | undefined;
    ssoManagedCode: string;
    rateLimitAction: string;
    logAction: string;
  },
  perform: (
    tx: Prisma.TransactionClient,
    orgId: string,
    audit: OpsAuditContext,
    requiresStepUp: boolean,
    actorUserId: string,
  ) => Promise<T>,
): Promise<Response> {
  const { id, rawCode, ssoManagedCode, rateLimitAction, logAction } = params;

  const user = await db.user.findUnique({
    where: { id },
    select: { id: true, email: true, external_identities: { select: { id: true }, take: 1 } },
  });
  if (!user) return c.json({ error: "not_found" }, 404);
  if (user.external_identities.length > 0) return c.json({ code: ssoManagedCode }, 409);

  const auth = c.get("auth");
  const actorUserId = auth.userId;
  const requiresStepUp = await actorMustStepUpForReset(db, actorUserId, id);

  const gated = await runAdminResetWithActorStepUp(
    c,
    db,
    rateLimitStore,
    { requiresStepUp, actorUserId, currentSessionId: auth.sessionId, rawCode, rateLimitAction },
    (tx, orgId, audit) => perform(tx, orgId, audit, requiresStepUp, actorUserId),
  );
  if (!gated.ok) return gated.response;
  const outcome = gated.value;
  if (!outcome.ok) return c.json({ code: outcome.code }, 409);

  emitSystemLog("security", "info", logAction, {
    targetUserId: user.id,
    targetEmail: user.email,
    actorUserId,
    actorEmail: await resolveActorEmailForLog(db, actorUserId),
    ...(requiresStepUp ? { superadminTarget: true } : {}),
  });

  return c.json({ ok: true });
}

async function respondRoleDeleteGone(
  c: Context,
  db: PrismaClient,
  userId: string,
  assignmentId: string,
  actorIsSuperadmin: boolean,
): Promise<Response> {
  const byId = await db.roleAssignment.findUnique({
    where: { id: assignmentId },
    select: { user_id: true },
  });
  if (byId && byId.user_id !== userId) {
    return c.json({ error: "not_found" }, 404);
  }
  if (actorIsSuperadmin) return c.body(null, 204);
  return c.json({ error: "forbidden" }, 403);
}

type UserWithRoles = Prisma.UserGetPayload<{
  include: {
    role_assignments: { include: { oidc_role_grants: { select: { id: true } } } };
    mfa_methods: { select: { id: true; confirmed_at: true } };
    external_identities: { select: { id: true; provider: { select: { display_name: true } } } };
  };
}>;

type SessionStats = { last_login_at: string | null; active_sessions_count: number };

async function sessionStatsForUsers(
  db: PrismaClient,
  userIds: string[],
): Promise<Map<string, SessionStats>> {
  const stats = new Map<string, SessionStats>();
  for (const id of userIds) {
    stats.set(id, { last_login_at: null, active_sessions_count: 0 });
  }
  if (userIds.length === 0) return stats;

  const now = new Date();
  const [latestLogins, activeCounts] = await Promise.all([
    db.session.groupBy({
      by: ["user_id"],
      where: { user_id: { in: userIds } },
      _max: { created_at: true },
    }),
    db.session.groupBy({
      by: ["user_id"],
      where: {
        user_id: { in: userIds },
        revoked_at: null,
        expires_at: { gt: now },
      },
      _count: { _all: true },
    }),
  ]);

  for (const row of activeCounts) {
    const entry = stats.get(row.user_id);
    if (entry) entry.active_sessions_count = row._count._all;
  }

  for (const row of latestLogins) {
    const entry = stats.get(row.user_id);
    if (!entry) continue;
    const latest = row._max.created_at;
    if (latest) entry.last_login_at = latest.toISOString();
  }

  return stats;
}

function serializeUserRow(user: UserWithRoles, sessionStats: SessionStats) {
  return {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    phone_country_code: user.phone_country_code,
    phone_number: user.phone_number,
    is_active: user.is_active,
    must_change_password: user.must_change_password,
    created_at: user.created_at.toISOString(),
    last_login_at: sessionStats.last_login_at,
    active_sessions_count: sessionStats.active_sessions_count,
    has_mfa: user.mfa_methods.some((m) => m.confirmed_at != null),
    has_sso: user.external_identities.length > 0,
    external_identities: user.external_identities.map((ei) => ({
      id: ei.id,
      provider_display_name: ei.provider.display_name,
    })),
    roles: user.role_assignments.map((a) => ({
      id: a.id,
      role: a.role,
      scope_type: a.scope_type,
      scope_id: a.scope_id,
      is_oidc: a.oidc_role_grants.length > 0,
    })),
  };
}

async function serializeUser(db: PrismaClient, user: UserWithRoles) {
  const statsMap = await sessionStatsForUsers(db, [user.id]);
  const stats = statsMap.get(user.id) ?? { last_login_at: null, active_sessions_count: 0 };
  return serializeUserRow(user, stats);
}

const userInclude = {
  role_assignments: { include: { oidc_role_grants: { select: { id: true } } } },
  mfa_methods: { select: { id: true, confirmed_at: true } },
  // No take:1 cap (dropped) - the admin user list/detail need each linked identity's provider
  // name to show, not just whether any exist (PO report: "Identity provider" gave no hint which
  // one, and a Cloudflare Access link was invisible entirely - it's just another row here).
  external_identities: { select: { id: true, provider: { select: { display_name: true } } } },
} as const;

async function loadUser(db: PrismaClient, id: string): Promise<UserWithRoles | null> {
  return db.user.findUnique({ where: { id }, include: userInclude });
}

async function assertRoleGrantAllowed(
  c: Context,
  db: PrismaClient,
  actorId: string,
  role: string,
  scopeType: string,
  scopeId: string | null,
): Promise<Response | null> {
  const actorIsSuperadmin = await canManageInstance(db, actorId);
  if (actorIsSuperadmin) return null;

  if (role !== "operator" || scopeType !== "event" || !scopeId) {
    return c.json({ error: "forbidden" }, 403);
  }

  const event = await db.event.findUnique({
    where: { id: scopeId },
    select: { organization_id: true },
  });
  if (!event) return c.json({ error: "not_found" }, 404);
  if (!(await hasScope(db, actorId, "admin", "organization", event.organization_id))) {
    return c.json({ error: "forbidden" }, 403);
  }
  return null;
}

async function assertRoleRevokeAllowed(
  c: Context,
  db: PrismaClient,
  actorId: string,
  assignment: {
    role: string;
    scope_type: string;
    scope_id: string | null;
  },
): Promise<Response | null> {
  return assertRoleGrantAllowed(c, db, actorId, assignment.role, assignment.scope_type, assignment.scope_id);
}

function parseRoleScope(body: Record<string, unknown>): { role: Role; scopeType: ScopeType; scopeId: string | null } | null {
  const role = typeof body.role === "string" ? body.role : "";
  const scopeType = typeof body.scope_type === "string" ? body.scope_type : "";
  const scopeIdRaw = body.scope_id;
  const stringScopeId = typeof scopeIdRaw === "string" ? scopeIdRaw : null;
  const scopeId = scopeIdRaw == null || scopeIdRaw === "" ? null : stringScopeId;

  if (!ROLES.includes(role as Role) || !SCOPE_TYPES.includes(scopeType as ScopeType)) return null;
  if (scopeType !== "instance" && !scopeId) return null;
  if (scopeType === "instance" && scopeId) return null;
  return { role: role as Role, scopeType: scopeType as ScopeType, scopeId };
}

const USER_LIST_ROLES = ["superadmin", "admin", "operator"] as const;
type UserListRole = (typeof USER_LIST_ROLES)[number];

function parseUserListRole(raw: string | undefined): UserListRole | null {
  if (!raw || raw === "all") return null;
  return USER_LIST_ROLES.includes(raw as UserListRole) ? (raw as UserListRole) : null;
}

function parseUserListStatus(raw: string | undefined): boolean | null {
  if (!raw || raw === "all") return null;
  if (raw === "active") return true;
  if (raw === "disabled") return false;
  return null;
}

/** GET /api/admin/organizations — org picker for IAM (superadmin only). */
export async function handleGetOrganizations(c: Context, db: PrismaClient): Promise<Response> {
  const denied = await requireSuperadmin(c, db);
  if (denied) return denied;

  const organizations = await db.organization.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return c.json({ organizations });
}

/** GET /api/admin/users — paginated staff list (superadmin only). */
export async function handleGetUsers(c: Context, db: PrismaClient): Promise<Response> {
  const denied = await requireSuperadmin(c, db);
  if (denied) return denied;

  const q = c.req.query("q")?.trim();
  const page = positiveIntQuery(c.req.query("page"), 1);
  const pageSize = positiveIntQuery(c.req.query("pageSize"), 25, 50);
  const role = parseUserListRole(c.req.query("role")?.trim());
  const isActive = parseUserListStatus(c.req.query("status")?.trim());

  const where: Prisma.UserWhereInput = {};
  if (q) {
    where.OR = [
      { email: { contains: q, mode: "insensitive" } },
      { display_name: { contains: q, mode: "insensitive" } },
    ];
  }
  if (isActive != null) {
    where.is_active = isActive;
  }
  if (role) {
    where.role_assignments = { some: { role } };
  }

  const [total, rows] = await Promise.all([
    db.user.count({ where }),
    db.user.findMany({
      where,
      include: userInclude,
      orderBy: { email: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const userIds = rows.map((row) => row.id);
  const statsMap = await sessionStatsForUsers(db, userIds);
  const users = rows.map((row) =>
    serializeUserRow(row, statsMap.get(row.id) ?? { last_login_at: null, active_sessions_count: 0 }),
  );
  return c.json({ users, total, page, pageSize });
}

/** GET /api/admin/users/stats — instance-wide counts for the Users & roles KPI tiles
 * (superadmin only). Deliberately separate from the paginated list above, whose `pageSize` is
 * capped at 50 — computing these totals from a page of results would be wrong past that many
 * users, or whenever a search/role/status filter narrows the list. */
export async function handleGetUserStats(c: Context, db: PrismaClient): Promise<Response> {
  const denied = await requireSuperadmin(c, db);
  if (denied) return denied;

  const [total, active, mfaConfirmed, passwordUsers, sso, activeSessionUsers] = await Promise.all([
    db.user.count(),
    db.user.count({ where: { is_active: true } }),
    // Scoped to users with a local password: a linked identity provider doesn't retire the
    // password path (a hybrid account can still sign in with either), so excluding every
    // SSO-linked user here - not just SSO-only ones - would hide a hybrid account's
    // unprotected password login from this KPI (codex review).
    db.user.count({
      where: {
        mfa_methods: { some: { confirmed_at: { not: null } } },
        password_hash: { not: null },
      },
    }),
    // Denominator for the coverage KPI below - only users who actually have a password path
    // that two-factor could protect. Deliberately not `total - sso`: `sso` (below) counts every
    // identity-provider link, hybrid accounts included, which still have a password to protect.
    db.user.count({ where: { password_hash: { not: null } } }),
    db.user.count({ where: { external_identities: { some: {} } } }),
    db.session.groupBy({
      by: ["user_id"],
      where: { revoked_at: null, expires_at: { gt: new Date() } },
      _count: { _all: true },
    }),
  ]);
  const activeSessions = activeSessionUsers.reduce((sum, row) => sum + row._count._all, 0);

  return c.json({
    total,
    active,
    mfa: mfaConfirmed,
    password_users: passwordUsers,
    sso,
    active_sessions: activeSessions,
    active_sessions_users: activeSessionUsers.length,
  });
}

/** POST /api/admin/users — create account (superadmin only). */
export async function handlePostUser(c: Context, db: PrismaClient): Promise<Response> {
  const denied = await requireSuperadmin(c, db);
  if (denied) return denied;

  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const emailRaw = typeof body?.email === "string" ? body.email : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const displayName =
    typeof body?.display_name === "string" ? body.display_name.trim() || null : null;
  const phoneCountryCode =
    typeof body?.phone_country_code === "string" ? body.phone_country_code.trim() || undefined : undefined;
  const phoneNumber =
    typeof body?.phone_number === "string" ? body.phone_number.trim() || undefined : undefined;
  const mustChange = body?.must_change_password === true;

  const email = normalizeEmail(emailRaw);
  if (!email || password.length < PASSWORD_MIN_LENGTH) {
    return c.json({ error: "invalid_request" }, 400);
  }
  if (!isValidEmailFormat(email)) {
    return c.json({ code: "invalid_email", error: "invalid_email" }, 400);
  }
  if (isPasswordTooCommon(password)) {
    return c.json(passwordTooCommonJsonBody(), 400);
  }

  const existing = await findUserByEmail(db, email);
  if (existing) {
    return c.json({ code: "email_conflict", error: "email_taken" }, 409);
  }

  const orgId = await resolveInstanceOrganizationId(db);
  const audit = adminAuditFromContext(c);
  const actorUserId = c.get("auth").userId;

  let created;
  try {
    created = await db.$transaction(async (tx) => {
      const user = await createUser(tx, {
        email,
        password,
        displayName: displayName ?? undefined,
        phoneCountryCode,
        phoneNumber,
        isActive: true,
        mustChangePassword: mustChange,
      });
      await writeAdminAuditLog(tx, {
        organizationId: orgId,
        actorUserId,
        sessionId: audit.sessionId,
        ip: audit.ip,
        timezone: audit.timezone,
        actionType: "user_created",
        metadata: { userId: user.id, email: user.email },
      });
      return user;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return c.json({ code: "email_conflict", error: "email_taken" }, 409);
    }
    throw err;
  }

  const user = await loadUser(db, created.id);
  if (!user) return c.json({ error: "not_found" }, 404);

  emitSystemLog("security", "info", "user_created", {
    targetUserId: created.id,
    targetEmail: created.email,
    actorUserId,
    actorEmail: await resolveActorEmailForLog(db, actorUserId),
  });

  return c.json({ user: await serializeUser(db, user) }, 201);
}

type PatchUserConflict = "self_deactivate" | "invalid_email";

/** Builds the Prisma update payload for PATCH /users/:id from the request body. */
function buildPatchUserData(
  body: Record<string, unknown> | null,
  id: string,
  actorId: string,
): { data: Prisma.UserUpdateInput } | { conflict: PatchUserConflict } {
  const data: Prisma.UserUpdateInput = {};
  if (typeof body?.display_name === "string") {
    data.display_name = body.display_name.trim() || null;
  }
  // null (not just a string) is a valid, intentional value here - the edit modal always sends
  // one or the other for both phone fields, using null to mean "clear it". Treating null the
  // same as "field omitted" silently ignored every attempt to clear a previously-set number.
  if (typeof body?.phone_country_code === "string" || body?.phone_country_code === null) {
    data.phone_country_code =
      typeof body.phone_country_code === "string" ? body.phone_country_code.trim() || null : null;
  }
  if (typeof body?.phone_number === "string" || body?.phone_number === null) {
    data.phone_number = typeof body.phone_number === "string" ? body.phone_number.trim() || null : null;
  }
  if (typeof body?.is_active === "boolean") {
    if (body.is_active === false && id === actorId) {
      return { conflict: "self_deactivate" };
    }
    data.is_active = body.is_active;
  }
  if (typeof body?.email === "string") {
    const email = normalizeEmail(body.email);
    if (!email || !isValidEmailFormat(email)) return { conflict: "invalid_email" };
    data.email = email;
  }
  return { data };
}

/** Picks the audit action type for a user PATCH: the active-flag transition takes priority
 * (it's the more consequential change), then an email change, then a plain profile edit. */
function patchUserActionType(
  data: Prisma.UserUpdateInput,
  before: { is_active: boolean; email: string },
): string {
  if (typeof data.is_active === "boolean" && data.is_active !== before.is_active) {
    return data.is_active ? "user_reactivated" : "user_deactivated";
  }
  // The Edit user modal always resubmits the current email alongside unrelated field changes,
  // so a plain `typeof data.email === "string"` check logged every profile save as an email
  // change - comparing against the prior value keeps the audit trail accurate.
  if (typeof data.email === "string" && data.email !== before.email) return "user_email_changed";
  return "user_profile_updated";
}

/** Applies the user update inside the PATCH transaction; returns prior `is_active`, or null if gone. */
async function applyUserPatch(
  tx: Prisma.TransactionClient,
  id: string,
  data: Prisma.UserUpdateInput,
  actionType: string,
  orgId: string,
  audit: OpsAuditContext,
  actorId: string,
): Promise<boolean | null> {
  const current = await tx.user.findUnique({ where: { id }, select: { is_active: true } });
  if (!current) return null;

  if (data.is_active === false && current.is_active) {
    await assertLastSuperadminDeactivationAllowed(tx, id);
  }

  await tx.user.update({ where: { id }, data });

  await writeAdminAuditLog(tx, {
    organizationId: orgId,
    actorUserId: actorId,
    sessionId: audit.sessionId,
    ip: audit.ip,
    timezone: audit.timezone,
    actionType,
    metadata: { userId: id },
  });

  return current.is_active;
}

/** Maps handlePatchUser's transaction errors to their HTTP response; rethrows anything else. */
function mapPatchUserTransactionError(c: Context, err: unknown): Response {
  // Not independently reachable via this route today: requireSuperadmin already requires the
  // actor to be an active superadmin, and the self-deactivate guard above rejects id === actorId
  // before the transaction starts - so a non-self target only ever reaches this transaction while
  // at least one OTHER active superadmin (the actor) still exists, meaning the target can never
  // be the last one. Same reasoning already documented on the DELETE .../roles/:assignmentId
  // anti-lockout test below; kept as defense-in-depth in case that invariant ever changes.
  /* v8 ignore if */
  if (err instanceof LastSuperadminError) {
    return c.json({ code: "last_superadmin" }, 409);
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    return c.json({ code: "email_conflict", error: "email_taken" }, 409);
  }
  throw err;
}

type PatchUserTransactionParams = {
  id: string;
  data: Prisma.UserUpdateInput;
  actionType: string;
  orgId: string;
  audit: OpsAuditContext;
  actorId: string;
};

/** Runs handlePatchUser's update transaction and, on success, the post-commit session revoke.
 * Returns the response to send immediately (not-found, or a mapped transaction error), or null
 * to continue with the caller's own success response. */
async function runPatchUserTransaction(
  c: Context,
  db: PrismaClient,
  params: PatchUserTransactionParams,
): Promise<Response | null> {
  const { id, data, actionType, orgId, audit, actorId } = params;
  try {
    const outcome = await db.$transaction(
      (tx) => applyUserPatch(tx, id, data, actionType, orgId, audit, actorId),
      data.is_active === false
        ? { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        : undefined,
    );

    // Race guard: the target existed at handlePatchUser's own `before` fetch, but this
    // transaction's own tx.user.findUnique (inside applyUserPatch) found nothing - only reachable
    // if a concurrent request deletes the same user in the narrow window between those two reads.
    // Not deterministically triggerable from an integration test without controlling transaction
    // timing; kept for real-world safety.
    /* v8 ignore if */
    if (outcome === null) return c.json({ error: "not_found" }, 404);

    // Revoke after commit: session last_seen_at updates during a Serializable tx
    // can cause serialization failures if sessions are updated in the same tx.
    if (data.is_active === false && outcome) {
      await revokeUserAuthState(db, id);
    }
    return null;
  } catch (err) {
    return mapPatchUserTransactionError(c, err);
  }
}

/** PATCH /api/admin/users/:id — update profile / active flag (superadmin only). */
export async function handlePatchUser(c: Context, db: PrismaClient): Promise<Response> {
  const denied = await requireSuperadmin(c, db);
  if (denied) return denied;

  const id = c.req.param("id") ?? "";
  if (!id) return c.json({ error: "user id required" }, 400);

  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const actorId = c.get("auth").userId;

  const parsed = buildPatchUserData(body, id, actorId);
  if ("conflict" in parsed) {
    if (parsed.conflict === "invalid_email") return c.json({ code: "invalid_email", error: "invalid_email" }, 400);
    return c.json({ code: "cannot_deactivate_self" }, 409);
  }
  const { data } = parsed;

  if (Object.keys(data).length === 0) return c.json({ error: "invalid_request" }, 400);

  const before = await db.user.findUnique({ where: { id }, select: { is_active: true, email: true } });
  if (!before) return c.json({ error: "not_found" }, 404);

  const orgId = await resolveInstanceOrganizationId(db);
  const audit = adminAuditFromContext(c);
  const actionType = patchUserActionType(data, before);

  const early = await runPatchUserTransaction(c, db, { id, data, actionType, orgId, audit, actorId });
  if (early) return early;

  if (actionType === "user_deactivated" || actionType === "user_reactivated") {
    emitSystemLog("security", "info", actionType, {
      targetUserId: id,
      targetEmail: before.email,
      actorUserId: actorId,
      actorEmail: await resolveActorEmailForLog(db, actorId),
    });
  }

  const user = await loadUser(db, id);
  if (!user) return c.json({ error: "not_found" }, 404);

  return c.json({ user: await serializeUser(db, user) });
}

/** DELETE /api/admin/users/:id — hard delete (superadmin only). Sessions, role assignments,
 * MFA methods, trusted devices, and external identities cascade at the DB level (schema.prisma);
 * AdminAuditLog.actor_user_id is a plain string column, not an FK, so past audit entries this
 * user authored are preserved with a dangling reference rather than deleted or blocking. */
export async function handleDeleteUser(c: Context, db: PrismaClient): Promise<Response> {
  const denied = await requireSuperadmin(c, db);
  if (denied) return denied;

  const id = c.req.param("id") ?? "";
  if (!id) return c.json({ error: "user id required" }, 400);

  const actorId = c.get("auth").userId;
  if (id === actorId) return c.json({ code: "cannot_delete_self" }, 409);

  const before = await db.user.findUnique({ where: { id }, select: { email: true } });
  if (!before) return c.json({ error: "not_found" }, 404);

  const orgId = await resolveInstanceOrganizationId(db);
  const audit = adminAuditFromContext(c);

  try {
    await db.$transaction(
      async (tx) => {
        await assertLastSuperadminDeleteAllowed(tx, id);
        await tx.user.delete({ where: { id } });
        await writeAdminAuditLog(tx, {
          organizationId: orgId,
          actorUserId: actorId,
          sessionId: audit.sessionId,
          ip: audit.ip,
          timezone: audit.timezone,
          actionType: "user_deleted",
          metadata: { userId: id, email: before.email },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (err) {
    if (err instanceof LastSuperadminError) {
      return c.json({ code: "last_superadmin" }, 409);
    }
    throw err;
  }

  emitSystemLog("security", "info", "user_deleted", {
    targetUserId: id,
    targetEmail: before.email,
    actorUserId: actorId,
    actorEmail: await resolveActorEmailForLog(db, actorId),
  });

  return c.json({ ok: true });
}

/** Pure authorization check (no Response-building) mirroring assertRoleGrantAllowed's rule, used
 * inside performRoleTypeSwitch's transaction to re-verify the actor may revoke each assignment it
 * actually refetched there. assertRoleRevokeAllowed (below) only runs once, before the
 * transaction, against assignments queried at that earlier moment; a new assignment appearing in
 * the window between that check and the transaction's own fresh refetch would otherwise be
 * deleted without ever being authorized. Kept as its own small function rather than reusing
 * assertRoleGrantAllowed directly, since that one needs a Context to build 403/404 responses and
 * this one runs inside a transaction with only a generic "forbidden" outcome available. */
async function canRevokeInTransaction(
  tx: Prisma.TransactionClient,
  actorId: string,
  assignment: { role: string; scope_type: string; scope_id: string | null },
): Promise<boolean> {
  if (await canManageInstance(tx, actorId)) return true;
  // Every path below here is genuinely unreachable outside a real concurrent-modification
  // race: performRoleTypeSwitch only calls this for assignments already authorized by
  // handlePostUserRole's own pre-transaction assertImplicitRevokesAllowed check, using the
  // same rules - a non-superadmin actor who was denied there never reaches this transaction
  // at all, and one who was allowed can only have been allowed for operator/event assignments
  // they administer, which is exactly what this function itself re-confirms. Only a fresh
  // grant/revoke racing this same transaction could make the two checks disagree.
  /* v8 ignore start */
  if (assignment.role !== "operator" || assignment.scope_type !== "event" || !assignment.scope_id) {
    return false;
  }
  const event = await tx.event.findUnique({
    where: { id: assignment.scope_id },
    select: { organization_id: true },
  });
  if (!event) return false;
  return hasScope(tx, actorId, "admin", "organization", event.organization_id);
  /* v8 ignore stop */
}

/** POST /api/admin/users/:id/roles — grant role assignment. */
/** The implicit role-type-switch transaction body for handlePostUserRole - refetches the
 * target's old-type assignments (with oidc_role_grants) inside the transaction, same as
 * handleDeleteUserRole's "current", so freshness plus the caller's Serializable isolation close
 * the TOCTOU window between this check and the delete below. An implicit switch must not be able
 * to do what an explicit revoke can't: handleDeleteUserRole refuses to remove an IdP-managed
 * assignment (managed_by_idp), so silently deleting one here as a side effect of granting an
 * unrelated new role would be an easy way around that guard. */
async function performRoleTypeSwitch(
  tx: Prisma.TransactionClient,
  id: string,
  parsed: { role: Role; scopeType: ScopeType; scopeId: string | null },
  orgId: string,
  actorId: string,
  audit: OpsAuditContext,
) {
  const replaced = await tx.roleAssignment.findMany({
    where: { user_id: id, role: { not: parsed.role } },
    include: { oidc_role_grants: { select: { id: true } } },
  });
  if (replaced.some((old) => old.oidc_role_grants.length > 0)) {
    return "managed_by_idp" as const;
  }
  if (replaced.length > 0) {
    for (const old of replaced) {
      if (!(await canRevokeInTransaction(tx, actorId, old))) {
        return "forbidden" as const;
      }
      await assertLastSuperadminRemovalAllowed(tx, old);
    }
    await tx.roleAssignment.deleteMany({ where: { id: { in: replaced.map((a) => a.id) } } });
  }

  const created = await tx.roleAssignment.create({
    data: {
      user_id: id,
      role: parsed.role,
      scope_type: parsed.scopeType,
      scope_id: parsed.scopeId,
    },
  });
  await writeAdminAuditLog(tx, {
    organizationId: orgId,
    actorUserId: actorId,
    sessionId: audit.sessionId,
    ip: audit.ip,
    timezone: audit.timezone,
    actionType: replaced.length > 0 ? "role_changed" : "role_granted",
    metadata: {
      userId: id,
      role: parsed.role,
      scopeType: parsed.scopeType,
      scopeId: parsed.scopeId,
      ...(replaced.length > 0 ? { replacedRoles: replaced.map((a) => a.role) } : {}),
    },
  });
  return created;
}

/** Maps handlePostUserRole's transaction failures to a response body, or null to rethrow.
 * Both mapped cases are genuine TOCTOU races: handlePostUserRole's own pre-transaction checks
 * (the existing-assignment lookup for already_assigned, assertLastSuperadminRemovalAllowed's
 * fresh in-transaction count for last_superadmin) already reject the same conflict on any
 * single, non-concurrent request - these only fire when another request commits between that
 * check and this one's own transaction. */
/* v8 ignore start */
function roleGrantConflictResponse(err: unknown): { code: string } | null {
  if (err instanceof LastSuperadminError) return { code: "last_superadmin" };
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    return { code: "already_assigned" };
  }
  return null;
}
/* v8 ignore stop */

/** Authorizes every implicit revoke a role-type switch would perform, one assignment at a time -
 * assertRoleGrantAllowed only authorized the new grant, so without this an org-scoped admin
 * could use their own event's grant authority to silently strip a target's unrelated
 * admin/superadmin assignment they have no authority over. Same rule handleDeleteUserRole
 * already applies to an explicit revoke, applied here to every implicit one; non-superadmins
 * can only ever grant operator/event roles, so this always denies (403) when the assignment
 * being replaced is admin- or superadmin-scoped, same as a direct revoke of one would. */
async function assertImplicitRevokesAllowed(
  c: Context,
  db: PrismaClient,
  actorId: string,
  otherTypeAssignments: Array<{ role: string; scope_type: string; scope_id: string | null }>,
): Promise<Response | null> {
  for (const old of otherTypeAssignments) {
    const revokeDenied = await assertRoleRevokeAllowed(c, db, actorId, old);
    if (revokeDenied) return revokeDenied;
  }
  return null;
}

export async function handlePostUserRole(c: Context, db: PrismaClient): Promise<Response> {
  const id = c.req.param("id") ?? "";
  if (!id) return c.json({ error: "user id required" }, 400);

  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = body ? parseRoleScope(body) : null;
  if (!parsed) return c.json({ error: "invalid_request" }, 400);

  const actorId = c.get("auth").userId;
  const grantDenied = await assertRoleGrantAllowed(
    c,
    db,
    actorId,
    parsed.role,
    parsed.scopeType,
    parsed.scopeId,
  );
  if (grantDenied) return grantDenied;

  const target = await db.user.findUnique({ where: { id }, select: { id: true, email: true } });
  if (!target) return c.json({ error: "not_found" }, 404);

  const existing = await db.roleAssignment.findFirst({
    where: {
      user_id: id,
      role: parsed.role,
      scope_type: parsed.scopeType,
      scope_id: parsed.scopeId,
    },
  });
  if (existing) return c.json({ code: "already_assigned" }, 409);

  // Roles are exclusive by type - superadmin, admin, and operator never combine on one person
  // (only the scope list within a type is cumulative, e.g. an admin over several orgs). Granting
  // a different type than whatever this user currently holds replaces it rather than adding a
  // second function. Changing your *own* type is refused outright, same reasoning as
  // cannot_remove_own_role: you could revoke the only access that lets you do this at all.
  const otherTypeAssignments = await db.roleAssignment.findMany({
    where: { user_id: id, role: { not: parsed.role } },
  });
  if (otherTypeAssignments.length > 0 && id === actorId) {
    return c.json({ code: "cannot_change_own_role" }, 409);
  }

  // A role-type switch implicitly revokes every assignment of the target's OLD type - see
  // assertImplicitRevokesAllowed's own comment for why each one needs its own authorization
  // check, not just the new grant's.
  const revokeDenied = await assertImplicitRevokesAllowed(c, db, actorId, otherTypeAssignments);
  if (revokeDenied) return revokeDenied;

  const orgId = await resolveInstanceOrganizationId(db);
  const audit = adminAuditFromContext(c);

  let outcome;
  try {
    outcome = await runSerializableTransaction(
      db,
      (tx) => performRoleTypeSwitch(tx, id, parsed, orgId, actorId, audit),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (err) {
    const conflict = roleGrantConflictResponse(err);
    if (conflict) return c.json(conflict, 409);
    throw err;
  }

  if (outcome === "managed_by_idp") {
    return c.json({ code: "managed_by_idp" }, 409);
  }
  if (outcome === "forbidden") {
    return c.json({ error: "forbidden" }, 403);
  }
  const assignment = outcome;

  emitSystemLog("security", "info", "role_granted", {
    targetUserId: target.id,
    targetEmail: target.email,
    role: assignment.role,
    scopeType: assignment.scope_type,
    scopeId: assignment.scope_id,
    actorUserId: actorId,
    actorEmail: await resolveActorEmailForLog(db, actorId),
  });

  return c.json(
    {
      assignment: {
        id: assignment.id,
        role: assignment.role,
        scope_type: assignment.scope_type,
        scope_id: assignment.scope_id,
      },
    },
    201,
  );
}

/** DELETE /api/admin/users/:id/roles/:assignmentId — revoke role assignment. */
export async function handleDeleteUserRole(c: Context, db: PrismaClient): Promise<Response> {
  const id = c.req.param("id") ?? "";
  const assignmentId = c.req.param("assignmentId") ?? "";
  if (!id || !assignmentId) return c.json({ error: "id required" }, 400);

  const actorId = c.get("auth").userId;
  const actorIsSuperadmin = await canManageInstance(db, actorId);

  const assignment = await db.roleAssignment.findFirst({
    where: { id: assignmentId, user_id: id },
    include: {
      oidc_role_grants: { select: { id: true } },
      user: { select: { email: true } },
    },
  });
  if (!assignment) {
    return respondRoleDeleteGone(c, db, id, assignmentId, actorIsSuperadmin);
  }
  // Checked only once the assignment is confirmed to exist and belong to :id - an :id that
  // merely matches the actor's own id but names someone else's assignment must still fall
  // through to the ordinary not-found/permission handling below, not this guard.
  if (id === actorId) return c.json({ code: "cannot_remove_own_role" }, 409);

  const revokeDenied = await assertRoleRevokeAllowed(c, db, actorId, assignment);
  if (revokeDenied) return revokeDenied;

  if (assignment.oidc_role_grants.length > 0) {
    return c.json({ code: "managed_by_idp" }, 409);
  }

  const orgId = await resolveInstanceOrganizationId(db);
  const audit = adminAuditFromContext(c);

  try {
    const outcome = await db.$transaction(
      async (tx) => {
        const current = await tx.roleAssignment.findFirst({
          where: { id: assignmentId, user_id: id },
          select: {
            id: true,
            role: true,
            scope_type: true,
            scope_id: true,
            oidc_role_grants: { select: { id: true }, take: 1 },
          },
        });
        if (!current) return "gone" as const;
        if (current.oidc_role_grants.length > 0) return "managed_by_idp" as const;

        await assertLastSuperadminRemovalAllowed(tx, current);
        await tx.roleAssignment.delete({ where: { id: assignmentId } });
        await writeAdminAuditLog(tx, {
          organizationId: orgId,
          actorUserId: actorId,
          sessionId: audit.sessionId,
          ip: audit.ip,
          timezone: audit.timezone,
          actionType: "role_revoked",
          metadata: {
            userId: id,
            role: current.role,
            scopeType: current.scope_type,
            scopeId: current.scope_id,
          },
        });
        return {
          role: current.role,
          scope_type: current.scope_type,
          scope_id: current.scope_id,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (outcome === "gone") {
      return respondRoleDeleteGone(c, db, id, assignmentId, actorIsSuperadmin);
    }
    if (outcome === "managed_by_idp") {
      return c.json({ code: "managed_by_idp" }, 409);
    }
    emitSystemLog("security", "info", "role_revoked", {
      targetUserId: id,
      targetEmail: assignment.user.email,
      role: outcome.role,
      scopeType: outcome.scope_type,
      scopeId: outcome.scope_id,
      actorUserId: actorId,
      actorEmail: await resolveActorEmailForLog(db, actorId),
    });
  } catch (err) {
    if (err instanceof LastSuperadminError) {
      return c.json({ code: "last_superadmin" }, 409);
    }
    throw err;
  }

  return c.body(null, 204);
}

type ResetMfaOutcome = { ok: true } | { ok: false; code: "cannot_reset_mfa_sso_managed" };

/** Performs the actual reset-2fa write inside `tx`, re-checking the SSO-managed exclusion fresh
 * (not just at handlePostResetUserMfa's earlier pre-check) so an SSO link completed in the
 * window between that check and this transaction's commit can't leave a hybrid account's local
 * TOTP silently removed - the same TOCTOU class this file already closes for role changes (see
 * performRoleTypeSwitch, handleDeleteUserRole). `flagSuperadminTarget` only controls the audit
 * metadata: the step-up gate around this call (when required) has already authorized the actor.
 *
 * Known residual gap (not closed here): this closes the coarse race (an SSO link that already
 * committed before this transaction's re-check), but not a narrower one - under this
 * transaction's default READ COMMITTED isolation, the guarantee is per-statement, not
 * per-transaction, so a concurrent link that commits strictly between this findFirst and the
 * write below would still be missed. Closing that fully needs SERIALIZABLE isolation (see
 * runSerializableTransaction) on BOTH this transaction and the OIDC link-completion write
 * (resolveOrCreateUserFromExternalIdentity, packages/auth/src/external-identity/resolve-user.ts)
 * - Postgres's serializable conflict detection only tracks transactions actually running at that
 * level, so elevating just one side gives no real guarantee. That function is the shared, hot
 * path for every OIDC login/link in the app; elevating it is disproportionate to close a rare,
 * non-attacker-controlled race between an admin-assisted reset and an unrelated SSO link
 * finishing in the same narrow window. Left as a documented limitation. */
async function performResetUserMfa(
  tx: Prisma.TransactionClient,
  id: string,
  orgId: string,
  audit: OpsAuditContext,
  actorUserId: string,
  flagSuperadminTarget: boolean,
): Promise<ResetMfaOutcome> {
  const linked = await tx.externalIdentity.findFirst({ where: { user_id: id }, select: { id: true } });
  if (linked) return { ok: false, code: "cannot_reset_mfa_sso_managed" };

  await resetUserMfa(tx, id);
  await writeAdminAuditLog(tx, {
    organizationId: orgId,
    actorUserId,
    sessionId: audit.sessionId,
    ip: audit.ip,
    timezone: audit.timezone,
    actionType: "user_mfa_reset",
    metadata: flagSuperadminTarget ? { userId: id, superadminTarget: true } : { userId: id },
  });
  return { ok: true };
}

/** POST /api/admin/users/:id/reset-2fa — remove MFA methods and revoke sessions. Resetting
 * another superadmin's MFA additionally requires the ACTOR to step up with their own TOTP/
 * recovery code (actorMustStepUpForReset) and is flagged distinctly in the audit trail - see
 * that function's docstring for why. */
export async function handlePostResetUserMfa(
  c: Context,
  db: PrismaClient,
  rateLimitStore: RateLimitStore,
): Promise<Response> {
  const denied = await requireSuperadmin(c, db);
  if (denied) return denied;

  const id = c.req.param("id") ?? "";
  if (!id) return c.json({ error: "user id required" }, 400);

  // TOTP is a local-login concept (IdP-authenticated sessions skip local MFA policy entirely -
  // Session.auth_method), but a hybrid account (SSO-linked with a real fallback local password
  // and confirmed TOTP - see account-routes.ts's self-service password/unlink flows) still relies
  // on it for that local path. Resetting it here would silently drop that account's local sign-in
  // from password+TOTP to password-only, the same unmonitored weakening the reset-password guard
  // below exists to prevent. See handleAdminAssistedReset for the shared SSO-managed check.
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const rawCode = typeof body?.code === "string" ? body.code : undefined;

  return handleAdminAssistedReset(
    c,
    db,
    rateLimitStore,
    {
      id,
      rawCode,
      ssoManagedCode: "cannot_reset_mfa_sso_managed",
      rateLimitAction: "admin-reset-2fa-superadmin",
      logAction: "user_mfa_reset",
    },
    (tx, orgId, audit, requiresStepUp, actorUserId) =>
      performResetUserMfa(tx, id, orgId, audit, actorUserId, requiresStepUp),
  );
}

/** DELETE /api/admin/users/:id/external-identity — unlink SSO, forcing local-password sign-in
 * from then on. A new password is always required and set in the same transaction as the unlink,
 * whether or not the target already had a real local one - unlinking without one would silently
 * lock the target out with no working sign-in method at all. */
export async function handleDeleteUserExternalIdentity(c: Context, db: PrismaClient): Promise<Response> {
  const denied = await requireSuperadmin(c, db);
  if (denied) return denied;

  // Route registered as /api/admin/users/:id/external-identity - Hono only invokes this
  // handler when :id actually matched, so the fallback and guard below can't fire in practice.
  const id = c.req.param("id") ?? "";
  /* v8 ignore if */
  if (!id) return c.json({ error: "user id required" }, 400);

  const actorId = c.get("auth").userId;
  if (id === actorId) return c.json({ code: "cannot_unlink_own_sso" }, 409);

  const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true } });
  if (!user) return c.json({ error: "not_found" }, 404);

  const linked = await db.externalIdentity.findMany({ where: { user_id: id }, select: { id: true } });
  if (linked.length === 0) return c.json({ error: "not_found" }, 404);

  // Checked only once there's actually something to unlink - a request for an already-local or
  // nonexistent user should still 404 without forcing the caller to supply a throwaway password.
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const newPassword = typeof body?.new_password === "string" ? body.new_password : "";
  if (newPassword.length < PASSWORD_MIN_LENGTH) return c.json({ error: "invalid_request" }, 400);
  if (isPasswordTooCommon(newPassword)) {
    return c.json(passwordTooCommonJsonBody(), 400);
  }

  const hash = await hashPassword(newPassword);
  const orgId = await resolveInstanceOrganizationId(db);
  const audit = adminAuditFromContext(c);

  await db.$transaction(async (tx) => {
    await tx.externalIdentity.deleteMany({ where: { user_id: id } });
    // OidcRoleGrant has no FK to ExternalIdentity (it's keyed by provider_id/user_id), so it
    // survives the identity delete above on its own - deleting it here converts any IdP-managed
    // role assignments to manual ownership instead of leaving them silently orphaned: still
    // granted (RoleAssignment itself isn't touched), but no longer blocked from revoke/switch by
    // the managed_by_idp guard, and no longer reachable by a future OIDC sync since no provider
    // is linked to this user anymore.
    await tx.oidcRoleGrant.deleteMany({ where: { user_id: id } });
    await tx.user.update({
      where: { id },
      data: { password_hash: hash, must_change_password: true },
    });
    await tx.session.updateMany({
      where: { user_id: id, revoked_at: null },
      data: { revoked_at: new Date() },
    });
    await revokeAllTrustedDevicesForUser(tx, id);
    await writeAdminAuditLog(tx, {
      organizationId: orgId,
      actorUserId: actorId,
      sessionId: audit.sessionId,
      ip: audit.ip,
      timezone: audit.timezone,
      actionType: "user_sso_unlinked",
      metadata: { userId: id, count: linked.length },
    });
    await writeAdminAuditLog(tx, {
      organizationId: orgId,
      actorUserId: actorId,
      sessionId: audit.sessionId,
      ip: audit.ip,
      timezone: audit.timezone,
      actionType: "user_password_reset",
      metadata: { userId: id, reason: "sso_unlink" },
    });
  });

  emitSystemLog("security", "info", "user_sso_unlinked", {
    targetUserId: user.id,
    targetEmail: user.email,
    actorUserId: actorId,
    actorEmail: await resolveActorEmailForLog(db, actorId),
  });

  return c.json({ ok: true });
}

type ResetPasswordOutcome = { ok: true } | { ok: false; code: "cannot_reset_password_sso_managed" };

/** Performs the actual reset-password write inside `tx`, re-checking the SSO-managed exclusion
 * fresh (not just at handlePostResetUserPassword's earlier pre-check) so an SSO link completed
 * in the window between that check and this transaction's commit can't leave a hybrid account
 * with a silently-set local password - the same TOCTOU class this file already closes for role
 * changes (see performRoleTypeSwitch, handleDeleteUserRole). The password is hashed only once
 * this check passes (and, when gated by withStepUpGate, only once step-up itself has passed),
 * so a request refused for either reason never pays for the hash. `flagSuperadminTarget` only
 * controls the audit metadata: the step-up gate around this call (when required) has already
 * authorized the actor. Same residual narrower-race limitation as performResetUserMfa's own
 * docstring - not closed here, see that comment for why. */
async function performResetUserPassword(
  tx: Prisma.TransactionClient,
  id: string,
  newPassword: string,
  orgId: string,
  audit: OpsAuditContext,
  actorUserId: string,
  flagSuperadminTarget: boolean,
): Promise<ResetPasswordOutcome> {
  const linked = await tx.externalIdentity.findFirst({ where: { user_id: id }, select: { id: true } });
  if (linked) return { ok: false, code: "cannot_reset_password_sso_managed" };

  const hash = await hashPassword(newPassword);
  await tx.user.update({
    where: { id },
    data: { password_hash: hash, must_change_password: true },
  });
  await tx.session.updateMany({
    where: { user_id: id, revoked_at: null },
    data: { revoked_at: new Date() },
  });
  await revokeAllTrustedDevicesForUser(tx, id);
  await writeAdminAuditLog(tx, {
    organizationId: orgId,
    actorUserId,
    sessionId: audit.sessionId,
    ip: audit.ip,
    timezone: audit.timezone,
    actionType: "user_password_reset",
    metadata: flagSuperadminTarget ? { userId: id, superadminTarget: true } : { userId: id },
  });
  return { ok: true };
}

/** POST /api/admin/users/:id/reset-password — set temporary password and revoke sessions.
 * Resetting another superadmin's password additionally requires the ACTOR to step up with
 * their own TOTP/recovery code (actorMustStepUpForReset) and is flagged distinctly in the audit
 * trail - see that function's docstring for why. */
export async function handlePostResetUserPassword(
  c: Context,
  db: PrismaClient,
  rateLimitStore: RateLimitStore,
): Promise<Response> {
  const denied = await requireSuperadmin(c, db);
  if (denied) return denied;

  const id = c.req.param("id") ?? "";
  if (!id) return c.json({ error: "user id required" }, 400);

  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const newPassword = typeof body?.new_password === "string" ? body.new_password : "";
  if (newPassword.length < PASSWORD_MIN_LENGTH) return c.json({ error: "invalid_request" }, 400);
  if (isPasswordTooCommon(newPassword)) {
    return c.json(passwordTooCommonJsonBody(), 400);
  }

  // An SSO-managed account signs in via its identity provider, not a local password - setting
  // one here would silently open a second, unmonitored sign-in path alongside SSO. Unlink the
  // identity provider first (DELETE .../external-identity) if the account needs to go local.
  // See handleAdminAssistedReset for the shared SSO-managed check.
  const rawCode = typeof body?.code === "string" ? body.code : undefined;

  return handleAdminAssistedReset(
    c,
    db,
    rateLimitStore,
    {
      id,
      rawCode,
      ssoManagedCode: "cannot_reset_password_sso_managed",
      rateLimitAction: "admin-reset-password-superadmin",
      logAction: "user_password_reset",
    },
    (tx, orgId, audit, requiresStepUp, actorUserId) =>
      performResetUserPassword(tx, id, newPassword, orgId, audit, actorUserId, requiresStepUp),
  );
}

/** POST /api/admin/users/:id/revoke-sessions — revoke all sessions for a user. */
export async function handlePostRevokeUserSessions(c: Context, db: PrismaClient): Promise<Response> {
  const denied = await requireSuperadmin(c, db);
  if (denied) return denied;

  const id = c.req.param("id") ?? "";
  if (!id) return c.json({ error: "user id required" }, 400);

  const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true } });
  if (!user) return c.json({ error: "not_found" }, 404);

  const orgId = await resolveInstanceOrganizationId(db);
  const audit = adminAuditFromContext(c);
  const actorUserId = c.get("auth").userId;

  const { sessionsRevoked } = await db.$transaction(async (tx) => {
    const revoked = await revokeUserAuthState(tx, id);
    await writeAdminAuditLog(tx, {
      organizationId: orgId,
      actorUserId,
      sessionId: audit.sessionId,
      ip: audit.ip,
      timezone: audit.timezone,
      actionType: "user_sessions_revoked",
      metadata: { userId: id, sessionsRevoked: revoked.sessionsRevoked },
    });
    return revoked;
  });

  emitSystemLog("security", "info", "user_sessions_revoked", {
    targetUserId: user.id,
    targetEmail: user.email,
    sessionsRevoked,
    actorUserId,
    actorEmail: await resolveActorEmailForLog(db, actorUserId),
  });

  return c.json({ ok: true, sessionsRevoked });
}
