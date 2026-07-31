import type { PrismaClient } from "@admitto/db";
import { EMAIL_DELIVERY_SUCCESS_STATUSES } from "@admitto/db";

/** Record ticket viewed on the latest successful delivery for this attendee/event. */
export async function recordTicketViewed(
  attendeeId: string,
  eventId: string,
  prisma: PrismaClient,
): Promise<void> {
  const delivery = await prisma.emailDelivery.findFirst({
    where: {
      attendee_id: attendeeId,
      event_id: eventId,
      status: { in: [...EMAIL_DELIVERY_SUCCESS_STATUSES] },
      viewed_at: null,
    },
    orderBy: { created_at: "desc" },
  });
  if (!delivery) return;

  await prisma.emailDelivery.update({
    where: { id: delivery.id },
    data: { viewed_at: new Date() },
  });
}
