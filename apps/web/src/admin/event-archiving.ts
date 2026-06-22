/**
 * Event archive / unarchive and admin read-only guard (ADR 0022).
 *
 * Check-in routes (`/api/checkin/*`) are intentionally excluded from `withEventArchiveGuard`:
 * archive is expected after the event day, but operators may still need late check-in on a
 * closed admin lifecycle. Admin mutating APIs remain blocked via `event_archived`.
 */
import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";
import { canManageInstance } from "@admitto/auth";
import { writeAdminAuditLog } from "@admitto/tickets";
import { adminAuditFromContext, assertEventManageAccess, requireEventId } from "./admin-helpers.js";

/** Return 403 when the session user is not a superadmin; otherwise null. */
async function requireSuperadmin(c: Context, db: PrismaClient): Promise<Response | null> {
  const auth = c.get("auth");
  if (!(await canManageInstance(db, auth.userId))) {
    return c.json({ error: "forbidden" }, 403);
  }
  return null;
}

/** Result of attempting to archive an event (domain layer, no HTTP). */
export type ArchiveDomainResult = { ok: true } | { code: "already_archived" | "not_found" };

/** Result of attempting to unarchive an event (domain layer, no HTTP). */
export type UnarchiveDomainResult = { ok: true } | { code: "not_found" | "not_archived" };

type ArchiveActor = { userId: string };

/** Set archived_at on an active event; audit on success (conditional update, no TOCTOU). */
export async function archiveEvent(
  db: PrismaClient,
  eventId: string,
  actor: ArchiveActor,
  ip: string | null | undefined,
  sessionId: string | null | undefined,
): Promise<ArchiveDomainResult> {
  const updated = await db.event.updateMany({
    where: { id: eventId, archived_at: null },
    data: { archived_at: new Date() },
  });

  if (updated.count === 1) {
    const event = await db.event.findUnique({
      where: { id: eventId },
      select: { organization_id: true },
    });
    if (event) {
      try {
        await writeAdminAuditLog(db, {
          organizationId: event.organization_id,
          actorUserId: actor.userId,
          sessionId,
          ip,
          actionType: "event_archived",
          metadata: { eventId },
        });
      } catch (auditErr) {
        console.error("[audit] event_archived log failed", auditErr);
      }
    }
    return { ok: true };
  }

  const exists = await db.event.findUnique({
    where: { id: eventId },
    select: { id: true },
  });
  if (!exists) return { code: "not_found" };
  return { code: "already_archived" };
}

/** Clear archived_at when currently archived; audit only on successful transition. */
export async function unarchiveEvent(
  db: PrismaClient,
  eventId: string,
  actor: ArchiveActor,
  ip: string | null | undefined,
  sessionId: string | null | undefined,
): Promise<UnarchiveDomainResult> {
  const updated = await db.event.updateMany({
    where: { id: eventId, archived_at: { not: null } },
    data: { archived_at: null },
  });

  if (updated.count === 1) {
    const event = await db.event.findUnique({
      where: { id: eventId },
      select: { organization_id: true },
    });
    if (event) {
      try {
        await writeAdminAuditLog(db, {
          organizationId: event.organization_id,
          actorUserId: actor.userId,
          sessionId,
          ip,
          actionType: "event_unarchived",
          metadata: { eventId },
        });
      } catch (auditErr) {
        console.error("[audit] event_unarchived log failed", auditErr);
      }
    }
    return { ok: true };
  }

  const exists = await db.event.findUnique({
    where: { id: eventId },
    select: { id: true },
  });
  if (!exists) return { code: "not_found" };
  return { code: "not_archived" };
}

/** Return 403 when the event is archived; otherwise null. Caller must run manage-access first. */
export async function assertEventNotArchived(
  c: Context,
  db: PrismaClient,
  eventId: string,
): Promise<Response | null> {
  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { archived_at: true },
  });
  if (!event) return null;
  if (event.archived_at) return c.json({ code: "event_archived" }, 403);
  return null;
}

type EventRouteHandler = (c: Context) => Response | Promise<Response>;

/** Wrap a mutating handler: manage access first, then block archived events.
 *  Note: archive status is checked before the handler runs; a concurrent archive between
 *  check and write is a narrow race accepted for MVP (superadmin-only archive action). */
export function withEventArchiveGuard(
  db: PrismaClient,
  handler: EventRouteHandler,
): EventRouteHandler {
  return async (c) => {
    const eventId = c.req.param("eventId");
    if (!eventId) return c.json({ error: "eventId required" }, 400);
    const forbidden = await assertEventManageAccess(c, db, eventId);
    if (forbidden) return forbidden;
    const blocked = await assertEventNotArchived(c, db, eventId);
    if (blocked) return blocked;
    return handler(c);
  };
}

/** POST /api/admin/events/:eventId/archive */
export async function handlePostArchiveEvent(c: Context, db: PrismaClient): Promise<Response> {
  const forbidden = await requireSuperadmin(c, db);
  if (forbidden) return forbidden;

  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const audit = adminAuditFromContext(c);
  const result = await archiveEvent(db, eventId, { userId: audit.operator! }, audit.ip, audit.sessionId);

  if ("code" in result) {
    if (result.code === "not_found") return c.json({ error: "not_found" }, 404);
    if (result.code === "already_archived") return c.json({ code: "already_archived" }, 409);
  }

  return c.json({ ok: true });
}

/** POST /api/admin/events/:eventId/unarchive */
export async function handlePostUnarchiveEvent(c: Context, db: PrismaClient): Promise<Response> {
  const forbidden = await requireSuperadmin(c, db);
  if (forbidden) return forbidden;

  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const audit = adminAuditFromContext(c);
  const result = await unarchiveEvent(db, eventId, { userId: audit.operator! }, audit.ip, audit.sessionId);

  if ("code" in result) {
    if (result.code === "not_found") return c.json({ error: "not_found" }, 404);
    if (result.code === "not_archived") return c.json({ code: "not_archived" }, 409);
  }

  return c.json({ ok: true });
}
