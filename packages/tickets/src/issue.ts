import type { Prisma, PrismaClient } from "@prisma/client";
import { encryptToString } from "@admitto/crypto";
import { generateToken } from "./token.js";
import { hashToken } from "./hash.js";
import { buildTicketUrl } from "./url.js";
import type { IssuedTicketResult, IssueEventSummary } from "./types.js";

/** Minimal shape shared by the classification helpers below — matches the Prisma Attendee fields they read. */
type IssuableAttendeeFields = {
  status: string;
  qr_payload: string | null;
  external_uuid: string | null;
  token_hash: string | null;
};

function isNotIssuableStatus(status: string): boolean {
  return status === "cancelled" || status === "revoked";
}

function notIssuableReason(status: string): "cancelled" | "revoked" {
  return status === "cancelled" ? "cancelled" : "revoked";
}

function hasAgencyIdentifier(attendee: IssuableAttendeeFields): boolean {
  return attendee.qr_payload !== null || attendee.external_uuid !== null;
}

function agencyQrPayload(attendee: IssuableAttendeeFields): string {
  return attendee.qr_payload ?? attendee.external_uuid!;
}

/**
 * Classify an attendee before minting a token: not-issuable status, agency (Mode B), or
 * already-issued (Mode A) — in that precedence order. Returns null when none apply, meaning a
 * fresh internal token should be minted.
 *
 * Order matches the pre-mint checks in issueTicket / issueTicketsForEvent's upfront pass.
 */
function classifyAttendeeUpfront(
  attendee: IssuableAttendeeFields,
  attendeeId: string,
): IssuedTicketResult | null {
  if (isNotIssuableStatus(attendee.status)) {
    return { status: "not_issuable", mode: "internal", attendeeId, reason: notIssuableReason(attendee.status) };
  }
  if (hasAgencyIdentifier(attendee)) {
    return { status: "agency", mode: "agency", attendeeId, qrPayload: agencyQrPayload(attendee) };
  }
  if (attendee.token_hash !== null) {
    return { status: "already_issued", mode: "internal", attendeeId };
  }
  return null;
}

/**
 * Classify an attendee after a failed compare-and-set mint: agency (Mode B), not-issuable status,
 * or already-issued (Mode A) — in that precedence order. Returns null when none apply, meaning the
 * CAS failure is unexplained and the caller should throw.
 *
 * Order matches the post-CAS-failure checks in issueTicket / issueTicketsForEvent's transaction retry.
 */
function classifyAttendeeAfterCasFailure(
  attendee: IssuableAttendeeFields,
  attendeeId: string,
): IssuedTicketResult | null {
  if (hasAgencyIdentifier(attendee)) {
    return { status: "agency", mode: "agency", attendeeId, qrPayload: agencyQrPayload(attendee) };
  }
  if (isNotIssuableStatus(attendee.status)) {
    return { status: "not_issuable", mode: "internal", attendeeId, reason: notIssuableReason(attendee.status) };
  }
  if (attendee.token_hash !== null) {
    return { status: "already_issued", mode: "internal", attendeeId };
  }
  return null;
}

/**
 * Issue a ticket for a single attendee.
 *
 * Mode A (no qr_payload, no external_uuid):
 *   - First call: mints a 256-bit token, stores sha256 hash, returns raw token + URL.
 *   - Subsequent calls: idempotent no-op; raw token not re-returned (use token_enc for resend).
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

  const upfront = classifyAttendeeUpfront(attendee, attendeeId);
  if (upfront) return upfront;

  // Mode A — first issuance. Atomic compare-and-set: only the first concurrent caller wins.
  // token_enc is written in the same update as token_hash — both succeed or neither does.
  const token = generateToken();
  const tokenHash = hashToken(token);
  const tokenEnc = encryptToString(token);
  const updated = await prisma.attendee.updateMany({
    where: {
      id: attendeeId,
      token_hash: null,
      qr_payload: null,
      external_uuid: null,
      status: { notIn: ["cancelled", "revoked"] },
    },
    data: { token_hash: tokenHash, token_enc: tokenEnc },
  });
  if (updated.count === 0) {
    const current = await prisma.attendee.findUnique({ where: { id: attendeeId } });
    if (!current) throw new Error(`Attendee not found: ${attendeeId}`);
    const retryResult = classifyAttendeeAfterCasFailure(current, attendeeId);
    if (retryResult) return retryResult;
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
    const classified = classifyAttendeeUpfront(attendee, attendee.id);
    if (classified) {
      results[index] = classified;
      continue;
    }
    pendingInternal.push({ index, attendeeId: attendee.id });
  }

  if (pendingInternal.length > 0) {
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      for (const pending of pendingInternal) {
        results[pending.index] = await issuePendingTicketInTransaction(tx, pending, baseUrl);
      }
    });
  }

  return { results, ...summarizeIssuedResults(results) };
}

/**
 * Mint a token for one pending attendee inside the batch transaction (or resolve why it can't be
 * minted, if a concurrent write won the compare-and-set first). Extracted from
 * issueTicketsForEvent's transaction loop to keep that loop's cognitive complexity in check.
 */
async function issuePendingTicketInTransaction(
  tx: Prisma.TransactionClient,
  pending: { index: number; attendeeId: string },
  baseUrl: string,
): Promise<IssuedTicketResult> {
  const token = generateToken();
  const tokenHash = hashToken(token);
  const tokenEnc = encryptToString(token);
  const updated = await tx.attendee.updateMany({
    where: {
      id: pending.attendeeId,
      token_hash: null,
      qr_payload: null,
      external_uuid: null,
      status: { notIn: ["cancelled", "revoked"] },
    },
    data: { token_hash: tokenHash, token_enc: tokenEnc },
  });

  if (updated.count === 1) {
    return {
      status: "issued",
      mode: "internal",
      attendeeId: pending.attendeeId,
      token,
      tokenHash,
      ticketUrl: buildTicketUrl(baseUrl, token),
    };
  }

  const current = await tx.attendee.findUnique({ where: { id: pending.attendeeId } });
  if (!current) throw new Error(`Attendee not found: ${pending.attendeeId}`);

  const retryResult = classifyAttendeeAfterCasFailure(current, pending.attendeeId);
  if (retryResult) return retryResult;

  throw new Error(`Ticket issuance failed for attendee ${pending.attendeeId}`);
}

function summarizeIssuedResults(
  results: IssuedTicketResult[],
): { issued: number; alreadyIssued: number; agency: number; notIssuable: number } {
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

  return { issued, alreadyIssued, agency, notIssuable };
}
