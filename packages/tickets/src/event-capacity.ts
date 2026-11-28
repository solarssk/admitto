import { Prisma, type PrismaClient } from "@admitto/db";

/** Work budget; lock acquisition must leave this much time available for the work. */
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

/**
 * Takes the capacity lock only when nobody holds it, without waiting (`pg_try_advisory_xact_lock` on the key of
 * acquireEventCapacityLock, so it excludes the same writers), and says whether it did. A request that must not
 * hold a pooled connection while it waits (a guest's submission) uses this through runEventCapacityTransaction's
 * `tryLock` option, never the waiting lock.
 */
export async function tryAcquireEventCapacityLock(
  tx: Prisma.TransactionClient,
  eventId: string,
): Promise<boolean> {
  const [row] = await tx.$queryRaw<{ locked: boolean }[]>(
    Prisma.sql`SELECT pg_try_advisory_xact_lock(hashtext(${eventCapacityLockKey(eventId)})) AS "locked"`,
  );
  return row?.locked === true;
}

/**
 * Thrown inside a try-locked transaction (runEventCapacityTransaction with `tryLock`, or a try on the registration
 * queue) when a lock it needs is held. Nothing was written: the transaction ends, its connection goes back to the
 * pool, and the caller tries again later (runPublicWrite) or answers that it is busy.
 */
export class EventLockBusyError extends Error {
  constructor() {
    super("A lock this request needs is held.");
    this.name = "EventLockBusyError";
  }
}

/** Options of runEventCapacityTransaction beyond its timing policy. */
export type EventCapacityTransactionOptions = {
  /**
   * Take the capacity lock without waiting. When it is held the transaction ends at once with nothing written and
   * EventLockBusyError is thrown; no part of it is replayed. Without it, a transaction waits for the lock (up to
   * the policy's budget), and an import holds it for as long as it runs.
   */
  tryLock?: boolean;
};

/** Internal timing policy; tests scale durations without replacing real database queries. */
export type EventCapacityTransactionPolicy = {
  workTimeout: number;
  lockAllowance: number;
  grace: number;
  waitTimeout: number;
  maxWait: number;
};
const DEFAULT_CAPACITY_POLICY: EventCapacityTransactionPolicy = {
  workTimeout: EVENT_CAPACITY_TRANSACTION_OPTIONS.timeout,
  lockAllowance: 30_000,
  grace: 1_000,
  waitTimeout: 302_000,
  maxWait: EVENT_CAPACITY_TRANSACTION_OPTIONS.maxWait,
};
class RetryCapacityAcquisition extends Error {}

function isCapacityAcquisitionTimeout(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === "P2028") return true;
  // Prisma 7's pg adapter keeps the PostgreSQL SQLSTATE in its driver error cause.
  const adapterError = error.meta?.driverAdapterError as { cause?: { code?: unknown } } | undefined;
  return error.code === "P2010" && adapterError?.cause?.code === "57014";
}

/**
 * Prepare may only acquire locks and read: it can be replayed after rollback. Preserve the
 * job-row -> catalog -> capacity order. Work is never replayed, even on transaction expiry.
 * A slow acquisition is rolled back before work so a fresh attempt reserves the work budget.
 *
 * With `options.tryLock` the capacity lock is not waited for: when it is held, EventLockBusyError is thrown and
 * nothing is replayed (the caller decides when to try again). The registration queue, the lock that follows this
 * one in the order (docs/dev/attendee-erasure.md), is taken at the start of `work`, never in `prepare`.
 */
export async function runEventCapacityTransaction<Prepared, Result>(
  db: PrismaClient,
  eventId: string,
  prepare: (tx: Prisma.TransactionClient) => Promise<Prepared>,
  work: (tx: Prisma.TransactionClient, prepared: Prepared) => Promise<Result>,
  policy: EventCapacityTransactionPolicy = DEFAULT_CAPACITY_POLICY,
  options: EventCapacityTransactionOptions = {},
): Promise<Result> {
  const deadline = performance.now() + policy.waitTimeout;
  const attempt = async (): Promise<Result> => {
    let workStarted = false;
    try {
      return await db.$transaction(async (tx) => {
        const started = performance.now();
        const prepared = await prepare(tx);
        if (options.tryLock) {
          if (!(await tryAcquireEventCapacityLock(tx, eventId))) throw new EventLockBusyError();
        } else {
          await acquireEventCapacityLock(tx, eventId);
          if (performance.now() - started > policy.lockAllowance) throw new RetryCapacityAcquisition();
        }
        workStarted = true;
        return work(tx, prepared);
      }, { timeout: policy.workTimeout + policy.lockAllowance + policy.grace, maxWait: policy.maxWait });
    } catch (error) {
      // The adapter's statement_timeout can cancel an advisory or job/catalog wait before
      // Prisma's transaction timeout. Only replay cancelled SQL while preparation is read-only.
      if (options.tryLock || workStarted || !(error instanceof RetryCapacityAcquisition || isCapacityAcquisitionTimeout(error))) throw error;
      if (performance.now() >= deadline) throw new Error("Event capacity lock acquisition timed out.");
      return attempt();
    }
  };
  return attempt();
}
