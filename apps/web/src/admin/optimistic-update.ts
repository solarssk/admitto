import type { Prisma } from "@prisma/client";

/** Optimistic-lock conflict — caller should respond with HTTP 409 `stale_write`. */
export type StaleWrite = { kind: "stale_write" };

/**
 * Interpret `updateMany` row count for single-row CAS updates.
 * @returns `stale_write` when count is 0, `null` when exactly one row updated.
 * @throws when count > 1 (non-unique predicate — must never silently corrupt data).
 */
export function staleWriteFromCount(count: number): StaleWrite | null {
  if (count === 0) return { kind: "stale_write" };
  if (count === 1) return null;
  throw new Error(`Optimistic update affected ${count} rows; expected exactly one`);
}

/**
 * Run CAS `updateMany` then load the updated row when exactly one row matched.
 * @param args.updateMany - Prisma `updateMany` returning `{ count }`.
 * @param args.loadUpdated - Fetch the row after a successful CAS (updateMany returns no row payload).
 */
export async function runOptimisticUpdate<T>(args: {
  updateMany: () => Promise<{ count: number }>;
  loadUpdated: () => Promise<T | null>;
}): Promise<{ ok: true; row: T } | StaleWrite> {
  const { count } = await args.updateMany();
  const stale = staleWriteFromCount(count);
  if (stale) return stale;

  const row = await args.loadUpdated();
  if (!row) {
    throw new Error("Optimistic update succeeded but row could not be loaded");
  }
  return { ok: true, row };
}

/**
 * Conditional attendee update guarded by `updated_at` (ADR 0028).
 * Reused pattern for future admin models (EventItem, MailTemplate).
 */
export async function optimisticAttendeeUpdate<S extends Prisma.AttendeeSelect>(
  tx: Prisma.TransactionClient,
  args: {
    id: string;
    expectedUpdatedAt: Date;
    data: Prisma.AttendeeUpdateInput;
    select: S;
  },
): Promise<
  | { ok: true; row: Prisma.AttendeeGetPayload<{ select: S }> }
  | StaleWrite
> {
  return runOptimisticUpdate({
    updateMany: () =>
      tx.attendee.updateMany({
        where: { id: args.id, updated_at: args.expectedUpdatedAt },
        data: args.data,
      }),
    loadUpdated: () =>
      tx.attendee.findUnique({
        where: { id: args.id },
        select: args.select,
      }),
  });
}
