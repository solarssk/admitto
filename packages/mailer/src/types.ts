/**
 * Shared mailer contract. The rest of Admitto depends ONLY on these types,
 * never on a concrete transport (Graph / SMTP / Power Automate).
 */

export type MailerProvider = "graph" | "smtp" | "powerautomate";

/**
 * A single message — already RENDERED by Admitto (personalisation,
 * QR codes, Wallet links arrive here as final HTML). The transport only sends it.
 */
export interface MailMessage {
  /** Recipient address. One message = one recipient (per-person personalisation). */
  to: string;
  subject: string;
  /** Final, Outlook-safe HTML. */
  html: string;
  /** Optional CC (comma-separated address list). */
  cc?: string;
  /** Optional Reply-To. */
  replyTo?: string;
  /**
   * Optional idempotency key (e.g. EmailDelivery record id or attendee token).
   * Dedup is the caller's responsibility; this field is used for log correlation.
   */
  idempotencyKey?: string;
}

export interface SendResult {
  status: "sent" | "failed";
  provider: MailerProvider;
  /** Provider-assigned identifier, if available (messageId / request-id). */
  providerMessageId?: string;
  /** Human-readable error message (no secrets). */
  error?: string;
  /** Idempotency key echoed from the message, for correlation. */
  idempotencyKey?: string;
}

/** Every transport implements this interface and nothing more. */
export interface MailerAdapter {
  readonly provider: MailerProvider;
  /**
   * Sends one message. Does NOT throw on send failure —
   * returns SendResult with status "failed". Exceptions are reserved for
   * configuration / programming errors.
   */
  send(message: MailMessage): Promise<SendResult>;
}

/** Injectable fetch (for tests without real network). Defaults to global fetch. */
export type FetchFn = typeof fetch;
