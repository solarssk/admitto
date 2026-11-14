import type { Prisma } from "@admitto/db";
import { isMailDrainAttemptsExhausted, nextMailDrainAttempts } from "./drain-retry.js";
import type { RegistrationMailReason } from "./registration-mail-reasons.js";

/** A `RegistrationMail` row as the drain read it before the last check: a plain read, no lock. */
export const QUEUED_MAIL_SELECT = {
  id: true,
  event_id: true,
  registration_id: true,
  template_name: true,
  status: true,
  attempts: true,
  queued_at: true,
  attempted_at: true,
} as const satisfies Prisma.RegistrationMailSelect;

export type QueuedRegistrationMail = Prisma.RegistrationMailGetPayload<{ select: typeof QUEUED_MAIL_SELECT }>;

type DbClient = Pick<Prisma.TransactionClient, "registrationMail">;

/** The columns a result writes. `attempts` counts the attempts made, so a row that was never tried has 0. */
export type MailResult = Prisma.RegistrationMailUpdateManyMutationInput;

/** The mail left: the provider took the message (`accepted`, or `sent` when it says so). */
export function sentResult(row: QueuedRegistrationMail, providerMessageId?: string, status: "accepted" | "sent" = "sent"): MailResult {
  const now = new Date();
  return {
    status,
    attempts: nextMailDrainAttempts(row.attempts),
    attempted_at: now,
    sent_at: now,
    provider_message_id: providerMessageId ?? null,
    retryable: null,
    error_code: null,
    error: null,
  };
}

/** A ticket row whose ticket mail is already out, or is waiting in the delivery queue: nothing is sent for it. */
export function ticketAlreadyOutResult(): MailResult {
  const now = new Date();
  return { status: "sent", attempted_at: now, sent_at: now, retryable: null, error_code: null, error: null };
}

/** The mail failed. It is tried again unless `retryable` is false or the attempts are used up. */
export function failedResult(row: QueuedRegistrationMail, why: RegistrationMailReason, retryable: boolean): MailResult {
  const attempts = nextMailDrainAttempts(row.attempts);
  return {
    status: "failed",
    attempts,
    attempted_at: new Date(),
    retryable: retryable && !isMailDrainAttemptsExhausted(attempts),
    error_code: why.error_code,
    error: why.error,
  };
}

/** The mail is not sent: its registration no longer fits it. */
export function cancelledResult(why: RegistrationMailReason): MailResult {
  return { status: "cancelled", retryable: false, error_code: why.error_code, error: why.error };
}

/**
 * Writes a result with one conditional update of the mail's own row. It matches only the row as the drain read it
 * (status, `queued_at` as the revision, attempts), so a row that was reset to `queued` meanwhile (a retry) keeps its
 * reset, and a row that is gone (its registration was erased or deleted) matches nothing and is not put back.
 * Says whether it wrote.
 */
export async function writeMailResult(db: DbClient, row: QueuedRegistrationMail, data: MailResult): Promise<boolean> {
  const { count } = await db.registrationMail.updateMany({
    where: { id: row.id, status: row.status, queued_at: row.queued_at, attempts: row.attempts },
    data,
  });
  return count > 0;
}
