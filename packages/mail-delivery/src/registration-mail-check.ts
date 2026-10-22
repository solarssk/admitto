import { EMAIL_DELIVERY_SUCCESS_STATUSES, type Prisma, type PrismaClient } from "@admitto/db";
import { lockRegistrationQueue } from "@admitto/tickets";
import { MAIL_CANCELLATION, type RegistrationMailReason } from "./registration-mail-reasons.js";
import {
  cancelledResult,
  ticketAlreadyOutResult,
  writeMailResult,
  type QueuedRegistrationMail,
} from "./registration-mail-result.js";

/** The last check can wait for an erasure's own transaction, which Prisma's default 5 s would cut off. */
const CHECK_TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 };

/** The registration status each mail is for (D-D2): a mail goes out only while its registration is in that state. */
const STATUS_FOR_TEMPLATE: ReadonlyMap<string, string> = new Map([
  ["registration-confirm", "awaiting_email"],
  ["registration-received", "pending"],
  ["registration-waitlist", "waitlist"],
  ["registration-rejected", "rejected"],
  ["ticket", "accepted"],
]);

/** What a mail is built from, read from the registration row at the moment of the check. */
export interface RegistrationForMail {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  name: string;
  email_verified_at: Date | null;
  decided_by: string | null;
}

export type RegistrationMailCheck =
  /** The mail row is gone: its registration was erased or deleted. Nothing to do. */
  | { kind: "gone" }
  /** The row changed after the drain read it (a retry reset it, or it was already written). Nothing to do. */
  | { kind: "moved" }
  /** The registration no longer fits the mail: the row is now `cancelled`. */
  | { kind: "cancelled" }
  /** A ticket row whose ticket mail is already out: the row is marked done and nothing is sent. */
  | { kind: "ticket_already_out" }
  | { kind: "send"; registration: RegistrationForMail; attendeeId: string | null };

const FRESH_SELECT = {
  status: true,
  attempts: true,
  queued_at: true,
  registration: {
    select: {
      id: true,
      email: true,
      first_name: true,
      last_name: true,
      name: true,
      status: true,
      confirm_expires_at: true,
      email_verified_at: true,
      decided_by: true,
      attendee_id: true,
      attendee: { select: { erased_at: true } },
    },
  },
} as const satisfies Prisma.RegistrationMailSelect;

type FreshRegistration = Prisma.RegistrationMailGetPayload<{ select: typeof FRESH_SELECT }>["registration"];

/** Why a mail must not go out for this registration now, or null when it can. */
function whyNotSendable(template: string, registration: FreshRegistration, nowMs: number): RegistrationMailReason | null {
  if (registration.status !== STATUS_FOR_TEMPLATE.get(template)) return MAIL_CANCELLATION.registrationChanged;
  // confirm_expires_at is set exactly while the status is awaiting_email (CHECK Registration_awaiting_email_iff_expiry).
  if (template === "registration-confirm" && registration.confirm_expires_at!.getTime() <= nowMs) {
    return MAIL_CANCELLATION.confirmationExpired;
  }
  // An erasure deletes the registration under the same lock, so an erased attendee is not seen here in practice.
  if (template === "ticket" && registration.attendee?.erased_at !== null) return MAIL_CANCELLATION.ticketNotIssuable;
  return null;
}

/**
 * Whether the attendee's first ticket mail already went out. A ticket row only triggers the usual ticket send,
 * and an `initial` send to an attendee whose first mail is in a success status becomes a resend
 * (sendTicketEmails, claim.ts), so a ticket that staff sent by hand before the tick would go out a second time.
 */
async function ticketMailAlreadyOut(tx: Prisma.TransactionClient, eventId: string, attendeeId: string): Promise<boolean> {
  const delivered = await tx.emailDelivery.findFirst({
    where: { event_id: eventId, attendee_id: attendeeId, purpose: "initial", status: { in: [...EMAIL_DELIVERY_SUCCESS_STATUSES] } },
    select: { id: true },
  });
  return delivered !== null;
}

/**
 * The last check before a registration mail is sent: one short transaction of its own, never held across the send.
 *
 * It takes the registration queue of the event first (step 5 of the order in registration-lock.ts), so an erasure,
 * a removal, an admission or a deletion that is still open is waited for and its result seen: a plain read would
 * show the registration as it was before that transaction began. Then it reads the mail row and its registration as
 * they are now. The address and the names come from this read, never from the queue row, which holds none.
 *
 * When the registration no longer fits the mail, or a ticket mail is already out, the row is written here, under the
 * lock, because this transaction changes a `RegistrationMail` row. The result of an actual send is not written here:
 * that is one conditional update after the send (writeMailResult), which takes no lock.
 *
 * The lock ends with this transaction, a moment before the send. A mail that is already with the mailer when an
 * erasure commits still goes out once and cannot be recalled (docs/dev/attendee-erasure.md).
 */
export function checkRegistrationMailBeforeSend(
  prisma: PrismaClient,
  row: QueuedRegistrationMail,
  nowMs: number = Date.now(),
): Promise<RegistrationMailCheck> {
  return prisma.$transaction(async (tx): Promise<RegistrationMailCheck> => {
    await lockRegistrationQueue(tx, row.event_id);
    const fresh = await tx.registrationMail.findUnique({ where: { id: row.id }, select: FRESH_SELECT });
    if (!fresh) return { kind: "gone" };
    if (fresh.status !== row.status || fresh.attempts !== row.attempts || fresh.queued_at.getTime() !== row.queued_at.getTime()) {
      return { kind: "moved" };
    }

    const { registration } = fresh;
    const why = whyNotSendable(row.template_name, registration, nowMs);
    if (why) {
      await writeMailResult(tx, row, cancelledResult(why));
      return { kind: "cancelled" };
    }
    if (row.template_name === "ticket" && (await ticketMailAlreadyOut(tx, row.event_id, registration.attendee_id!))) {
      await writeMailResult(tx, row, ticketAlreadyOutResult());
      return { kind: "ticket_already_out" };
    }
    return {
      kind: "send",
      attendeeId: registration.attendee_id,
      registration: {
        id: registration.id,
        email: registration.email,
        first_name: registration.first_name,
        last_name: registration.last_name,
        name: registration.name,
        email_verified_at: registration.email_verified_at,
        decided_by: registration.decided_by,
      },
    };
  }, CHECK_TX_OPTIONS);
}
