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

  if (attendee.status === "cancelled" || attendee.status === "revoked") {
    const reason = attendee.status === "cancelled" ? "cancelled" : "revoked";
    return { status: "not_issuable", mode: "internal", attendeeId, reason };
  }

  // Mode A — already issued; do NOT rotate.
  if (attendee.token_hash !== null) {
    return { status: "already_issued", mode: "internal", attendeeId };
  }

  // Mode A — first issuance. Atomic compare-and-set: only the first concurrent caller wins.
  const token = generateToken();
  const tokenHash = hashToken(token);
  const updated = await prisma.attendee.updateMany({
    where: {
      id: attendeeId,
      token_hash: null,
      qr_payload: null,
      external_uuid: null,
      status: { notIn: ["cancelled", "revoked"] },
    },
    data: { token_hash: tokenHash },
  });
  if (updated.count === 0) {
    const current = await prisma.attendee.findUnique({ where: { id: attendeeId } });
    if (!current) throw new Error(`Attendee not found: ${attendeeId}`);
    if (current.qr_payload !== null || current.external_uuid !== null) {
      const qrPayload = current.qr_payload ?? current.external_uuid!;
      return { status: "agency", mode: "agency", attendeeId, qrPayload };
    }
    if (current.status === "cancelled" || current.status === "revoked") {
      const reason = current.status === "cancelled" ? "cancelled" : "revoked";
      return { status: "not_issuable", mode: "internal", attendeeId, reason };
    }
    if (current.token_hash !== null) {
      return { status: "already_issued", mode: "internal", attendeeId };
    }
    throw new Error(`Ticket issuance failed for attendee ${attendeeId}`);
  }
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

  const results = new Array<IssuedTicketResult>(attendees.length);
  const pendingInternal: Array<{ index: number; attendeeId: string }> = [];

  for (const [index, attendee] of attendees.entries()) {
    if (attendee.qr_payload !== null || attendee.external_uuid !== null) {
      const qrPayload = attendee.qr_payload ?? attendee.external_uuid!;
      results[index] = { status: "agency", mode: "agency", attendeeId: attendee.id, qrPayload };
      continue;
    }

    if (attendee.status === "cancelled" || attendee.status === "revoked") {
      const reason = attendee.status === "cancelled" ? "cancelled" : "revoked";
      results[index] = { status: "not_issuable", mode: "internal", attendeeId: attendee.id, reason };
      continue;
    }

    if (attendee.token_hash !== null) {
      results[index] = { status: "already_issued", mode: "internal", attendeeId: attendee.id };
      continue;
    }

    pendingInternal.push({ index, attendeeId: attendee.id });
  }

  if (pendingInternal.length > 0) {
    await prisma.$transaction(async (tx) => {
      for (const pending of pendingInternal) {
        const token = generateToken();
        const tokenHash = hashToken(token);
        const updated = await tx.attendee.updateMany({
          where: {
            id: pending.attendeeId,
            token_hash: null,
            qr_payload: null,
            external_uuid: null,
            status: { notIn: ["cancelled", "revoked"] },
          },
          data: { token_hash: tokenHash },
        });

        if (updated.count === 1) {
          results[pending.index] = {
            status: "issued",
            mode: "internal",
            attendeeId: pending.attendeeId,
            token,
            tokenHash,
            ticketUrl: buildTicketUrl(baseUrl, token),
          };
          continue;
        }

        const current = await tx.attendee.findUnique({ where: { id: pending.attendeeId } });
        if (!current) throw new Error(`Attendee not found: ${pending.attendeeId}`);

        if (current.qr_payload !== null || current.external_uuid !== null) {
          const qrPayload = current.qr_payload ?? current.external_uuid!;
          results[pending.index] = {
            status: "agency",
            mode: "agency",
            attendeeId: pending.attendeeId,
            qrPayload,
          };
          continue;
        }

        if (current.status === "cancelled" || current.status === "revoked") {
          const reason = current.status === "cancelled" ? "cancelled" : "revoked";
          results[pending.index] = {
            status: "not_issuable",
            mode: "internal",
            attendeeId: pending.attendeeId,
            reason,
          };
          continue;
        }

        if (current.token_hash !== null) {
          results[pending.index] = {
            status: "already_issued",
            mode: "internal",
            attendeeId: pending.attendeeId,
          };
          continue;
        }

        throw new Error(`Ticket issuance failed for attendee ${pending.attendeeId}`);
      }
    });
  }

  let issued = 0;
  let alreadyIssued = 0;
  let agency = 0;
  let notIssuable = 0;

  for (const result of results) {
    if (result.status === "issued") issued++;
    else if (result.status === "already_issued") alreadyIssued++;
    else if (result.status === "agency") agency++;
    else notIssuable++;
  }

  return { results, issued, alreadyIssued, agency, notIssuable };
}
