import nodemailer, { type Transporter } from "nodemailer";
import type { SmtpConfig } from "../config.js";
import { SMTP_CAPABILITIES } from "../capabilities.js";
import { mapSmtpError } from "../errorMapping.js";
import { formatFromHeader, parseAddressList, resolveReplyTo } from "../senderUtils.js";
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

  constructor(
    private readonly config: SmtpConfig,
    /** Optional transporter (DI for tests). If omitted, created from config. */
    transporter?: Transporter,
  ) {
    this.transporter = transporter ?? SmtpAdapter.createTransporter(config);
  }

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
      },
      auth: { user: config.user, pass: config.password },
    } as nodemailer.TransportOptions);
  }

  async send(message: MailMessage): Promise<SendResult> {
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
