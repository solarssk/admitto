import type { PrismaClient } from "@prisma/client";
import { generateToken } from "./token.js";
import { hashToken } from "./hash.js";
import { buildTicketUrl } from "./url.js";
import type { IssuedTicketResult, IssueEventSummary } from "./types.js";

/**
 * Issue a ticket for a single attendee.
 *
 * Mode A (no qr_payload, no external_uuid):
 *   - First call: mints a 256-bit token, stores sha256 hash, returns raw token + URL.
 *   - Subsequent calls: idempotent no-op; raw token NOT returned (not stored in DB).
 *
 * Mode B (qr_payload or external_uuid present):
 *   - No-op: returns agency payload verbatim, never mints an internal token.
 *
 * @throws if the attendee is not found.
 */
export async function issueTicket(
  attendeeId: string,
  prisma: PrismaClient,
  baseUrl: string,
): Promise<IssuedTicketResult> {
  const attendee = await prisma.attendee.findUnique({ where: { id: attendeeId } });
  if (!attendee) throw new Error(`Attendee not found: ${attendeeId}`);

  // Mode B — use agency identifier verbatim, never mint an internal token.
  if (attendee.qr_payload !== null || attendee.external_uuid !== null) {
    const qrPayload = attendee.qr_payload ?? attendee.external_uuid!;
    return { status: "agency", mode: "agency", attendeeId, qrPayload };
  }

  // Mode A — already issued; do NOT rotate.
  if (attendee.token_hash !== null) {
    return { status: "already_issued", mode: "internal", attendeeId };
  }

  // Mode A — first issuance.
  const token = generateToken();
  const tokenHash = hashToken(token);
  await prisma.attendee.update({
    where: { id: attendeeId },
    data: { token_hash: tokenHash },
  });
  const ticketUrl = buildTicketUrl(baseUrl, token);
  return { status: "issued", mode: "internal", attendeeId, token, tokenHash, ticketUrl };
}

/**
 * Issue tickets for all attendees of an event.
 *
 * Safe to run multiple times — already-issued attendees are skipped without mutation.
 */
export async function issueTicketsForEvent(
  eventId: string,
  prisma: PrismaClient,
  baseUrl: string,
): Promise<IssueEventSummary> {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) throw new Error(`Event not found: ${eventId}`);

  const attendees = await prisma.attendee.findMany({ where: { event_id: eventId } });

  const results: IssuedTicketResult[] = [];
  let issued = 0;
  let alreadyIssued = 0;
  let agency = 0;

  for (const attendee of attendees) {
    const result = await issueTicket(attendee.id, prisma, baseUrl);
    results.push(result);
    if (result.status === "issued") issued++;
    else if (result.status === "already_issued") alreadyIssued++;
    else agency++;
  }

  return { results, issued, alreadyIssued, agency };
}
