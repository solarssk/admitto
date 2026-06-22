import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";
import { canManageInstance } from "@admitto/auth";
import { writeAdminAuditLog } from "@admitto/tickets";
import { adminAuditFromContext, requireEventId } from "./admin-helpers.js";

async function requireSuperadmin(c: Context, db: PrismaClient): Promise<Response | null> {
  const auth = c.get("auth");
  if (!(await canManageInstance(db, auth.userId))) {
    return c.json({ error: "forbidden" }, 403);
  }
  return null;
}

export type ArchiveDomainResult = { ok: true } | { code: "already_archived" | "not_found" };

export type UnarchiveDomainResult = { ok: true } | { code: "not_found" };

type ArchiveActor = { userId: string };

/** Set archived_at on an active event; audit on success. */
export async function archiveEvent(
  db: PrismaClient,
  eventId: string,
  actor: ArchiveActor,
  ip: string | null | undefined,
  sessionId: string | null | undefined,
): Promise<ArchiveDomainResult> {
  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { id: true, archived_at: true, organization_id: true },
  });
  if (!event) return { code: "not_found" };
  if (event.archived_at) return { code: "already_archived" };

  await db.event.update({
    where: { id: eventId },
    data: { archived_at: new Date() },
  });

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

  return { ok: true };
}

/** Clear archived_at; audit on success. */
export async function unarchiveEvent(
  db: PrismaClient,
  eventId: string,
  actor: ArchiveActor,
  ip: string | null | undefined,
  sessionId: string | null | undefined,
): Promise<UnarchiveDomainResult> {
  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { id: true, organization_id: true },
  });
  if (!event) return { code: "not_found" };

  await db.event.update({
    where: { id: eventId },
    data: { archived_at: null },
  });

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

  return { ok: true };
}

/** Return 403 when the event is archived; otherwise null. */
export async function assertEventNotArchived(
  c: Context,
  db: PrismaClient,
  eventId: string,
): Promise<Response | null> {
  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { archived_at: true },
  });
  if (!event) return c.json({ error: "not_found" }, 404);
  if (event.archived_at) return c.json({ code: "event_archived" }, 403);
  return null;
}

type EventRouteHandler = (c: Context) => Response | Promise<Response>;

/** Wrap an event-scoped mutating handler with archived guard. */
export function withEventArchiveGuard(
  db: PrismaClient,
  handler: EventRouteHandler,
): EventRouteHandler {
  return async (c) => {
    const eventId = c.req.param("eventId");
    if (!eventId) return c.json({ error: "eventId required" }, 400);
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

  if ("code" in result && result.code === "not_found") return c.json({ error: "not_found" }, 404);

  return c.json({ ok: true });
}
