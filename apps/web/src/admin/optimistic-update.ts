import type { Prisma } from "@prisma/client";

export type StaleWrite = { kind: "stale_write" };

/** Interpret updateMany count; caller runs the actual Prisma updateMany. */
export function staleWriteFromCount(count: number): StaleWrite | null {
  return count === 0 ? { kind: "stale_write" } : null;
}

/** Run CAS updateMany then load the updated row when count > 0. */
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
