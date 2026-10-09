import type { PrismaClient } from "@admitto/db";
import { lockLiveAttendees } from "@admitto/tickets";

/** The last check can wait for an erasure's own transaction, which Prisma's default 5 s would cut off. */
const CHECK_TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 };

export interface DeliveryToCheck {
  deliveryId: string;
  attendeeId: string;
}

export interface DeliveryBeforeSend {
  status: string;
  recipient_email: string | null;
}

/**
 * Reads deliveries as they are right now, for the last check before they go to the mailer. The
 * attendees are locked first (`FOR KEY SHARE`, in id order) in one short transaction, so an
 * erasure that is still open is waited for and its result seen: the row cancelled and emptied.
 * A plain read would still show it as it was before the erasure began, and the mail would leave
 * for someone being erased. Deliveries of erased or missing attendees, and rows that no longer
 * exist, are not in the result.
 *
 * The locks end with the transaction, a moment before the send: a mail that is already in the
 * mailer's hands when an erasure commits still goes out once and cannot be recalled.
 */
export function readDeliveriesBeforeSend(
  prisma: PrismaClient,
  deliveries: readonly DeliveryToCheck[],
): Promise<Map<string, DeliveryBeforeSend>> {
  return prisma.$transaction(async (tx) => {
    const live = await lockLiveAttendees(
      tx,
      deliveries.map((delivery) => delivery.attendeeId),
    );
    const ids = deliveries.filter((delivery) => live.has(delivery.attendeeId)).map((delivery) => delivery.deliveryId);
    if (ids.length === 0) return new Map<string, DeliveryBeforeSend>();
    const rows = await tx.emailDelivery.findMany({
      where: { id: { in: ids } },
      select: { id: true, status: true, recipient_email: true },
    });
    return new Map(rows.map((row) => [row.id, { status: row.status, recipient_email: row.recipient_email }]));
  }, CHECK_TX_OPTIONS);
}
