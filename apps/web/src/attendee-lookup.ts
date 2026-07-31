import type { PrismaClient } from "@admitto/db";
import { toResolved, type ResolvedTicket } from "@admitto/tickets";

/** Event-scoped attendee lookup for Mode B public routes (by public_ref, not Attendee.id). */
export async function findAttendeeForEventRoute(
  eventSlug: string,
  publicRef: string,
  prisma: PrismaClient,
): Promise<ResolvedTicket | null> {
  const event = await prisma.event.findUnique({
    where: { slug: eventSlug },
  });
  if (!event) return null;

  const attendee = await prisma.attendee.findFirst({
    where: { public_ref: publicRef, event_id: event.id },
    include: { event: { include: { organization: true, location_details: true } } },
  });
  if (!attendee) return null;

  const mode =
    attendee.qr_payload !== null || attendee.external_uuid !== null ? "agency" : "internal";

  return toResolved(attendee, mode);
}
