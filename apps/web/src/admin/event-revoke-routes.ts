/**
 * Danger Zone bulk revoke actions (Event Settings follow-up to #395/#396).
 * Superadmin-only, event-wide "undo" actions — distinct from the existing
 * per-attendee revoke-checkin / revoke-item routes (attendees-api-routes.ts),
 * which any org-admin with manage access to the event can already use one
 * attendee at a time. These two act on every affected attendee at once, so
 * they follow the same superadmin-only precedent as the other Danger Zone
 * actions (Archive, Export personal data, Delete event) and the existing
 * "Revoke all operator sessions" bulk action (sessions-routes.ts), whose
 * shape this file mirrors exactly. Unlike operator-session revocation,
 * these two are blocked on archived events (user decision: an archived
 * event is already over, so there is nothing to correct).
 */
import type { Context } from "hono";
import type { PrismaClient } from "@admitto/db";
import { revokeAllCheckInsForEvent, revokeAllItemsForEvent, writeAdminAuditLog } from "@admitto/tickets";
import { emitSystemLog } from "@admitto/shared/system-log";
import {
  adminAuditFromContext,
  assertEventManageAccess,
  requireEventId,
  requireSuperadmin,
  resolveActorEmailForLog,
} from "./admin-helpers.js";
import { assertEventNotArchived } from "./event-archiving.js";
import { resolveInstanceOrganizationId } from "./instance-org.js";

async function emitEventBulkRevokeLog(
  db: PrismaClient,
  eventId: string,
  revokedCount: number,
  actorUserId: string,
  message: "event_checkins_bulk_revoked" | "event_items_bulk_revoked",
): Promise<void> {
  emitSystemLog("admin", "info", message, {
    eventId,
    revokedCount,
    actorUserId,
    actorEmail: await resolveActorEmailForLog(db, actorUserId),
  });
}

/** POST /api/admin/events/:eventId/revoke-all-checkins — bulk-revoke every currently-admitted attendee's check-in. Superadmin only, blocked on archived events. */
export async function handleRevokeAllCheckIns(c: Context, db: PrismaClient): Promise<Response> {
  const superadminDenied = await requireSuperadmin(c, db);
  if (superadminDenied) return superadminDenied;

  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const eventDenied = await assertEventManageAccess(c, db, eventId);
  if (eventDenied) return eventDenied;

  const archivedBlocked = await assertEventNotArchived(c, db, eventId);
  if (archivedBlocked) return archivedBlocked;

  const audit = adminAuditFromContext(c);
  const revokedCount = await revokeAllCheckInsForEvent(db, { eventId, audit });

  const orgId = await resolveInstanceOrganizationId(db);
  const actorUserId = c.get("auth").userId;
  await writeAdminAuditLog(db, {
    organizationId: orgId,
    actorUserId,
    sessionId: audit.sessionId,
    ip: audit.ip,
    timezone: audit.timezone,
    actionType: "event_checkins_bulk_revoked",
    metadata: { eventId, revokedCount },
  });
  await emitEventBulkRevokeLog(db, eventId, revokedCount, actorUserId, "event_checkins_bulk_revoked");

  return c.json({ revokedCount });
}

/** POST /api/admin/events/:eventId/revoke-all-items — bulk-reset every issued/returned item hand-out back to pending. Superadmin only, blocked on archived events. */
export async function handleRevokeAllItems(c: Context, db: PrismaClient): Promise<Response> {
  const superadminDenied = await requireSuperadmin(c, db);
  if (superadminDenied) return superadminDenied;

  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const eventDenied = await assertEventManageAccess(c, db, eventId);
  if (eventDenied) return eventDenied;

  const archivedBlocked = await assertEventNotArchived(c, db, eventId);
  if (archivedBlocked) return archivedBlocked;

  const audit = adminAuditFromContext(c);
  const revokedCount = await revokeAllItemsForEvent(db, { eventId, audit });

  const orgId = await resolveInstanceOrganizationId(db);
  const actorUserId = c.get("auth").userId;
  await writeAdminAuditLog(db, {
    organizationId: orgId,
    actorUserId,
    sessionId: audit.sessionId,
    ip: audit.ip,
    timezone: audit.timezone,
    actionType: "event_items_bulk_revoked",
    metadata: { eventId, revokedCount },
  });
  await emitEventBulkRevokeLog(db, eventId, revokedCount, actorUserId, "event_items_bulk_revoked");

  return c.json({ revokedCount });
}
