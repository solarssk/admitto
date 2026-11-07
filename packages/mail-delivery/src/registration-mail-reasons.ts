/**
 * What a registration mail row records when its mail does not go out: a code from one of the two closed lists
 * below, and the fixed sentence of that code. Never the text of an exception or of a provider's reply, which can
 * carry the guest's address or name (a stored error never carries a raw exception message, see AGENTS.md).
 */
export interface RegistrationMailReason {
  readonly error_code: string;
  readonly error: string;
}

const reason = (error_code: string, error: string): RegistrationMailReason => ({ error_code, error });

/** Why a mail failed: the row becomes `failed`, and is tried again (`retryable`) or not. */
export const MAIL_FAILURE = {
  unavailable: reason("mail_unavailable", "The mail provider is not set up, or could not be reached."),
  unusable: reason("message_unusable", "The message cannot be built from the current template."),
  sendFailed: reason("send_failed", "The mail provider could not send the message."),
  sendRejected: reason("send_rejected", "The mail provider refused the message."),
  ticketFailed: reason("ticket_failed", "The ticket mail could not be queued."),
  internal: reason("internal_error", "The message could not be processed."),
} as const;

/** Why a mail was not sent at all: the row becomes `cancelled`. */
export const MAIL_CANCELLATION = {
  registrationChanged: reason(
    "registration_changed",
    "The registration changed after the mail was queued, so it was not sent.",
  ),
  confirmationExpired: reason("confirmation_expired", "The confirmation link expired before the mail was sent."),
  ticketNotIssuable: reason("ticket_not_issuable", "The attendee can no longer get a ticket."),
} as const;

/** A failure with the reason to record and whether the drain should try the row again. */
export class RegistrationMailFailure extends Error {
  constructor(
    readonly reason: RegistrationMailReason,
    readonly retryable: boolean,
  ) {
    // The code, not the text of whatever went wrong: this error ends up in no log and no row.
    super(reason.error_code);
    this.name = "RegistrationMailFailure";
  }
}
