/**
 * Superadmin permanent event deletion (#395).
 *
 * Delete does not require the event to be archived first — it is reachable for any
 * event (active or archived) that shows zero real activity across seven independent
 * signals plus no pinned note. Archiving is a separate, independently useful action
 * (marks an event read-only/done) but is no longer a delete prerequisite: an event
 * that never had any real activity is equally safe to delete whether or not it has
 * been archived, and requiring an extra archive step first only added friction, not
 * safety, once every activity signal already has to be zero. Both the Event Settings
 * DTO hint (`is_deletable`, shown to disable the button in the UI) and the actual
 * delete route re-run the exact same `isEventDeletable` check against the exact same
 * `EventActivitySignals`, so the UI hint and the enforced guard can never drift apart.
 *
 * FK graph note: Attendee.event_id has no cascade, so 0 attendees transitively means 0
 * CheckIn/EmailDelivery/WalletPass rows (those all require an Attendee row first, and the
 * existing attendee-delete route already cleans them up transactionally — see
 * attendees-api-routes.ts). EventItem/EventContact/EventResource/TicketType cascade on event
 * delete. MailTemplate has no FK to Event (matched by scope_id string) so it can't block the
 * delete at the DB level — the guard checks it explicitly, and the transaction below
 * defensively removes any event-scoped template so nothing is left orphaned.
 * AttendeeActionLog.event_id cascades on event delete too, but — unlike the other
 * cascaded models — its `attendee_id` is optional: bulk actions (report exports, item/
 * config changes, imports, sends) write event-scoped rows with no attendee at all, so
 * this audit trail can hold real history even on an event with 0 attendees. It is
 * checked explicitly below rather than assumed covered by `attendeeCount`.
 */
import type { Context } from "hono";
import { Prisma, type PrismaClient } from "@prisma/client";
import { BADGE_ITEM_KEY, STANDARD_TICKET_TYPE_KEY, writeAdminAuditLog } from "@admitto/tickets";
import {
  lockEventForMailSettingsWrite,
  requireAuditActor,
  requireEventId,
  requireSuperadmin,
} from "./admin-helpers.js";

type DbClient = PrismaClient | Prisma.TransactionClient;

/** Zero-cost-to-compute signals of real event activity, used by the deletability guard. */
export type EventActivitySignals = {
  attendeeCount: number;
  nonBadgeItemCount: number;
  nonStandardTicketTypeCount: number;
  contactCount: number;
  resourceCount: number;
  eventMailTemplateCount: number;
  actionLogCount: number;
};

/** Count the seven activity signals for one event. Cheap, indexed, single round-trip. */
export async function countEventActivitySignals(
  db: DbClient,
  eventId: string,
): Promise<EventActivitySignals> {
  const [
    attendeeCount,
    nonBadgeItemCount,
    nonStandardTicketTypeCount,
    contactCount,
    resourceCount,
    eventMailTemplateCount,
    actionLogCount,
  ] = await Promise.all([
    db.attendee.count({ where: { event_id: eventId } }),
    db.eventItem.count({ where: { event_id: eventId, key: { not: BADGE_ITEM_KEY } } }),
    db.ticketType.count({ where: { event_id: eventId, key: { not: STANDARD_TICKET_TYPE_KEY } } }),
    db.eventContact.count({ where: { event_id: eventId } }),
    db.eventResource.count({ where: { event_id: eventId } }),
    db.mailTemplate.count({ where: { scope_type: "event", scope_id: eventId } }),
    db.attendeeActionLog.count({ where: { event_id: eventId } }),
  ]);
  return {
    attendeeCount,
    nonBadgeItemCount,
    nonStandardTicketTypeCount,
    contactCount,
    resourceCount,
    eventMailTemplateCount,
    actionLogCount,
  };
}

/**
 * All 8 conditions must hold: no pinned note, and all 7 activity signals at zero.
 * Deliberately does NOT require `archived_at` — see the file-level comment above.
 * Pure/sync so it is trivially unit-testable and can never diverge between the DTO
 * computation and the actual delete route — both call this against the same signals.
 */
export function isEventDeletable(
  event: { archived_at: Date | null; pinned_note: string | null },
  signals: EventActivitySignals,
): boolean {
  return (
    event.pinned_note === null &&
    signals.attendeeCount === 0 &&
    signals.nonBadgeItemCount === 0 &&
    signals.nonStandardTicketTypeCount === 0 &&
    signals.contactCount === 0 &&
    signals.resourceCount === 0 &&
    signals.eventMailTemplateCount === 0 &&
    signals.actionLogCount === 0
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
    return await db.$transaction(async (tx): Promise<DeleteEventResult> => {
      // Serializes with the event mail-settings PUT transaction on the same eventId (see
      // that route) — without this, a concurrent PUT can validate the event exists, then
      // this transaction deletes it, then the PUT's upsert recreates an orphaned
      // MailSettings row with no FK to catch it (CodeRabbit review).
      await lockEventForMailSettingsWrite(tx, eventId);

      const event = await tx.event.findUnique({
        where: { id: eventId },
        select: { archived_at: true, pinned_note: true, organization_id: true },
      });
      if (!event) return { code: "not_found" };

      const signals = await countEventActivitySignals(tx, eventId);
      if (!isEventDeletable(event, signals)) return { code: "not_deletable" };

      // Defensive cleanup: MailTemplate has no FK to Event, so this is a no-op given the
      // guard above already requires eventMailTemplateCount === 0 — kept so a deleted
      // event can never leave an orphaned scope_id behind under any future race.
      await tx.mailTemplate.deleteMany({ where: { scope_type: "event", scope_id: eventId } });

      // MailSettings (event-scoped mail transport override, #511) is the same polymorphic
      // scope_type/scope_id pattern with no FK — but unlike MailTemplate it's config, not
      // content/activity, so it's deliberately NOT one of the deletability signals above (an
      // otherwise-empty event with a configured transport override should still be
      // deletable). Clean it up here so a delete never orphans its scope_id.
      await tx.mailSettings.deleteMany({ where: { scope_type: "event", scope_id: eventId } });

      await tx.event.delete({ where: { id: eventId } });

      await writeAdminAuditLog(tx, {
        organizationId: event.organization_id,
        actorUserId: actor.userId,
        sessionId,
        ip,
        actionType: "event_deleted",
        metadata: { eventId },
      });
      return { ok: true };
    });
  } catch (err) {
    // A concurrent change adding real activity between the count-check and the delete
    // (e.g. a new attendee) is caught here as a Postgres FK-restrict rejection — that is
    // the guard working as intended, not an audit-log bug, so it maps to the same
    // "not_deletable" the caller already handles rather than a generic 500.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
      return { code: "not_deletable" };
    }
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
