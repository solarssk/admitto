import type { Context } from "hono";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  canManageInstance,
  createUser,
  hashPassword,
  normalizeEmail,
  resetUserMfa,
  revokeUserAuthState,
} from "@admitto/auth";
import { hasScope, ROLES, SCOPE_TYPES, type Role, type ScopeType } from "@admitto/db";
import { writeAdminAuditLog } from "@admitto/tickets";
import { adminAuditFromContext, positiveIntQuery } from "./admin-helpers.js";
import { resolveInstanceOrganizationId } from "./instance-org.js";

const MIN_PASSWORD_LEN = 8;

async function requireSuperadmin(c: Context, db: PrismaClient): Promise<Response | null> {
  const auth = c.get("auth");
  if (!(await canManageInstance(db, auth.userId))) return c.json({ error: "forbidden" }, 403);
  return null;
}

async function countSuperadminAssignments(db: PrismaClient): Promise<number> {
  return db.roleAssignment.count({
    where: {
      role: "superadmin",
      scope_type: "instance",
      scope_id: null,
      user: { is_active: true },
    },
  });
}

async function targetIsSuperadmin(db: PrismaClient, userId: string): Promise<boolean> {
  return hasScope(db, userId, "superadmin", "instance");
}

type UserWithRoles = Prisma.UserGetPayload<{
  include: {
    role_assignments: { include: { oidc_role_grants: { select: { id: true } } } };
    mfa_methods: { select: { id: true; confirmed_at: true } };
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
  const [sessions, activeCounts] = await Promise.all([
    db.session.findMany({
      where: { user_id: { in: userIds } },
      select: { user_id: true, created_at: true },
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

  for (const session of sessions) {
    const entry = stats.get(session.user_id);
    if (!entry) continue;
    const iso = session.created_at.toISOString();
    if (!entry.last_login_at || iso > entry.last_login_at) {
      entry.last_login_at = iso;
    }
  }

  return stats;
}

function serializeUserRow(user: UserWithRoles, sessionStats: SessionStats) {
  return {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    is_active: user.is_active,
    must_change_password: user.must_change_password,
    created_at: user.created_at.toISOString(),
    last_login_at: sessionStats.last_login_at,
    active_sessions_count: sessionStats.active_sessions_count,
    has_mfa: user.mfa_methods.some((m) => m.confirmed_at != null),
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
  const scopeId =
    scopeIdRaw == null || scopeIdRaw === ""
      ? null
      : typeof scopeIdRaw === "string"
        ? scopeIdRaw
        : null;

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

/** POST /api/admin/users — create account (superadmin only). */
export async function handlePostUser(c: Context, db: PrismaClient): Promise<Response> {
  const denied = await requireSuperadmin(c, db);
  if (denied) return denied;

  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const emailRaw = typeof body?.email === "string" ? body.email : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const displayName =
    typeof body?.display_name === "string" ? body.display_name.trim() || null : null;
  const mustChange = body?.must_change_password === true;

  const email = normalizeEmail(emailRaw);
  if (!email || password.length < MIN_PASSWORD_LEN) {
    return c.json({ error: "invalid_request" }, 400);
  }

  let created;
  try {
    created = await createUser(db, {
      email,
      password,
      displayName: displayName ?? undefined,
      isActive: true,
      mustChangePassword: mustChange,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return c.json({ code: "email_conflict", error: "email_taken" }, 409);
    }
    throw err;
  }

  const user = await loadUser(db, created.id);
  if (!user) return c.json({ error: "not_found" }, 404);

  const orgId = await resolveInstanceOrganizationId(db);
  const audit = adminAuditFromContext(c);
  await writeAdminAuditLog(db, {
    organizationId: orgId,
    actorUserId: audit.operator ?? c.get("auth").userId,
    sessionId: audit.sessionId,
    ip: audit.ip,
    actionType: "user_created",
    metadata: { userId: user.id, email: user.email },
  });

  return c.json({ user: await serializeUser(db, user) }, 201);
}

/** PATCH /api/admin/users/:id — update profile / active flag (superadmin only). */
export async function handlePatchUser(c: Context, db: PrismaClient): Promise<Response> {
  const denied = await requireSuperadmin(c, db);
  if (denied) return denied;

  const id = c.req.param("id") ?? "";
  if (!id) return c.json({ error: "user id required" }, 400);

  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const actorId = c.get("auth").userId;

  const data: Prisma.UserUpdateInput = {};
  if (typeof body?.display_name === "string") {
    data.display_name = body.display_name.trim() || null;
  }
  if (typeof body?.is_active === "boolean") {
    if (body.is_active === false && id === actorId) {
      return c.json({ code: "cannot_deactivate_self" }, 409);
    }
    if (body.is_active === false && (await targetIsSuperadmin(db, id))) {
      const superadmins = await countSuperadminAssignments(db);
      if (superadmins <= 1) return c.json({ code: "last_superadmin" }, 409);
    }
    data.is_active = body.is_active;
  }

  if (Object.keys(data).length === 0) return c.json({ error: "invalid_request" }, 400);

  const before = await db.user.findUnique({ where: { id }, select: { is_active: true } });
  if (!before) return c.json({ error: "not_found" }, 404);

  await db.user.update({ where: { id }, data });

  if (data.is_active === false) {
    await revokeUserAuthState(db, id);
  }

  const user = await loadUser(db, id);
  if (!user) return c.json({ error: "not_found" }, 404);

  const orgId = await resolveInstanceOrganizationId(db);
  const audit = adminAuditFromContext(c);
  let actionType = "user_profile_updated";
  if (typeof data.is_active === "boolean" && data.is_active !== before.is_active) {
    actionType = data.is_active ? "user_reactivated" : "user_deactivated";
  }
  await writeAdminAuditLog(db, {
    organizationId: orgId,
    actorUserId: audit.operator ?? actorId,
    sessionId: audit.sessionId,
    ip: audit.ip,
    actionType,
    metadata: { userId: id },
  });

  return c.json({ user: await serializeUser(db, user) });
}

/** POST /api/admin/users/:id/roles — grant role assignment. */
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

  const target = await db.user.findUnique({ where: { id }, select: { id: true } });
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

  const assignment = await db.roleAssignment.create({
    data: {
      user_id: id,
      role: parsed.role,
      scope_type: parsed.scopeType,
      scope_id: parsed.scopeId,
    },
  });

  const orgId = await resolveInstanceOrganizationId(db);
  const audit = adminAuditFromContext(c);
  await writeAdminAuditLog(db, {
    organizationId: orgId,
    actorUserId: audit.operator ?? actorId,
    sessionId: audit.sessionId,
    ip: audit.ip,
    actionType: "role_granted",
    metadata: {
      userId: id,
      role: parsed.role,
      scopeType: parsed.scopeType,
      scopeId: parsed.scopeId,
    },
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
    include: { oidc_role_grants: { select: { id: true } } },
  });
  if (!assignment) {
    if (actorIsSuperadmin) return c.body(null, 204);
    return c.json({ error: "forbidden" }, 403);
  }

  const revokeDenied = await assertRoleRevokeAllowed(c, db, actorId, assignment);
  if (revokeDenied) return revokeDenied;

  if (assignment.oidc_role_grants.length > 0) {
    return c.json({ code: "managed_by_idp" }, 409);
  }

  if (assignment.role === "superadmin" && assignment.scope_type === "instance") {
    const superadmins = await countSuperadminAssignments(db);
    if (superadmins <= 1) return c.json({ code: "last_superadmin" }, 409);
  }

  await db.roleAssignment.delete({ where: { id: assignmentId } });

  const orgId = await resolveInstanceOrganizationId(db);
  const audit = adminAuditFromContext(c);
  await writeAdminAuditLog(db, {
    organizationId: orgId,
    actorUserId: audit.operator ?? actorId,
    sessionId: audit.sessionId,
    ip: audit.ip,
    actionType: "role_revoked",
    metadata: {
      userId: id,
      role: assignment.role,
      scopeType: assignment.scope_type,
      scopeId: assignment.scope_id,
    },
  });

  return c.body(null, 204);
}

/** POST /api/admin/users/:id/reset-2fa — remove MFA methods and revoke sessions. */
export async function handlePostResetUserMfa(c: Context, db: PrismaClient): Promise<Response> {
  const denied = await requireSuperadmin(c, db);
  if (denied) return denied;

  const id = c.req.param("id") ?? "";
  if (!id) return c.json({ error: "user id required" }, 400);

  const user = await db.user.findUnique({ where: { id }, select: { id: true } });
  if (!user) return c.json({ error: "not_found" }, 404);

  await resetUserMfa(db, id);

  const orgId = await resolveInstanceOrganizationId(db);
  const audit = adminAuditFromContext(c);
  await writeAdminAuditLog(db, {
    organizationId: orgId,
    actorUserId: audit.operator ?? c.get("auth").userId,
    sessionId: audit.sessionId,
    ip: audit.ip,
    actionType: "user_mfa_reset",
    metadata: { userId: id },
  });

  return c.json({ ok: true });
}

/** POST /api/admin/users/:id/reset-password — set temporary password and revoke sessions. */
export async function handlePostResetUserPassword(c: Context, db: PrismaClient): Promise<Response> {
  const denied = await requireSuperadmin(c, db);
  if (denied) return denied;

  const id = c.req.param("id") ?? "";
  if (!id) return c.json({ error: "user id required" }, 400);

  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const newPassword = typeof body?.new_password === "string" ? body.new_password : "";
  if (newPassword.length < MIN_PASSWORD_LEN) return c.json({ error: "invalid_request" }, 400);

  const user = await db.user.findUnique({ where: { id }, select: { id: true } });
  if (!user) return c.json({ error: "not_found" }, 404);

  const hash = await hashPassword(newPassword);
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data: { password_hash: hash, must_change_password: true },
    });
    await revokeUserAuthState(tx, id);
  });

  const orgId = await resolveInstanceOrganizationId(db);
  const audit = adminAuditFromContext(c);
  await writeAdminAuditLog(db, {
    organizationId: orgId,
    actorUserId: audit.operator ?? c.get("auth").userId,
    sessionId: audit.sessionId,
    ip: audit.ip,
    actionType: "user_password_reset",
    metadata: { userId: id },
  });

  return c.json({ ok: true });
}

/** POST /api/admin/users/:id/revoke-sessions — revoke all sessions for a user. */
export async function handlePostRevokeUserSessions(c: Context, db: PrismaClient): Promise<Response> {
  const denied = await requireSuperadmin(c, db);
  if (denied) return denied;

  const id = c.req.param("id") ?? "";
  if (!id) return c.json({ error: "user id required" }, 400);

  const user = await db.user.findUnique({ where: { id }, select: { id: true } });
  if (!user) return c.json({ error: "not_found" }, 404);

  const { sessionsRevoked } = await revokeUserAuthState(db, id);

  const orgId = await resolveInstanceOrganizationId(db);
  const audit = adminAuditFromContext(c);
  await writeAdminAuditLog(db, {
    organizationId: orgId,
    actorUserId: audit.operator ?? c.get("auth").userId,
    sessionId: audit.sessionId,
    ip: audit.ip,
    actionType: "user_sessions_revoked",
    metadata: { userId: id, sessionsRevoked },
  });

  return c.json({ ok: true, sessionsRevoked });
}
