import type { PrismaClient } from "@prisma/client";
import type { ResolvedTicket } from "@admitto/tickets";

/** Event-scoped attendee lookup for Mode B public routes. */
export async function findAttendeeForEventRoute(
  eventSlug: string,
  attendeeId: string,
  prisma: PrismaClient,
): Promise<ResolvedTicket | null> {
  const event = await prisma.event.findUnique({
    where: { slug: eventSlug },
  });
  if (!event) return null;

  const attendee = await prisma.attendee.findFirst({
    where: { id: attendeeId, event_id: event.id },
    include: { event: true },
  });
  if (!attendee) return null;

  const mode =
    attendee.qr_payload !== null || attendee.external_uuid !== null ? "agency" : "internal";

  return {
    mode,
    attendee: {
      id: attendee.id,
      event_id: attendee.event_id,
      email: attendee.email,
      name: attendee.name,
      status: attendee.status,
      token_hash: attendee.token_hash,
      qr_payload: attendee.qr_payload,
      external_uuid: attendee.external_uuid,
      ticket_type: attendee.ticket_type,
    },
    event: {
      id: attendee.event.id,
      title: attendee.event.title,
      date: attendee.event.date,
      location: attendee.event.location,
    },
  };
}
