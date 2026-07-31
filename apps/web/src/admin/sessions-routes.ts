import type { Context } from "hono";
import type { PrismaClient } from "@admitto/db";
import {
  canManageInstance,
  revokeSession,
  revokeAllOperatorSessionsForEvent,
  runInTransaction,
  updateSessionDeviceLabel,
  DEVICE_LABEL_MAX_LEN,
} from "@admitto/auth";
import { writeAdminAuditLog } from "@admitto/tickets";
import { emitSystemLog } from "@admitto/shared/system-log";
import {
  adminAuditFromContext,
  assertEventManageAccess,
  resolveActorEmailForLog,
} from "./admin-helpers.js";
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

  const row = await db.session.findUnique({
    where: { id },
    select: { user_id: true, user: { select: { email: true } } },
  });
  if (!row) return c.json({}, 200);

  const orgId = await resolveInstanceOrganizationId(db);
  const audit = adminAuditFromContext(c);
  const actorUserId = audit.operator ?? c.get("auth").userId;
  const revoked = await runInTransaction(db, async (tx) => {
    // Re-check inside the transaction: two concurrent revoke calls (or a retry after the
    // first already succeeded) can both reach here before either commits. Only the one that
    // actually revoked the session gets audited.
    const wasRevoked = await revokeSession(tx, id);
    if (!wasRevoked) return false;
    await writeAdminAuditLog(tx, {
      organizationId: orgId,
      actorUserId,
      sessionId: audit.sessionId,
      ip: audit.ip,
      timezone: audit.timezone,
      actionType: "session_revoked",
      metadata: { session_id: id, target_user_id: row.user_id },
    });
    return true;
  });

  // Emitted after the transaction has committed (CodeRabbit review) - emitSystemLog is not
  // transactional, so logging it from inside the callback above would record a revoke the
  // transaction could still roll back on a later statement/commit failure.
  if (revoked) {
    emitSystemLog("security", "info", "session_revoked", {
      sessionId: id,
      targetUserId: row.user_id,
      targetEmail: row.user.email,
      actorUserId,
      actorEmail: await resolveActorEmailForLog(db, actorUserId),
      ip: audit.ip,
    });
  }

  return c.json({}, 200);
}

/** POST /api/admin/sessions/:id/device-label — correct a session's device label (typo fix).
 * 404 if the session doesn't exist; 409 if it exists but is no longer editable (revoked, expired,
 * or not full-stage) - updateSessionDeviceLabel's own guard already covers this, this just turns
 * its boolean into a response the UI can distinguish from success. Superadmin only. */
export async function handleUpdateSessionDeviceLabel(c: Context, db: PrismaClient): Promise<Response> {
  const denied = await requireSuperadmin(c, db);
  if (denied) return denied;

  // No `?? "" `/`!id` guard here (unlike handleRevokeSession above): confirmed empirically that
  // Hono's router itself 404s before this handler runs for any request where the `:id` segment
  // would be empty (a doubled slash, a bare ".") - c.req.param("id") can only ever be a non-empty
  // string once we're here, so that check can only ever be dead code for this specific route.
  // The assertion matches the same already-established convention for a route-guaranteed param
  // (attendees-api-routes.ts, rate-limit/policies.ts).
  const id = c.req.param("id")!;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  const raw =
    body && typeof body === "object" && "deviceLabel" in body
      ? (body as { deviceLabel?: unknown }).deviceLabel
      : undefined;

  if (raw !== undefined && raw !== null && typeof raw !== "string") {
    return c.json({ error: "invalid_device_label" }, 400);
  }

  const label = typeof raw === "string" ? raw.trim() : "";
  if (label.length > DEVICE_LABEL_MAX_LEN) {
    return c.json({ error: "device_label_too_long" }, 400);
  }

  const newLabel = label.length > 0 ? label : null;
  const orgId = await resolveInstanceOrganizationId(db);
  const audit = adminAuditFromContext(c);
  // No `?? c.get("auth").userId` fallback here (unlike handleRevokeSession above):
  // adminAuditFromContext sets operator: auth.userId directly, so that fallback can only ever be
  // dead code - c.get("auth").userId is what audit.operator already equals, not a distinct value.
  const actorUserId = c.get("auth").userId;

  type LabelUpdateResult =
    | { status: "not_found" }
    | { status: "not_editable" }
    | { status: "ok"; targetUserId: string };

  // Transactional like handleRevokeSession above (CodeRabbit review): without this, an audit-log
  // or org-lookup failure after the label already changed would return an error while the label
  // stays changed - a retry then reads the already-new label as "previous", losing the real one.
  //
  // The row itself is fetched here with FOR UPDATE, inside the transaction, rather than before it
  // starts (CodeRabbit review): two concurrent edits of the same session could otherwise both
  // read the same starting label before either writes, so the second edit's audit entry would
  // record that shared stale value as previous_label instead of the first edit's actual result.
  // The lock makes the second transaction wait for the first to commit, so it reads the
  // already-updated label as its own "previous" once it resumes.
  const result = await runInTransaction(db, async (tx): Promise<LabelUpdateResult> => {
    const locked = await tx.$queryRaw<{ user_id: string; device_label: string | null }[]>`
      SELECT user_id, device_label FROM "Session" WHERE id = ${id} FOR UPDATE
    `;
    const row = locked[0];
    if (!row) return { status: "not_found" };

    const ok = await updateSessionDeviceLabel(tx, id, row.user_id, newLabel);
    if (!ok) return { status: "not_editable" };

    await writeAdminAuditLog(tx, {
      organizationId: orgId,
      actorUserId,
      sessionId: audit.sessionId,
      ip: audit.ip,
      timezone: audit.timezone,
      actionType: "session_device_label_updated",
      metadata: {
        session_id: id,
        target_user_id: row.user_id,
        previous_label: row.device_label,
        new_label: newLabel,
      },
    });
    return { status: "ok", targetUserId: row.user_id };
  });
  if (result.status === "not_found") return c.json({ error: "not_found" }, 404);
  if (result.status === "not_editable") return c.json({ error: "session_not_editable" }, 409);

  // Emitted after the transaction has committed (mirrors handleRevokeSession above). IDs only,
  // no previous/new label: unlike targetUserId/actorUserId, a device label is free-form text an
  // operator chose (could itself be a person's name) - the durable, superadmin-only audit entry
  // above already captures both values, so the broader-audience system log doesn't need its own
  // copy (CodeRabbit review, AGENTS.md "no unnecessary PII in logs").
  emitSystemLog("security", "info", "session_device_label_updated", {
    sessionId: id,
    targetUserId: result.targetUserId,
    actorUserId,
    ip: audit.ip,
  });

  return c.json({ deviceLabel: newLabel }, 200);
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
  const actorUserId = audit.operator ?? c.get("auth").userId;
  const event = await db.event.findUnique({ where: { id: eventId }, select: { title: true } });
  await writeAdminAuditLog(db, {
    organizationId: orgId,
    actorUserId,
    sessionId: audit.sessionId,
    ip: audit.ip,
    timezone: audit.timezone,
    actionType: "operator_sessions_bulk_revoked",
    metadata: { eventId, revokedCount },
  });
  emitSystemLog("security", "info", "operator_sessions_bulk_revoked", {
    eventId,
    eventTitle: event?.title ?? null,
    revokedCount,
    actorUserId,
    actorEmail: await resolveActorEmailForLog(db, actorUserId),
    ip: audit.ip,
  });

  return c.json({ revokedCount });
}
