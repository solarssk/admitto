/**
 * Event archive / unarchive and read-only guard.
 *
 * Archiving is a terminal, reversible-only-via-unarchive lifecycle state: once archived, an
 * event is fully read-only — no admin mutations and no check-in. Admin mutating APIs are
 * blocked via `withEventArchiveGuard`/`assertEventNotArchived` (`event_archived`); check-in
 * routes (`/api/checkin/*`) reuse the same `assertEventNotArchived` check inside
 * `createCheckinEventScope` (see checkin-gate.ts), for both session and emergency-bearer auth.
 * Complete check-in before archiving an event.
 */
import type { Context } from "hono";
import type { PrismaClient } from "@admitto/db";
import { writeAdminAuditLog } from "@admitto/tickets";
import { emitSystemLog, recordSystemLog } from "@admitto/shared/system-log";
import {
  assertEventManageAccess,
  requireAuditActor,
  requireEventId,
  requireSuperadmin,
  resolveActorEmailForLog,
} from "./admin-helpers.js";

/** Result of attempting to archive an event (domain layer, no HTTP). */
export type ArchiveDomainResult =
  | { ok: true }
  | { code: "already_archived" | "not_found" | "audit_failed" };

/** Result of attempting to unarchive an event (domain layer, no HTTP). */
export type UnarchiveDomainResult =
  | { ok: true }
  | { code: "not_found" | "not_archived" | "audit_failed" };

type ArchiveActor = { userId: string };

/** Shared shape of archiveEvent/unarchiveEvent (SonarCloud S4144: the two were a byte-for-byte
 * duplicate transaction+log skeleton save for the update clause, action name, and the code
 * returned when there's nothing to transition). `NoTransitionCode` is generic so each caller's
 * own return type stays precise (e.g. archiveEvent can never actually return "not_archived")
 * without an unsafe cast. */
async function setEventArchivedState<NoTransitionCode extends string>(
  db: PrismaClient,
  eventId: string,
  actor: ArchiveActor,
  ip: string | null | undefined,
  sessionId: string | null | undefined,
  timezone: string | null | undefined,
  opts: { archiving: boolean; actionType: "event_archived" | "event_unarchived"; noTransitionCode: NoTransitionCode },
): Promise<{ ok: true } | { code: "not_found" | "audit_failed" | NoTransitionCode }> {
  const { archiving, actionType, noTransitionCode } = opts;
  try {
    const outcome = await db.$transaction(async (tx) => {
      const updated = archiving
        ? await tx.event.updateMany({ where: { id: eventId, archived_at: null }, data: { archived_at: new Date() } })
        : await tx.event.updateMany({
            where: { id: eventId, archived_at: { not: null } },
            data: { archived_at: null },
          });
      if (updated.count !== 1) return { kind: "no_transition" as const };

      const event = await tx.event.findUnique({
        where: { id: eventId },
        select: { organization_id: true, title: true },
      });
      if (!event) throw new Error(`event missing after ${actionType} update`);

      await writeAdminAuditLog(tx, {
        organizationId: event.organization_id,
        actorUserId: actor.userId,
        sessionId,
        ip,
        timezone,
        actionType,
        metadata: { eventId },
      });
      return { kind: "ok" as const, eventTitle: event.title };
    });

    if (outcome.kind === "no_transition") {
      const exists = await db.event.findUnique({ where: { id: eventId }, select: { id: true } });
      if (!exists) return { code: "not_found" };
      return { code: noTransitionCode };
    }
    // Best-effort: the transition itself already committed above, so a failure enriching the
    // System-logs entry (e.g. a transient DB error resolving the actor's email) must not
    // report this as a failed archive/unarchive (CodeRabbit review) - own try/catch, outside
    // the one that guards the actual transaction.
    try {
      emitSystemLog("admin", "info", actionType, {
        eventId,
        eventTitle: outcome.eventTitle,
        actorUserId: actor.userId,
        actorEmail: await resolveActorEmailForLog(db, actor.userId),
        ip,
      });
    } catch (logErr) {
      console.error(`[audit] ${actionType} log enrichment failed`, logErr);
    }
    return { ok: true };
  } catch (err) {
    console.error(`[audit] ${actionType} transaction failed`, err);
    recordSystemLog({
      level: "error",
      source: "admin",
      message: `${actionType} transaction failed`,
      fields: { eventId, actorUserId: actor.userId, ip },
    });
    return { code: "audit_failed" };
  }
}

/** Set archived_at on an active event; state change and audit log are one transaction. */
export async function archiveEvent(
  db: PrismaClient,
  eventId: string,
  actor: ArchiveActor,
  ip: string | null | undefined,
  sessionId: string | null | undefined,
  timezone?: string | null,
): Promise<ArchiveDomainResult> {
  return setEventArchivedState(db, eventId, actor, ip, sessionId, timezone, {
    archiving: true,
    actionType: "event_archived",
    noTransitionCode: "already_archived",
  });
}

/** Clear archived_at when currently archived; state change and audit log are one transaction. */
export async function unarchiveEvent(
  db: PrismaClient,
  eventId: string,
  actor: ArchiveActor,
  ip: string | null | undefined,
  sessionId: string | null | undefined,
  timezone?: string | null,
): Promise<UnarchiveDomainResult> {
  return setEventArchivedState(db, eventId, actor, ip, sessionId, timezone, {
    archiving: false,
    actionType: "event_unarchived",
    noTransitionCode: "not_archived",
  });
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

  const audit = requireAuditActor(c);
  if (audit instanceof Response) return audit;

  const result = await archiveEvent(
    db,
    eventId,
    { userId: audit.operator },
    audit.ip,
    audit.sessionId,
    audit.timezone,
  );

  if ("code" in result) {
    if (result.code === "not_found") return c.json({ error: "not_found" }, 404);
    if (result.code === "already_archived") return c.json({ code: "already_archived" }, 409);
    if (result.code === "audit_failed") return c.json({ code: "audit_failed" }, 500);
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

  const audit = requireAuditActor(c);
  if (audit instanceof Response) return audit;

  const result = await unarchiveEvent(
    db,
    eventId,
    { userId: audit.operator },
    audit.ip,
    audit.sessionId,
    audit.timezone,
  );

  if ("code" in result) {
    if (result.code === "not_found") return c.json({ error: "not_found" }, 404);
    if (result.code === "not_archived") return c.json({ code: "not_archived" }, 409);
    if (result.code === "audit_failed") return c.json({ code: "audit_failed" }, 500);
  }

  return c.json({ ok: true });
}
