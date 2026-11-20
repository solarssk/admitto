/**
 * The clean-up of guest registrations that were never confirmed: a registration waiting for its address to be
 * confirmed (`awaiting_email`) is deleted once its link has expired (`confirm_expires_at`, 24 hours after the
 * submission), with its queued mail (cascade). It is the only automatic deletion of guest registrations (D-C5, D-F5).
 * Confirming checks the age itself, so correctness does not depend on how often this runs.
 *
 * Lock order (docs/dev/attendee-erasure.md, "Taking locks: one order"): the clean-up locks no row before the
 * registration queue, not even with `FOR UPDATE SKIP LOCKED`. It reads the events that have expired registrations
 * with a plain query. Then, one transaction per event and batch, it takes the queue of that event and deletes the
 * registrations whose expiry it checks again under the lock. No transaction holds the queue of two events.
 */
import type { PrismaClient } from "@admitto/db";
import { lockRegistrationQueue } from "@admitto/tickets";

/** Registrations deleted in one transaction. */
export const REGISTRATION_EXPIRY_BATCH_SIZE = 500;

/**
 * Batches one run deletes, and so the events it looks at (each has at least one): a run is cut short, and says so,
 * rather than hold up a worker tick.
 */
const MAX_BATCHES_PER_RUN = 20;

/** A transaction that only takes a lock may have to wait for an erasure's own, which Prisma's default 5 s would cut off. */
const SWEEP_TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 };

export interface SweepExpiredRegistrationsResult {
  /** Registrations deleted. */
  deleted: number;
  /** The events they belonged to, for the worker to announce over SSE (ADR 0044). */
  eventIds: string[];
  /** The run stopped at its limit: more may be expired. */
  more: boolean;
}

/**
 * The columns are naive UTC (`timestamp` without a zone), and a bare `NOW()` is compared in the session's time
 * zone, which shifts the comparison by its offset in either direction. `NOW() AT TIME ZONE 'utc'` is naive UTC too,
 * whatever the session's zone (see consumeOidcAuthState in packages/auth).
 */
async function eventsWithExpiredRegistrations(prisma: PrismaClient): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ event_id: string }[]>`
    SELECT DISTINCT "event_id" FROM "Registration"
    WHERE "status" = 'awaiting_email' AND "confirm_expires_at" < (NOW() AT TIME ZONE 'utc')
    ORDER BY "event_id"
    LIMIT ${MAX_BATCHES_PER_RUN}
  `;
  return rows.map((row) => row.event_id);
}

/** Deletes up to `batchSize` expired registrations of one event under its queue lock, with the expiry checked again. */
function deleteExpiredBatch(prisma: PrismaClient, eventId: string, batchSize: number): Promise<number> {
  return prisma.$transaction(async (tx) => {
    await lockRegistrationQueue(tx, eventId);
    return tx.$executeRaw`
      DELETE FROM "Registration"
      WHERE "id" IN (
        SELECT "id" FROM "Registration"
        WHERE "event_id" = ${eventId} AND "status" = 'awaiting_email' AND "confirm_expires_at" < (NOW() AT TIME ZONE 'utc')
        ORDER BY "id"
        LIMIT ${batchSize}
      )
    `;
  }, SWEEP_TX_OPTIONS);
}

/** Deletes the registrations whose confirmation link has expired. Run by the worker job `registration_mail` on each tick. */
export async function sweepExpiredRegistrations(
  prisma: PrismaClient,
  options: { batchSize?: number } = {},
): Promise<SweepExpiredRegistrationsResult> {
  const batchSize = options.batchSize ?? REGISTRATION_EXPIRY_BATCH_SIZE;
  const eventIds = await eventsWithExpiredRegistrations(prisma);
  const touched: string[] = [];
  let deleted = 0;
  let batches = 0;

  for (const eventId of eventIds) {
    let removed: number;
    do {
      if (batches >= MAX_BATCHES_PER_RUN) return { deleted, eventIds: touched, more: true };
      batches += 1;
      removed = await deleteExpiredBatch(prisma, eventId, batchSize); // NOSONAR - batches are deleted one at a time on purpose, each under its own lock
      deleted += removed;
      if (removed > 0 && !touched.includes(eventId)) touched.push(eventId);
    } while (removed >= batchSize);
  }
  return { deleted, eventIds: touched, more: eventIds.length >= MAX_BATCHES_PER_RUN };
}
