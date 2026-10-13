import type { Prisma } from "@admitto/db";
import { CAPACITY_EXCLUDED_STATUSES } from "@admitto/db";

export class ImportCapacityExceededError extends Error {
  readonly code = "event_full" as const;
  readonly capacity: number;
  readonly current: number;
  readonly incoming: number;
  readonly projected: number;

  constructor(opts: {
    capacity: number;
    current: number;
    incoming: number;
    projected: number;
  }) {
    super(
      `Import would exceed capacity. ${opts.current} existing + ${opts.incoming} new = ${opts.projected} > ${opts.capacity}.`,
    );
    this.name = "ImportCapacityExceededError";
    this.capacity = opts.capacity;
    this.current = opts.current;
    this.incoming = opts.incoming;
    this.projected = opts.projected;
  }
}

export async function assertImportCapacityInTx(
  tx: Prisma.TransactionClient,
  eventId: string,
  incomingCount: number,
  forceCapacity = false,
): Promise<{ capacity: number; current: number } | null> {
  if (incomingCount <= 0) return null;

  const event = await tx.event.findUnique({
    where: { id: eventId },
    select: { capacity: true },
  });
  if (event?.capacity == null) return null;

  const current = await tx.attendee.count({
    where: {
      event_id: eventId,
      status: { notIn: [...CAPACITY_EXCLUDED_STATUSES] },
    },
  });
  const projected = current + incomingCount;
  if (projected <= event.capacity) return null;

  if (forceCapacity) {
    return { capacity: event.capacity, current };
  }

  throw new ImportCapacityExceededError({
    capacity: event.capacity,
    current,
    incoming: incomingCount,
    projected,
  });
}
