import type { Prisma } from "@admitto/db";
import type { RegistrationMailTemplateName } from "@admitto/db/status";

/**
 * A moment at which the registration system mails the guest, in the terms of the decision that causes it (D-D1,
 * D-D2). The table of which template each one queues is `registrationMailFor`, the only place that says so.
 */
export type RegistrationMailMoment =
  /** A new registration whose address has to be confirmed through a link first (link and password methods). */
  | { to: "awaiting_email" }
  /** `afterConfirmation`: the guest confirmed the address through our mail, which already took the place of "received". */
  | { to: "pending"; afterConfirmation: boolean }
  | { to: "waitlist" }
  /** An attendee was created: automatically, or by an organiser. The ticket is also the confirmation of the sign-up. */
  | { to: "accepted" }
  /** An organiser turned the guest down; the mail goes only when they asked to inform the guest (D-B8). */
  | { to: "rejected"; notify: boolean };

/**
 * Which mail a registration gets when it reaches a state (D-D2). Exactly one row per moment, or none:
 * - link or password with confirmation: the confirmation first, then, after the click, the ticket, the waiting
 *   list mail or nothing at all for an event with approval ("received" is replaced by the confirmation);
 * - single sign-on, or confirmation switched off: "received" for approval, the waiting list mail, the ticket;
 * - an organiser's decision: the ticket, or the rejection when they asked to inform the guest.
 * The `ticket` row is no mail of its own: the worker turns it into the usual ticket send (an EmailDelivery).
 */
export function registrationMailFor(moment: RegistrationMailMoment): RegistrationMailTemplateName | null {
  switch (moment.to) {
    case "awaiting_email":
      return "registration-confirm";
    case "pending":
      return moment.afterConfirmation ? null : "registration-received";
    case "waitlist":
      return "registration-waitlist";
    case "accepted":
      return "ticket";
    case "rejected":
      return moment.notify ? "registration-rejected" : null;
  }
}

export type RegistrationMailEntry = {
  registrationId: string;
  eventId: string;
  template: RegistrationMailTemplateName;
};

/**
 * Queues mail rows in the transaction that changes the registration, so that the state and its mail commit
 * together or not at all. `INSERT ... ON CONFLICT DO NOTHING` on (registration, template): a registration is mailed
 * a template at most once, and a row that exists already (queued, sent or failed) is left as it is. The caller
 * holds the registration queue (lockRegistrationQueue); nothing is sent from here.
 */
export async function enqueueRegistrationMails(
  tx: Prisma.TransactionClient,
  entries: readonly RegistrationMailEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  await tx.registrationMail.createMany({
    data: entries.map((entry) => ({
      registration_id: entry.registrationId,
      event_id: entry.eventId,
      template_name: entry.template,
    })),
    skipDuplicates: true,
  });
}

export function enqueueRegistrationMail(tx: Prisma.TransactionClient, entry: RegistrationMailEntry): Promise<void> {
  return enqueueRegistrationMails(tx, [entry]);
}

/** Queues the mail that a moment has (registrationMailFor), if it has one, for each of these registrations of the event. */
export async function enqueueMailsForMoment(
  tx: Prisma.TransactionClient,
  eventId: string,
  registrationIds: readonly string[],
  moment: RegistrationMailMoment,
): Promise<void> {
  const template = registrationMailFor(moment);
  if (template === null) return;
  await enqueueRegistrationMails(
    tx,
    registrationIds.map((registrationId) => ({ registrationId, eventId, template })),
  );
}
