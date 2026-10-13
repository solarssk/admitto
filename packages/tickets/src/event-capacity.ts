import { Prisma } from "@admitto/db";

/** Lock waits and writes share the existing import budget across capacity consumers. */
export const EVENT_CAPACITY_TRANSACTION_OPTIONS = { timeout: 120_000, maxWait: 30_000 } as const;

/** Stable PostgreSQL advisory-lock key for per-event capacity serialization. */
export function eventCapacityLockKey(eventId: string): string {
  return `event-capacity:${eventId}`;
}

/** Serialize manual create, restore, and import commit against the same event capacity. */
export async function acquireEventCapacityLock(
  tx: Prisma.TransactionClient,
  eventId: string,
): Promise<void> {
  await tx.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${eventCapacityLockKey(eventId)}))`,
  );
}
