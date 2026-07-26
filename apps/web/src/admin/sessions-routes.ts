import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";
import {
  canManageInstance,
  revokeSession,
  revokeAllOperatorSessionsForEvent,
  runInTransaction,
} from "@admitto/auth";
import { writeAdminAuditLog } from "@admitto/tickets";
import { adminAuditFromContext, assertEventManageAccess } from "./admin-helpers.js";
import { resolveInstanceOrganizationId } from "./instance-org.js";

async function requireSuperadmin(c: Context, db: PrismaClient): Promise<Response | null> {
  const auth = c.get("auth");
  if (!(await canManageInstance(db, auth.userId))) return c.json({ error: "forbidden" }, 403);
  return null;
}

const ROLE_PRIORITY: Record<string, number> = { superadmin: 3, admin: 2, operator: 1 };

function highestRole(assignments: { role: string }[]): string {
  if (!assignments.length) return "operator";
  return assignments.reduce(
    (best, a) => ((ROLE_PRIORITY[a.role] ?? 0) > (ROLE_PRIORITY[best] ?? 0) ? a.role : best),
    "operator",
  );
}

/** GET /api/admin/sessions — list all active, non-expired sessions with user, role, and isCurrent flag. Superadmin only. */
export async function handleGetSessions(c: Context, db: PrismaClient): Promise<Response> {
  const denied = await requireSuperadmin(c, db);
  if (denied) return denied;

  const rows = await db.session.findMany({
    where: { revoked_at: null, expires_at: { gt: new Date() } },
    include: { user: { include: { role_assignments: true } } },
    orderBy: { last_seen_at: "desc" },
  });

  const currentSessionId = c.get("auth").sessionId;
  const roleFilter = c.req.query("role");

  let sessions = rows.map((s) => ({
    id: s.id,
    userId: s.user_id,
    userEmail: s.user.email,
    userDisplayName: s.user.display_name ?? null,
    role: highestRole(s.user.role_assignments),
    deviceLabel: s.device_label,
    ip: s.ip,
    userAgent: s.user_agent,
    loginAt: s.created_at.toISOString(),
    lastSeenAt: s.last_seen_at.toISOString(),
    expiresAt: s.expires_at.toISOString(),
    authMethod: s.auth_method,
    stage: s.stage,
    isCurrent: !!currentSessionId && s.id === currentSessionId,
  }));

  if (roleFilter === "admin") {
    sessions = sessions.filter(
      (s) => s.role === "admin" || s.role === "superadmin",
    );
  } else if (roleFilter === "operator") {
    sessions = sessions.filter((s) => s.role === "operator");
  }

  return c.json({ sessions });
}

/** POST /api/admin/sessions/:id/revoke — revoke a single session. Self-revoke returns 403. Idempotent. Superadmin only. */
export async function handleRevokeSession(c: Context, db: PrismaClient): Promise<Response> {
  const denied = await requireSuperadmin(c, db);
  if (denied) return denied;

  const id = c.req.param("id") ?? "";
  if (!id) return c.json({ error: "session id required" }, 400);
  const currentSessionId = c.get("auth").sessionId;

  if (currentSessionId && id === currentSessionId) {
    return c.json({ code: "cannot_revoke_own_session" }, 403);
  }

  const row = await db.session.findUnique({ where: { id }, select: { user_id: true } });
  if (!row) return c.json({}, 200);

  const orgId = await resolveInstanceOrganizationId(db);
  const audit = adminAuditFromContext(c);
  await runInTransaction(db, async (tx) => {
    // Re-check inside the transaction: two concurrent revoke calls (or a retry after the
    // first already succeeded) can both reach here before either commits. Only the one that
    // actually revoked the session gets audited.
    const revoked = await revokeSession(tx, id);
    if (!revoked) return;
    await writeAdminAuditLog(tx, {
      organizationId: orgId,
      actorUserId: audit.operator ?? c.get("auth").userId,
      sessionId: audit.sessionId,
      ip: audit.ip,
      timezone: audit.timezone,
      actionType: "session_revoked",
      metadata: { session_id: id, target_user_id: row.user_id },
    });
  });

  return c.json({}, 200);
}

/** POST /api/admin/events/:eventId/revoke-all-operator-sessions — bulk-revoke all operator sessions for an event. Superadmin only. */
export async function handleRevokeAllOperatorSessions(
  c: Context,
  db: PrismaClient,
): Promise<Response> {
  const superadminDenied = await requireSuperadmin(c, db);
  if (superadminDenied) return superadminDenied;

  const eventId = c.req.param("eventId") ?? "";
  if (!eventId) return c.json({ error: "eventId required" }, 400);
  const eventDenied = await assertEventManageAccess(c, db, eventId);
  if (eventDenied) return eventDenied;

  const revokedCount = await revokeAllOperatorSessionsForEvent(db, eventId);

  const orgId = await resolveInstanceOrganizationId(db);
  const audit = adminAuditFromContext(c);
  await writeAdminAuditLog(db, {
    organizationId: orgId,
    actorUserId: audit.operator ?? c.get("auth").userId,
    sessionId: audit.sessionId,
    ip: audit.ip,
    timezone: audit.timezone,
    actionType: "operator_sessions_bulk_revoked",
    metadata: { eventId, revokedCount },
  });

  return c.json({ revokedCount });
}
