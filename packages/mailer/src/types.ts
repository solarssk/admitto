/**
 * Shared mailer contract. The rest of Admitto depends ONLY on these types,
 * never on a concrete transport (Graph / SMTP / Power Automate).
 */

export type MailerProvider = "graph" | "smtp" | "powerautomate" | "export_only";

export type SendResultStatus = "accepted" | "sent" | "failed" | "rejected";

export type DeliveryResultSemantics = "accepted_only" | "sent_items" | "delivery_events";

/** Per-provider feature flags — UI and callers must not assume Graph-like behaviour. */
export interface EmailProviderCapabilities {
  supportsAttachments: boolean;
  supportsCustomHeaders: boolean;
  supportsSentItems: boolean;
  supportsDeliveryEvents: boolean;
  supportsBounceMailbox: boolean;
  supportsEnvelopeFrom: boolean;
  supportsTestConnection: boolean;
  deliveryResultSemantics: DeliveryResultSemantics;
}

/** Sender identity — distinct from per-message overrides in MailMessage. */
export interface MailSender {
  fromAddress: string;
  fromName?: string;
  replyTo?: string;
  /** Return-Path / bounce address where the transport supports it. */
  envelopeFrom?: string;
}

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
  /** Optional Reply-To (overrides config replyTo when set). */
  replyTo?: string;
  /**
   * Optional idempotency key (e.g. EmailDelivery record id or attendee token).
   * Dedup is the caller's responsibility; this field is used for log correlation.
   */
  idempotencyKey?: string;
  /**
   * Log the real recipient address in `mail_sent` (System logs live view + stdout) instead of
   * the default `redactEmail()`-masked form. Off by default because most callers of this
   * interface send to attendees/external recipients - people who aren't the instance's own
   * staff, sent in bulk (hundreds per send), where GDPR's data-minimization principle argues for
   * keeping full addresses out of an operational log whose purpose (confirming sends succeed)
   * doesn't need them. `@admitto/notifications`' EmailChannel sets this to `true`: every one of
   * its sends goes to the instance's own admin/superadmin staff, already fully visible to
   * whichever Superadmin can see this log via the rest of the admin panel (Users & roles, the
   * Attendees list, etc. - masking here added no real privacy protection, only made verifying a
   * security alert actually reached the right person harder). See that package's own audit.ts
   * for the fuller reasoning.
   */
  logRecipientUnmasked?: boolean;
}

export interface SendResult {
  status: SendResultStatus;
  provider: MailerProvider;
  /** Provider-assigned identifier, if available (messageId / request-id). */
  providerMessageId?: string;
  /** Human-readable error message (no secrets). */
  error?: string;
  /** Idempotency key echoed from the message, for correlation. */
  idempotencyKey?: string;
  /** Whether the caller should retry (transient failures). */
  retryable?: boolean;
}

/** Payload handed to exportSink by the export_only provider. */
export interface ExportPayload {
  message: MailMessage;
  sender: MailSender;
}

/** Every transport implements this interface and nothing more. */
export interface MailerAdapter {
  readonly provider: MailerProvider;
  readonly capabilities: EmailProviderCapabilities;
  /**
   * Sends one message. Does NOT throw on send failure —
   * returns SendResult with status "failed" or "rejected". Exceptions are reserved for
   * configuration / programming errors.
   */
  send(message: MailMessage): Promise<SendResult>;
  /** Release transport resources (e.g. SMTP connection pool). Safe to call multiple times. */
  close(): Promise<void>;
}

/** Injectable fetch (for tests without real network). Defaults to global fetch. */
export type FetchFn = typeof fetch;

/** True when the provider accepted the message for delivery (not necessarily delivered). */
export function isSendSuccess(status: SendResultStatus): boolean {
  return status === "accepted" || status === "sent";
}
