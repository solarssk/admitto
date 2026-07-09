/**
 * Superadmin permanent event deletion (#395).
 *
 * Delete is only reachable for events that are already archived (archiving stays the
 * reversible safety net — see event-archiving.ts) AND show zero real activity across
 * six independent signals. Both the Event Settings DTO hint (`is_deletable`, shown to
 * disable the button in the UI) and the actual delete route re-run the exact same
 * `isEventDeletable` check against the exact same `EventActivitySignals`, so the UI
 * hint and the enforced guard can never drift apart.
 *
 * FK graph note: Attendee.event_id has no cascade, so 0 attendees transitively means 0
 * CheckIn/EmailDelivery/WalletPass rows (those all require an Attendee row first, and the
 * existing attendee-delete route already cleans them up transactionally — see
 * attendees-api-routes.ts). EventItem/EventContact/EventResource cascade on event delete.
 * MailTemplate has no FK to Event (matched by scope_id string) so it can't block the
 * delete at the DB level — the guard checks it explicitly, and the transaction below
 * defensively removes any event-scoped template so nothing is left orphaned.
 */
import type { Context } from "hono";
import type { Prisma, PrismaClient } from "@prisma/client";
import { BADGE_ITEM_KEY, writeAdminAuditLog } from "@admitto/tickets";
import { requireAuditActor, requireEventId, requireSuperadmin } from "./admin-helpers.js";

type DbClient = PrismaClient | Prisma.TransactionClient;

/** Zero-cost-to-compute signals of real event activity, used by the deletability guard. */
export type EventActivitySignals = {
  attendeeCount: number;
  nonBadgeItemCount: number;
  contactCount: number;
  resourceCount: number;
  eventMailTemplateCount: number;
};

/** Count the six activity signals for one event. Cheap, indexed, single round-trip. */
export async function countEventActivitySignals(
  db: DbClient,
  eventId: string,
): Promise<EventActivitySignals> {
  const [attendeeCount, nonBadgeItemCount, contactCount, resourceCount, eventMailTemplateCount] =
    await Promise.all([
      db.attendee.count({ where: { event_id: eventId } }),
      db.eventItem.count({ where: { event_id: eventId, key: { not: BADGE_ITEM_KEY } } }),
      db.eventContact.count({ where: { event_id: eventId } }),
      db.eventResource.count({ where: { event_id: eventId } }),
      db.mailTemplate.count({ where: { scope_type: "event", scope_id: eventId } }),
    ]);
  return { attendeeCount, nonBadgeItemCount, contactCount, resourceCount, eventMailTemplateCount };
}

/**
 * All 7 conditions must hold: archived (reuses the reversible archive lifecycle as the
 * safety net), no pinned note, and all 5 activity signals at zero. Pure/sync so it is
 * trivially unit-testable and can never diverge between the DTO computation and the
 * actual delete route — both call this against the same signals.
 */
export function isEventDeletable(
  event: { archived_at: Date | null; pinned_note: string | null },
  signals: EventActivitySignals,
): boolean {
  return (
    event.archived_at !== null &&
    event.pinned_note === null &&
    signals.attendeeCount === 0 &&
    signals.nonBadgeItemCount === 0 &&
    signals.contactCount === 0 &&
    signals.resourceCount === 0 &&
    signals.eventMailTemplateCount === 0
  );
}

/** Result of attempting to delete an event (domain layer, no HTTP). */
export type DeleteEventResult = { ok: true } | { code: "not_found" | "not_deletable" | "audit_failed" };

type DeleteActor = { userId: string };

/**
 * Permanently delete an event. Re-validates `isEventDeletable` server-side inside the
 * transaction (never trust the client / the settings DTO the UI last saw) before the
 * actual delete, so a concurrent change to the event between page-load and click can only
 * ever make this stricter, never bypass it.
 */
export async function deleteEvent(
  db: PrismaClient,
  eventId: string,
  actor: DeleteActor,
  ip: string | null | undefined,
  sessionId: string | null | undefined,
): Promise<DeleteEventResult> {
  try {
    const outcome = await db.$transaction(async (tx) => {
      const event = await tx.event.findUnique({
        where: { id: eventId },
        select: { archived_at: true, pinned_note: true, organization_id: true },
      });
      if (!event) return { kind: "not_found" as const };

      const signals = await countEventActivitySignals(tx, eventId);
      if (!isEventDeletable(event, signals)) return { kind: "not_deletable" as const };

      // Defensive cleanup: MailTemplate has no FK to Event, so this is a no-op given the
      // guard above already requires eventMailTemplateCount === 0 — kept so a deleted
      // event can never leave an orphaned scope_id behind under any future race.
      await tx.mailTemplate.deleteMany({ where: { scope_type: "event", scope_id: eventId } });

      await tx.event.delete({ where: { id: eventId } });

      await writeAdminAuditLog(tx, {
        organizationId: event.organization_id,
        actorUserId: actor.userId,
        sessionId,
        ip,
        actionType: "event_deleted",
        metadata: { eventId },
      });
      return { kind: "ok" as const };
    });

    if (outcome.kind === "not_found") return { code: "not_found" };
    if (outcome.kind === "not_deletable") return { code: "not_deletable" };
    return { ok: true };
  } catch (err) {
    console.error("[audit] event_deleted transaction failed", err);
    return { code: "audit_failed" };
  }
}

/** DELETE /api/admin/events/:eventId */
export async function handleDeleteEvent(c: Context, db: PrismaClient): Promise<Response> {
  const forbidden = await requireSuperadmin(c, db);
  if (forbidden) return forbidden;

  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const audit = requireAuditActor(c);
  if (audit instanceof Response) return audit;

  const result = await deleteEvent(db, eventId, { userId: audit.operator }, audit.ip, audit.sessionId);

  if ("code" in result) {
    if (result.code === "not_found") return c.json({ error: "not_found" }, 404);
    if (result.code === "not_deletable") return c.json({ error: "event_not_deletable" }, 409);
    if (result.code === "audit_failed") return c.json({ code: "audit_failed" }, 500);
  }

  return c.json({ ok: true });
}
