import type { PrismaClient } from "./generated/prisma/client.js";

/**
 * Idempotent backfill: recovers Event.created_by_user_id/created_by_timezone (and the archived_*
 * equivalents) for rows written before those columns existed, from the matching AdminAuditLog
 * entry that already recorded both the actor and their IANA timezone at write time
 * (event-archiving.ts/admin-api-routes.ts have always written eventId into that entry's
 * metadata, and actor_timezone alongside actor_user_id on every row). DISTINCT ON picks the most
 * recent matching entry per event, so an event archived/unarchived/re-archived multiple times
 * still resolves to whoever archived it most recently (matching the live archived_at it's
 * paired with) - user_id and timezone both come from that same winning row, never mixed across
 * two different entries.
 *
 * Runs automatically after `npm run db:migrate`; safe to re-run manually.
 */
export async function backfillEventCreatedByUserId(prisma: PrismaClient): Promise<{ updated: number }> {
  const updated = await prisma.$executeRaw`
    UPDATE "Event" e
    SET created_by_user_id = latest.actor_user_id,
        created_by_timezone = latest.actor_timezone
    FROM (
      SELECT DISTINCT ON (metadata ->> 'eventId') metadata ->> 'eventId' AS event_id, actor_user_id, actor_timezone
      FROM "AdminAuditLog"
      WHERE action_type = 'event_created'
      ORDER BY metadata ->> 'eventId', created_at DESC
    ) latest
    WHERE e.id = latest.event_id
      AND e.created_by_user_id IS NULL
  `;
  return { updated };
}

export async function backfillEventArchivedByUserId(prisma: PrismaClient): Promise<{ updated: number }> {
  const updated = await prisma.$executeRaw`
    UPDATE "Event" e
    SET archived_by_user_id = latest.actor_user_id,
        archived_by_timezone = latest.actor_timezone
    FROM (
      SELECT DISTINCT ON (metadata ->> 'eventId') metadata ->> 'eventId' AS event_id, actor_user_id, actor_timezone
      FROM "AdminAuditLog"
      WHERE action_type = 'event_archived'
      ORDER BY metadata ->> 'eventId', created_at DESC
    ) latest
    WHERE e.id = latest.event_id
      AND e.archived_at IS NOT NULL
      AND e.archived_by_user_id IS NULL
  `;
  return { updated };
}
