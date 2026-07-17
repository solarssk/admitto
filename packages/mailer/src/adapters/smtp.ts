import nodemailer, { type Transporter } from "nodemailer";
import type { SmtpConfig } from "../config.js";
import { SMTP_CAPABILITIES } from "../capabilities.js";
import { mapSmtpError } from "../errorMapping.js";
import { rejectedSendResult } from "../adapterUtils.js";
import { formatFromHeader, parseAddressList, resolveReplyTo } from "../senderUtils.js";
import { validateMailMessage } from "../validation.js";
import { assertSafeMailDestination } from "../ssrfGuard.js";
import type { MailMessage, MailerAdapter, SendResult } from "../types.js";

/**
 * SMTP via nodemailer. Works with any standards-compliant mail server.
 *
 * An optional transporter (or transport options like `{ jsonTransport: true }`)
 * can be injected for testing without sending real email.
 */
export class SmtpAdapter implements MailerAdapter {
  readonly provider = "smtp" as const;
  readonly capabilities = SMTP_CAPABILITIES;
  private readonly transporter: Transporter;

  /** Create adapter; uses `createTransporter` unless a transporter is injected for tests. */
  constructor(
    private readonly config: SmtpConfig,
    /** Optional transporter (DI for tests). If omitted, created from config. */
    transporter?: Transporter,
  ) {
    this.transporter = transporter ?? SmtpAdapter.createTransporter(config);
  }

  /**
   * Build a nodemailer transporter from SMTP config.
   * Enforces TLS 1.2 minimum via `tls.minVersion`.
   */
  static createTransporter(config: SmtpConfig): Transporter {
    return nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      requireTLS: config.requireTLS,
      pool: config.pool,
      maxConnections: config.maxConnections,
      maxMessages: config.maxMessages,
      rateLimit: config.rateLimitPerMinute,
      rateDelta: 60_000,
      connectionTimeout: config.connectionTimeout,
      greetingTimeout: config.greetingTimeout,
      socketTimeout: config.socketTimeout,
      ...(config.heloName ? { name: config.heloName } : {}),
      tls: {
        rejectUnauthorized: config.tlsRejectUnauthorized,
        servername: config.host,
        minVersion: "TLSv1.2",
      },
      auth: { user: config.user, pass: config.password },
    } as nodemailer.TransportOptions);
  }

  /** Close the underlying nodemailer connection pool. */
  async close(): Promise<void> {
    this.transporter.close();
  }

  /** Validate and send one HTML message via SMTP; never throws (returns rejected result on failure). */
  async send(message: MailMessage): Promise<SendResult> {
    const validationError = validateMailMessage(message);
    if (validationError) {
      return rejectedSendResult(this.provider, validationError, message.idempotencyKey);
    }

    try {
      await assertSafeMailDestination(this.config.host);
    } catch (e) {
      return rejectedSendResult(
        this.provider,
        e instanceof Error ? e.message : "mail transport destination is not permitted",
        message.idempotencyKey,
      );
    }

    const from = formatFromHeader(this.config);
    const replyTo = resolveReplyTo(this.config.replyTo, message);
    const mail: nodemailer.SendMailOptions = {
      from,
      to: message.to,
      cc: message.cc,
      replyTo,
      subject: message.subject,
      html: message.html,
    };
    if (this.config.envelopeFrom) {
      const recipients = [...parseAddressList(message.to)];
      if (message.cc) recipients.push(...parseAddressList(message.cc));
      mail.envelope = { from: this.config.envelopeFrom, to: recipients };
    }

    try {
      const info = await this.transporter.sendMail(mail);
      return {
        status: "accepted",
        provider: this.provider,
        providerMessageId: info.messageId,
        idempotencyKey: message.idempotencyKey,
      };
    } catch (e) {
      const mapped = mapSmtpError(e);
      return {
        status: mapped.status,
        provider: this.provider,
        retryable: mapped.retryable,
        error: e instanceof Error ? e.message : String(e),
        idempotencyKey: message.idempotencyKey,
      };
    }
  }
}
