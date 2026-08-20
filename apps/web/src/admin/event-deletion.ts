/**
 * Superadmin permanent event deletion (#395).
 *
 * Delete does not require the event to be archived first - it is reachable for any
 * event (active or archived) that has no retained attendees or event-specific content
 * across six independent signals plus no pinned note. A saved `ticket` template is the
 * event's replaceable copy of the built-in default, rather than independent event content, so
 * it is removed with the event instead of blocking deletion. Archiving is a separate,
 * independently useful action (marks an event read-only/done) but is no longer a delete
 * prerequisite: an otherwise-empty event is equally safe to delete whether or not it has
 * been archived. Both the Event Settings DTO hint (`is_deletable` / `deletion_blockers`,
 * shown to disable the button in the UI) and the actual delete route re-run the exact
 * same `isEventDeletable` check against the exact same `EventActivitySignals`, so the UI
 * hint and the enforced guard can never drift apart.
 *
 * FK graph note: Attendee.event_id has no cascade, so 0 attendees transitively means 0
 * CheckIn/EmailDelivery/WalletPass rows (those all require an Attendee row first, and the
 * existing attendee-delete route already cleans them up transactionally - see
 * attendees-api-routes.ts). EventItem/EventContact/EventResource/TicketType cascade on event
 * delete. MailTemplate has no FK to Event (matched by scope_id string) so custom templates
 * can't block the delete at the DB level - the guard checks them explicitly, and the transaction
 * below removes all event-scoped templates so nothing is left orphaned.
 * AttendeeActionLog.event_id cascades on event delete too. Operational history (exports,
 * config changes, attendee_erased rows with null attendee_id) is deliberately NOT a
 * deletability signal: demo/test events would otherwise become permanently undeletable after
 * normal use, and lifecycle-sensitive trails (e.g. attendee_erased) are also written to
 * org-level AdminAuditLog, which survives event deletion. EventImageAsset rows cascade too,
 * but managed `/uploads/…` files are deleted post-commit (same as handleDeleteEventImageAsset).
 */
import type { Context } from "hono";
import { Prisma, type PrismaClient } from "@admitto/db";
import { BADGE_ITEM_KEY, STANDARD_TICKET_TYPE_KEY, writeAdminAuditLog } from "@admitto/tickets";
import { emitSystemLog, recordSystemLog } from "@admitto/shared/system-log";
import { bestEffortDeleteReplacedUploadUrls } from "./branding-upload.js";
import {
  lockEventForScopedWrite,
  requireAuditActor,
  requireEventId,
  requireSuperadmin,
  resolveActorEmailForLog,
} from "./admin-helpers.js";

type DbClient = PrismaClient | Prisma.TransactionClient;

/** Stable keys exposed on Event Settings so the Danger zone can name remaining blockers. */
export type EventDeletionBlocker =
  | "attendees"
  | "custom_items"
  | "custom_ticket_types"
  | "contacts"
  | "resources"
  | "pinned_note"
  | "event_mail_template";

/** Zero-cost-to-compute signals of retained event content, used by the deletability guard. */
export type EventActivitySignals = {
  attendeeCount: number;
  nonBadgeItemCount: number;
  nonStandardTicketTypeCount: number;
  contactCount: number;
  resourceCount: number;
  eventMailTemplateCount: number;
};

/** Count the six content signals for one event. Cheap, indexed, single round-trip. */
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
  ] = await Promise.all([
    db.attendee.count({ where: { event_id: eventId } }),
    db.eventItem.count({ where: { event_id: eventId, key: { not: BADGE_ITEM_KEY } } }),
    db.ticketType.count({ where: { event_id: eventId, key: { not: STANDARD_TICKET_TYPE_KEY } } }),
    db.eventContact.count({ where: { event_id: eventId } }),
    db.eventResource.count({ where: { event_id: eventId } }),
    // A saved `ticket` row is only an event-local override of the built-in default. It cannot
    // be deleted on its own, but permanent event deletion can safely discard it. Only additional
    // templates represent retained event content.
    db.mailTemplate.count({
      where: { scope_type: "event", scope_id: eventId, name: { not: "ticket" } },
    }),
  ]);
  return {
    attendeeCount,
    nonBadgeItemCount,
    nonStandardTicketTypeCount,
    contactCount,
    resourceCount,
    eventMailTemplateCount,
  };
}

/**
 * List remaining delete blockers for an event. Empty means permanently deletable.
 * Deliberately does NOT require `archived_at` - see the file-level comment above.
 * Pure/sync so it is trivially unit-testable and can never diverge between the DTO
 * computation and the actual delete route - both call this against the same signals.
 */
export function listEventDeletionBlockers(
  event: { pinned_note: string | null },
  signals: EventActivitySignals,
): EventDeletionBlocker[] {
  const blockers: EventDeletionBlocker[] = [];
  if (signals.attendeeCount > 0) blockers.push("attendees");
  if (signals.nonBadgeItemCount > 0) blockers.push("custom_items");
  if (signals.nonStandardTicketTypeCount > 0) blockers.push("custom_ticket_types");
  if (signals.contactCount > 0) blockers.push("contacts");
  if (signals.resourceCount > 0) blockers.push("resources");
  if (event.pinned_note !== null) blockers.push("pinned_note");
  if (signals.eventMailTemplateCount > 0) blockers.push("event_mail_template");
  return blockers;
}

/** True when {@link listEventDeletionBlockers} is empty. */
export function isEventDeletable(
  event: { archived_at: Date | null; pinned_note: string | null },
  signals: EventActivitySignals,
): boolean {
  return listEventDeletionBlockers(event, signals).length === 0;
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
type DeleteTxResult =
  | { kind: "not_found" }
  | { kind: "not_deletable" }
  | { kind: "ok"; eventTitle: string; managedUploadUrls: Array<string | null> };

export async function deleteEvent(
  db: PrismaClient,
  eventId: string,
  actor: DeleteActor,
  ip: string | null | undefined,
  sessionId: string | null | undefined,
  timezone?: string | null,
): Promise<DeleteEventResult> {
  try {
    const txResult = await db.$transaction(async (tx): Promise<DeleteTxResult> => {
      // Serializes with the event mail-settings PUT transaction on the same eventId (see
      // that route) - without this, a concurrent PUT can validate the event exists, then
      // this transaction deletes it, then the PUT's upsert recreates an orphaned
      // MailSettings row with no FK to catch it (CodeRabbit review).
      await lockEventForScopedWrite(tx, eventId);

      const event = await tx.event.findUnique({
        where: { id: eventId },
        select: {
          archived_at: true,
          pinned_note: true,
          organization_id: true,
          title: true,
          logo_url: true,
          logo_original_url: true,
          header_image_url: true,
        },
      });
      if (!event) return { kind: "not_found" };

      const signals = await countEventActivitySignals(tx, eventId);
      if (!isEventDeletable(event, signals)) return { kind: "not_deletable" };

      const imageAssets = await tx.eventImageAsset.findMany({
        where: { event_id: eventId },
        select: { url: true },
      });
      const managedUploadUrls = [
        event.logo_url,
        event.logo_original_url,
        event.header_image_url,
        ...imageAssets.map((asset) => asset.url),
      ];

      // MailTemplate has no FK to Event. Custom rows have already been ruled out by the guard;
      // an optional saved `ticket` override is intentionally removed here with the event.
      await tx.mailTemplate.deleteMany({ where: { scope_type: "event", scope_id: eventId } });

      // MailSettings (event-scoped mail transport override, #511) is the same polymorphic
      // scope_type/scope_id pattern with no FK - but unlike MailTemplate it's config, not
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
        timezone,
        actionType: "event_deleted",
        // Snapshot the title here: once the delete above commits, the audit log's usual
        // live-lookup-by-eventId has nothing left to resolve against.
        metadata: { eventId, eventTitle: event.title },
      });
      return { kind: "ok", eventTitle: event.title, managedUploadUrls };
    });

    if (txResult.kind === "not_found") return { code: "not_found" };
    if (txResult.kind === "not_deletable") return { code: "not_deletable" };

    // Single-tenant: managed uploads use org "default" (same as event-image-assets-routes).
    await bestEffortDeleteReplacedUploadUrls(
      txResult.managedUploadUrls,
      [],
      { expectedOrgId: "default", expectedKind: "event", expectedEventId: eventId },
    );

    // Emitted after the transaction has committed (CodeRabbit review) - emitSystemLog is
    // not transactional, so logging it from inside the callback above would record a
    // deletion the transaction could still roll back on a later statement/commit failure.
    emitSystemLog("admin", "info", "event_deleted", {
      eventId,
      eventTitle: txResult.eventTitle,
      actorUserId: actor.userId,
      actorEmail: await resolveActorEmailForLog(db, actor.userId),
      ip,
    });
    return { ok: true };
  } catch (err) {
    // A concurrent change adding real content between the count-check and the delete
    // (e.g. a new attendee) is caught here as a Postgres FK-restrict rejection - that is
    // the guard working as intended, not an audit-log bug, so it maps to the same
    // "not_deletable" the caller already handles rather than a generic 500.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
      return { code: "not_deletable" };
    }
    console.error("[audit] event_deleted transaction failed", err);
    recordSystemLog({
      level: "error",
      source: "admin",
      message: "event_deleted transaction failed",
      fields: { eventId, actorUserId: actor.userId, ip },
    });
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

  const result = await deleteEvent(
    db,
    eventId,
    { userId: audit.operator },
    audit.ip,
    audit.sessionId,
    audit.timezone,
  );

  if ("code" in result) {
    if (result.code === "not_found") return c.json({ error: "not_found" }, 404);
    if (result.code === "not_deletable") return c.json({ error: "event_not_deletable" }, 409);
    if (result.code === "audit_failed") return c.json({ code: "audit_failed" }, 500);
  }

  return c.json({ ok: true });
}
