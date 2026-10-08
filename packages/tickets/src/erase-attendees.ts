import { Prisma } from "@admitto/db/client";
import { resolvePreviewEventTimeZone } from "@admitto/mail-templates";

/** Written to `Attendee.name` of an erased attendee. Mirrored by the CHECK constraint in migration
 * 20261008120000_add_attendee_erased_at - change both together. */
export const ERASED_ATTENDEE_NAME = "Erased attendee";

export const ERASED_EMAIL_DOMAIN = "erased.invalid";

/** True for an address in the namespace reserved for erased attendees. No attendee can be given
 * one: it would collide with the placeholder of the attendee it is named after and make that
 * erasure fail on the unique (event, email) index. Enforced by a CHECK on live rows too. */
export function isErasedPlaceholderEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith(`@${ERASED_EMAIL_DOMAIN}`);
}

/** Written to `Attendee.email` of an erased attendee: unique per row (the id is), and never
 * deliverable (RFC 6761 reserves `.invalid`). Mirrored by the same CHECK constraint. */
export function erasedAttendeeEmail(attendeeId: string): string {
  return `erased-${attendeeId}@${ERASED_EMAIL_DOMAIN}`;
}

export type EraseAttendeesParams = {
  eventId: string;
  attendeeIds: readonly string[];
};

/** A wallet pass whose copy at the provider still has to be deleted. The local row keeps its
 * provider ids until that succeeds (`provider_removed_at`), so a failed delete can be retried. */
export type EraseWalletTarget = {
  attendeeId: string;
  providerPassId: string;
};

export type EraseAttendeesResult = {
  /** Attendees this call erased. */
  erasedIds: string[];
  /** Attendees of the event that were erased before - skipped, nothing touched. */
  alreadyErasedIds: string[];
  /** Ids that match no attendee of this event. */
  notFoundIds: string[];
  /** Rows removed or cleaned elsewhere, for the audit entry (counts only, never content). */
  counts: {
    notes: number;
    actionLogs: number;
    emailDeliveries: number;
    checkIns: number;
    walletPasses: number;
  };
  /** Provider passes of the erased attendees that are not deleted at the provider yet. */
  walletTargets: EraseWalletTarget[];
  /**
   * The addresses the erased attendees had, lower-cased, for scrubbing event-level copies of them
   * that are not keyed by attendee (see scrubImportJobResults). They are personal data: used in
   * memory by the caller within the same request, never logged, audited or stored.
   */
  previousEmails: string[];
};

/**
 * Moment cut to the start of its hour in the event's timezone, for a naive-UTC `timestamp(3)`
 * column. Subtracting the minutes and seconds past the hour (a difference of two naive local
 * timestamps) instead of converting the truncated local time back avoids the repeated hour of a
 * daylight-saving change: that conversion would pick one of the two instants.
 */
function truncatedToLocalHour(column: Prisma.Sql, timeZone: string): Prisma.Sql {
  const local = Prisma.sql`((${column} AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone})`;
  return Prisma.sql`${column} - (${local} - DATE_TRUNC('hour', ${local}))`;
}

/**
 * Erase personal data of attendees in place (GDPR "Erase personal data"): the row, its id, ticket
 * type, status history, admission and RSVP state stay, so Reports and capacity keep their numbers,
 * but nothing that identifies the person or opens their ticket is left. Runs inside the caller's
 * transaction so the erasure and its audit entry commit together.
 *
 * What happens, per attendee that is not erased yet:
 * - Attendee: name and email become placeholders (see the CHECK constraint), every other
 *   identifier, credential and custom answer is cleared, `erased_at` is stamped. Admission time is
 *   cut to the hour. A person not admitted yet on a live event is cancelled, so their place is
 *   free again; on an archived event, or once admitted, the status is left alone because the
 *   numbers there are final.
 * - Notes and the per-attendee activity log are deleted.
 * - Check-ins stay (the hourly chart and the device breakdown read them) without notes, time cut
 *   to the hour.
 * - Email deliveries stay as rows for the Mail report, without recipient, subject, body, provider
 *   message id and error text. Mail still waiting to go out is cancelled first, and an emptied row
 *   can never be picked up by the sender again.
 * - The wallet pass keeps its provider ids (to delete it at the provider, retryably) and loses
 *   every link, device and token.
 * - The "created manually" entry in the central audit log loses the name and email it recorded.
 *
 * Not done here: deleting the pass at the provider (network call, the caller does it from
 * `walletTargets` after commit), clearing event-level job results, and making every code path
 * refuse an erased attendee. See docs/dev/attendee-erasure.md.
 */
export async function eraseAttendees(
  tx: Prisma.TransactionClient,
  params: EraseAttendeesParams,
): Promise<EraseAttendeesResult> {
  const { eventId } = params;
  const requestedIds = [...new Set(params.attendeeIds)];
  const empty: EraseAttendeesResult = {
    erasedIds: [],
    alreadyErasedIds: [],
    notFoundIds: requestedIds,
    counts: { notes: 0, actionLogs: 0, emailDeliveries: 0, checkIns: 0, walletPasses: 0 },
    walletTargets: [],
    previousEmails: [],
  };
  if (requestedIds.length === 0) return empty;

  const event = await tx.event.findUnique({
    where: { id: eventId },
    select: { archived_at: true, timezone: true },
  });
  if (!event) return empty;
  const timeZone = resolvePreviewEventTimeZone(event.timezone);
  const eventArchived = event.archived_at !== null;

  // Locks the rows (in id order, so two overlapping erasures cannot deadlock) until commit: a
  // concurrent ticket issue, check-in or edit waits, then sees the erased row.
  const found = await tx.$queryRaw<{ id: string; email: string; erased_at: Date | null }[]>`
    SELECT "id", "email", "erased_at" FROM "Attendee"
    WHERE "event_id" = ${eventId} AND "id" IN (${Prisma.join(requestedIds)})
    ORDER BY "id"
    FOR UPDATE
  `;
  const foundIds = new Set(found.map((row) => row.id));
  const notFoundIds = requestedIds.filter((id) => !foundIds.has(id));
  const alreadyErasedIds = found.filter((row) => row.erased_at !== null).map((row) => row.id);
  const toErase = found.filter((row) => row.erased_at === null).map((row) => row.id);
  if (toErase.length === 0) return { ...empty, alreadyErasedIds, notFoundIds };
  const previousEmails = [
    ...new Set(
      found
        .filter((row) => row.erased_at === null)
        .map((row) => row.email.trim().toLowerCase())
        .filter((email) => email.length > 0),
    ),
  ];

  const ids = Prisma.join(toErase);
  const erased = await tx.$queryRaw<{ id: string }[]>`
    UPDATE "Attendee" SET
      "name" = ${ERASED_ATTENDEE_NAME},
      "email" = 'erased-' || "id" || ${`@${ERASED_EMAIL_DOMAIN}`},
      "first_name" = NULL,
      "last_name" = NULL,
      "company" = NULL,
      "department" = NULL,
      "custom_data" = NULL,
      "token_hash" = NULL,
      "token_enc" = NULL,
      "qr_payload" = NULL,
      "external_uuid" = NULL,
      "public_ref" = NULL,
      "status" = CASE
        WHEN "admitted_at" IS NULL AND ${!eventArchived} AND "status" IN ('registered', 'confirmed')
          THEN 'cancelled'
        ELSE "status"
      END,
      "admitted_at" = ${truncatedToLocalHour(Prisma.sql`"admitted_at"`, timeZone)},
      "email_bounce_dismissed_at" = NOW() AT TIME ZONE 'UTC',
      "erased_at" = NOW() AT TIME ZONE 'UTC',
      "updated_at" = NOW() AT TIME ZONE 'UTC'
    WHERE "event_id" = ${eventId} AND "id" IN (${ids}) AND "erased_at" IS NULL
    RETURNING "id"
  `;
  // The rows are locked and were just read as not erased, so this is exactly `toErase`.
  const erasedIds = erased.map((row) => row.id);
  const erasedList = Prisma.join(erasedIds);

  const [notes, actionLogs] = await Promise.all([
    tx.attendeeNote.deleteMany({ where: { event_id: eventId, attendee_id: { in: erasedIds } } }),
    tx.attendeeActionLog.deleteMany({ where: { event_id: eventId, attendee_id: { in: erasedIds } } }),
  ]);

  const checkIns = await tx.$executeRaw`
    UPDATE "CheckIn" SET
      "notes" = NULL,
      "checked_in_at" = ${truncatedToLocalHour(Prisma.sql`"checked_in_at"`, timeZone)},
      "created_at" = ${truncatedToLocalHour(Prisma.sql`"created_at"`, timeZone)}
    WHERE "event_id" = ${eventId} AND "attendee_id" IN (${erasedList})
  `;

  // Cancel before emptying: the sender re-reads the status right before it sends.
  await tx.emailDelivery.updateMany({
    where: {
      event_id: eventId,
      attendee_id: { in: erasedIds },
      OR: [{ status: "queued" }, { status: "failed", retryable: true }],
    },
    data: { status: "cancelled", retryable: false },
  });
  const emailDeliveries = await tx.emailDelivery.updateMany({
    where: { event_id: eventId, attendee_id: { in: erasedIds } },
    data: {
      recipient_email: null,
      rendered_subject: null,
      rendered_html: null,
      provider_message_id: null,
      error: null,
    },
  });

  const walletPasses = await tx.walletPass.findMany({
    where: { attendee_id: { in: erasedIds } },
    select: { attendee_id: true, provider_pass_id: true, provider_removed_at: true },
  });
  await tx.walletPass.updateMany({
    where: { attendee_id: { in: erasedIds } },
    data: {
      download_url: null,
      apple_url: null,
      android_url: null,
      samsung_url: null,
      user_agent: null,
      user_agent_captured_at: null,
      auth_token: null,
      pass_url: null,
      serial_number: null,
      pass_type_id: null,
    },
  });

  // A mail that staff sent to this person's address on behalf of another attendee (the resend
  // override) sits on that other attendee's delivery: the address goes, the delivery stays, and a
  // mail still waiting to go out is cancelled.
  if (previousEmails.length > 0) {
    await tx.$executeRaw`
      UPDATE "EmailDelivery" SET
        "status" = CASE
          WHEN "status" = 'queued' OR ("status" = 'failed' AND "retryable" IS TRUE) THEN 'cancelled'
          ELSE "status"
        END,
        "retryable" = CASE
          WHEN "status" = 'queued' OR ("status" = 'failed' AND "retryable" IS TRUE) THEN false
          ELSE "retryable"
        END,
        "recipient_email" = NULL,
        "provider_message_id" = NULL,
        "error" = NULL
      WHERE "event_id" = ${eventId}
        AND LOWER(TRIM("recipient_email")) IN (${Prisma.join(previousEmails)})
        AND "attendee_id" NOT IN (${erasedList})
    `;
  }

  // The central audit log keeps the creation entry of a manually added attendee; only the two
  // identifying values go, the entry itself (who added someone, when) stays.
  await tx.$executeRaw`
    UPDATE "AdminAuditLog" SET "metadata" = "metadata" - 'attendee_name' - 'attendee_email'
    WHERE "action_type" = 'attendee_created_manual'
      AND "metadata"->>'event_id' = ${eventId}
      AND "metadata"->>'attendee_id' IN (${erasedList})
  `;

  return {
    erasedIds,
    alreadyErasedIds,
    notFoundIds,
    counts: {
      notes: notes.count,
      actionLogs: actionLogs.count,
      emailDeliveries: emailDeliveries.count,
      checkIns,
      walletPasses: walletPasses.length,
    },
    walletTargets: walletPasses.flatMap((pass) =>
      pass.provider_pass_id && !pass.provider_removed_at
        ? [{ attendeeId: pass.attendee_id, providerPassId: pass.provider_pass_id }]
        : [],
    ),
    previousEmails,
  };
}
