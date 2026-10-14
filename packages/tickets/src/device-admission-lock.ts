import { Prisma } from "@admitto/db";

/** Acquire before attendee locks: admission and undo share one latest-check-in decision. */
export async function lockDeviceAdmissions(
  tx: Prisma.TransactionClient,
  eventId: string,
  deviceId: string | undefined,
): Promise<void> {
  if (!deviceId) return;
  const key = `checkin-device:${JSON.stringify([eventId, deviceId])}`;
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}
