import type { Prisma, PrismaClient } from "@admitto/db";
import { writeBulkActionLog } from "./ops-audit.js";
import type { StaffActor } from "./registration-decisions.js";
import { canRetryRegistrationMail } from "./registration-list.js";
import { lockRegistrationQueue } from "./registration-lock.js";

/** A request of staff may wait for the registration queue as long as the statement timeout lets it (as a decision does). */
const RETRY_TRANSACTION_OPTIONS = { timeout: 60_000, maxWait: 10_000 } as const;

export type RetryRegistrationMailsParams = {
  eventId: string;
  /** The registrations whose last mail is sent again, at most as many as one request may carry (the route limits it). */
  ids: readonly string[];
  actor: StaffActor;
  /** The moment of the retry; tests set it. */
  now?: Date;
};

/**
 * What became of one registration of a retry:
 * - `retried`: its last mail is queued again, and the worker sends it on its next tick (the reset wakes it);
 * - `not_retryable`: its last mail is not one that staff may send again (canRetryRegistrationMail: it did not fail for good,
 *   or the registration no longer fits it, so the worker would cancel it), or it has none;
 * - `gone`: no such registration in the event (deleted, erased, or never there);
 * - `closed`: the event is archived or gone, and nothing is changed in it.
 */
export type RetryMailOutcome = { id: string; outcome: "retried" | "not_retryable" | "gone" | "closed" };

export type RetryRegistrationMailsResult = { outcomes: RetryMailOutcome[] };

function outcomeOf(retried: boolean, exists: boolean): RetryMailOutcome["outcome"] {
  if (retried) return "retried";
  return exists ? "not_retryable" : "gone";
}

async function retryInTransaction(
  tx: Prisma.TransactionClient,
  { eventId, ids, actor, now }: { eventId: string; ids: readonly string[]; actor: StaffActor; now: Date },
): Promise<RetryRegistrationMailsResult> {
  await lockRegistrationQueue(tx, eventId);
  const event = await tx.event.findUnique({ where: { id: eventId }, select: { archived_at: true } });
  if (event?.archived_at !== null) return { outcomes: ids.map((id) => ({ id, outcome: "closed" })) };

  // The last mail of each registration is the one the list shows (newest queued, remaining ties by id).
  const rows = await tx.registration.findMany({
    where: { event_id: eventId, id: { in: [...ids] } },
    select: {
      id: true,
      status: true,
      confirm_expires_at: true,
      mails: {
        orderBy: [{ queued_at: "desc" }, { id: "desc" }],
        take: 1,
        select: { id: true, template_name: true, status: true, retryable: true },
      },
    },
  });
  const lastMail = new Map(rows.map((row) => [row.id, row.mails.at(0)]));
  const mailIds = rows.flatMap((row) => {
    const mail = row.mails.at(0);
    return mail && canRetryRegistrationMail(mail, row, now.getTime()) ? [mail.id] : [];
  });

  // canRetryRegistrationMail is the one rule, applied above under the registration queue. Nothing can move these
  // rows before this update: every writer of a mail row takes the queue, except the worker's write of a send result,
  // and that matches only a row the worker claimed, never one that failed for good. The reset is what
  // docs/dev/attendee-erasure.md and the mail-delivery README describe: a new revision (`queued_at`) that a send in
  // progress cannot write over, and the attempts counted from zero.
  const reset = await tx.registrationMail.updateManyAndReturn({
    where: { id: { in: mailIds }, event_id: eventId },
    data: {
      status: "queued",
      attempts: 0,
      retryable: null,
      queued_at: now,
      attempted_at: null,
      sent_at: null,
      error_code: null,
      error: null,
    },
    select: { registration_id: true },
  });
  const retried = new Set(reset.map((mail) => mail.registration_id));
  if (retried.size > 0) {
    await writeBulkActionLog(tx, {
      event_id: eventId,
      action_type: "registration_mail_retried",
      audit: actor,
      metadata: { count: retried.size, registration_ids: [...retried] },
    });
  }
  return { outcomes: ids.map((id): RetryMailOutcome => ({ id, outcome: outcomeOf(retried.has(id), lastMail.has(id)) })) };
}

/**
 * Staff send again the last mail of registrations whose mail failed for good (D-B15): a failed mail that the worker
 * is not trying again by itself. Each such row goes back to `queued` as if it had never been tried (attempts at zero,
 * no error), with a new `queued_at`. Nothing is sent from here and no state of the registration changes, as a mail
 * failure never does. A mail that is queued, was sent, was cancelled, or is still being tried by the worker is left
 * alone, and so is any mail but the last of a registration.
 *
 * Takes the registration queue (step 5 of the order in lockRegistrationQueue) and changes only `RegistrationMail`
 * rows. No capacity lock: it neither takes nor frees a seat. An erasure or a deletion that comes first has deleted the
 * registration and its mail, so it is `gone` here; one that comes after deletes the registration with the reset mail.
 */
export async function retryRegistrationMails(
  db: PrismaClient,
  params: RetryRegistrationMailsParams,
): Promise<RetryRegistrationMailsResult> {
  const ids = [...new Set(params.ids)];
  if (ids.length === 0) return { outcomes: [] };
  const now = params.now ?? new Date();
  return await db.$transaction(
    (tx) => retryInTransaction(tx, { eventId: params.eventId, ids, actor: params.actor, now }),
    RETRY_TRANSACTION_OPTIONS,
  );
}
