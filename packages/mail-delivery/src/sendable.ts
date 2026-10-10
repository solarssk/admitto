import type { Prisma, PrismaClient } from "@admitto/db";
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
 * The attendees who hold an address that a delivery was sent to on behalf of someone else (the
 * resend override), in the delivery's event. Erasing such an attendee cancels and empties that
 * delivery too, so the last check has to wait for them as well as for the delivery's owner: the
 * owner is not being erased, and a plain read of the delivery still shows it as it was before the
 * erasure began.
 *
 * Both reads are plain ones, and that is enough. Their only job is to name the rows to lock, and an
 * erasure that commits after them has cancelled the delivery in the same transaction, which the
 * read that follows the lock sees. The usual case (every delivery goes to its own attendee's
 * address) ends after the first read, which touches only the deliveries and their owners.
 */
async function holdersOfOverrideAddresses(
  tx: Prisma.TransactionClient,
  deliveryIds: readonly string[],
): Promise<string[]> {
  const addresses = await tx.$queryRaw<{ event_id: string; address: string }[]>`
    SELECT DISTINCT d."event_id", LOWER(TRIM(d."recipient_email")) AS "address"
    FROM "EmailDelivery" d
    JOIN "Attendee" owner ON owner."id" = d."attendee_id"
    WHERE d."id" = ANY(${[...new Set(deliveryIds)]}::text[])
      AND TRIM(d."recipient_email") <> ''
      AND LOWER(TRIM(d."recipient_email")) <> LOWER(TRIM(owner."email"))
  `;
  if (addresses.length === 0) return [];
  const holders = await tx.$queryRaw<{ id: string }[]>`
    SELECT holder."id"
    FROM "Attendee" holder
    JOIN unnest(${addresses.map((row) => row.event_id)}::text[], ${addresses.map((row) => row.address)}::text[])
      AS wanted("event_id", "address")
      ON holder."event_id" = wanted."event_id" AND LOWER(TRIM(holder."email")) = wanted."address"
  `;
  return holders.map((row) => row.id);
}

/**
 * Reads deliveries as they are right now, for the last check before they go to the mailer. The
 * attendees are locked first (`FOR KEY SHARE`, in id order, in one statement) in one short
 * transaction, so an erasure that is still open is waited for and its result seen: the row
 * cancelled and emptied. A plain read would still show it as it was before the erasure began, and
 * the mail would leave for someone being erased. The attendees locked are the owners of the
 * deliveries and whoever holds the address of one that was sent to another address than its
 * owner's (`holdersOfOverrideAddresses`). Deliveries of erased or missing attendees, and rows that
 * no longer exist, are not in the result.
 *
 * The locks end with the transaction, a moment before the send: a mail that is already in the
 * mailer's hands when an erasure commits still goes out once and cannot be recalled.
 */
export function readDeliveriesBeforeSend(
  prisma: PrismaClient,
  deliveries: readonly DeliveryToCheck[],
): Promise<Map<string, DeliveryBeforeSend>> {
  return prisma.$transaction(async (tx) => {
    const holders = await holdersOfOverrideAddresses(
      tx,
      deliveries.map((delivery) => delivery.deliveryId),
    );
    const live = await lockLiveAttendees(tx, [...deliveries.map((delivery) => delivery.attendeeId), ...holders]);
    const ids = deliveries.filter((delivery) => live.has(delivery.attendeeId)).map((delivery) => delivery.deliveryId);
    if (ids.length === 0) return new Map<string, DeliveryBeforeSend>();
    const rows = await tx.emailDelivery.findMany({
      where: { id: { in: ids } },
      select: { id: true, status: true, recipient_email: true },
    });
    return new Map(rows.map((row) => [row.id, { status: row.status, recipient_email: row.recipient_email }]));
  }, CHECK_TX_OPTIONS);
}
