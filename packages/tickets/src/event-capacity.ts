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
 */
export async function runEventCapacityTransaction<Prepared, Result>(
  db: PrismaClient,
  eventId: string,
  prepare: (tx: Prisma.TransactionClient) => Promise<Prepared>,
  work: (tx: Prisma.TransactionClient, prepared: Prepared) => Promise<Result>,
  policy: EventCapacityTransactionPolicy = DEFAULT_CAPACITY_POLICY,
): Promise<Result> {
  const deadline = performance.now() + policy.waitTimeout;
  const attempt = async (): Promise<Result> => {
    let workStarted = false;
    try {
      return await db.$transaction(async (tx) => {
        const started = performance.now();
        const prepared = await prepare(tx);
        await acquireEventCapacityLock(tx, eventId);
        if (performance.now() - started > policy.lockAllowance) throw new RetryCapacityAcquisition();
        workStarted = true;
        return work(tx, prepared);
      }, { timeout: policy.workTimeout + policy.lockAllowance + policy.grace, maxWait: policy.maxWait });
    } catch (error) {
      // The adapter's statement_timeout can cancel an advisory or job/catalog wait before
      // Prisma's transaction timeout. Only replay cancelled SQL while preparation is read-only.
      if (workStarted || !(error instanceof RetryCapacityAcquisition || isCapacityAcquisitionTimeout(error))) throw error;
      if (performance.now() >= deadline) throw new Error("Event capacity lock acquisition timed out.");
      return attempt();
    }
  };
  return attempt();
}
