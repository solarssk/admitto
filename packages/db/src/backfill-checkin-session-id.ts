import type { PrismaClient } from "@prisma/client";

/**
 * Idempotent backfill: recovers CheckIn.session_id for rows written before that column existed,
 * from the AttendeeActionLog "check_in" entry that was already recording it (admit.ts has always
 * passed the full audit context, including sessionId, into writeActionLog) plus its
 * metadata.check_in_id linking back to the specific CheckIn row. Without this, a device-label
 * correction only resolves check-ins created after this deploy - every earlier one stays on its
 * frozen device_id snapshot regardless of a later fix (CodeRabbit review).
 *
 * "check_in" is the only action_type admit.ts writes a CheckIn row alongside; undo.ts's own
 * UNDO-status rows have no matching action-log entry to recover from, so they correctly keep
 * relying on the device_id snapshot alone, same as the emergency-bearer path (no session at all).
 *
 * Runs automatically after `npm run db:migrate`; safe to re-run manually.
 */
export async function backfillCheckInSessionIds(prisma: PrismaClient): Promise<{ updated: number }> {
  const updated = await prisma.$executeRaw`
    UPDATE "CheckIn" ci
    SET session_id = log.session_id
    FROM "AttendeeActionLog" log
    WHERE log.action_type = 'check_in'
      AND log.session_id IS NOT NULL
      AND log.metadata ->> 'check_in_id' = ci.id
      AND ci.session_id IS NULL
  `;
  return { updated };
}
