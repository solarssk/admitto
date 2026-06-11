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
