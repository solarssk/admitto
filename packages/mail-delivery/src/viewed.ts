import type { PrismaClient } from "@admitto/db";
import { EMAIL_DELIVERY_SUCCESS_STATUSES } from "@admitto/db";
import { lockAttendeeRow } from "@admitto/tickets";

/** Record ticket viewed on the latest successful delivery for this attendee/event. */
export async function recordTicketViewed(
  attendeeId: string,
  eventId: string,
  prisma: PrismaClient,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // Nothing to record on the mail of an erased attendee. The row lock makes an erasure that is
    // still open finish first, so the update below cannot land on a delivery it has emptied.
    const attendee = await lockAttendeeRow(tx, attendeeId, eventId);
    if (!attendee || attendee.erased) return;

    const delivery = await tx.emailDelivery.findFirst({
      where: {
        attendee_id: attendeeId,
        event_id: eventId,
        status: { in: [...EMAIL_DELIVERY_SUCCESS_STATUSES] },
        viewed_at: null,
      },
      orderBy: { created_at: "desc" },
    });
    if (!delivery) return;

    await tx.emailDelivery.update({
      where: { id: delivery.id },
      data: { viewed_at: new Date() },
    });
  });
}
