import nodemailer, { type Transporter } from "nodemailer";
import type { SmtpConfig } from "../config.js";
import type { MailMessage, MailerAdapter, SendResult } from "../types.js";

/**
 * SMTP via nodemailer. Works with any standards-compliant mail server.
 * Note: some M365 tenants disable SMTP AUTH by default — check your org's policy.
 *
 * An optional transporter (or transport options like `{ jsonTransport: true }`)
 * can be injected for testing without sending real email.
 */
export class SmtpAdapter implements MailerAdapter {
  readonly provider = "smtp" as const;
  private readonly transporter: Transporter;

  constructor(
    private readonly config: SmtpConfig,
    /** Optional transporter (DI for tests). If omitted, created from config. */
    transporter?: Transporter,
  ) {
    this.transporter =
      transporter ??
      nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure, // false => STARTTLS on port 587
        requireTLS: !config.secure,
        auth: { user: config.user, pass: config.password },
      });
  }

  async send(message: MailMessage): Promise<SendResult> {
    try {
      const info = await this.transporter.sendMail({
        from: this.config.from,
        to: message.to,
        cc: message.cc,
        replyTo: message.replyTo,
        subject: message.subject,
        html: message.html,
      });
      return {
        status: "sent",
        provider: this.provider,
        providerMessageId: info.messageId,
        idempotencyKey: message.idempotencyKey,
      };
    } catch (e) {
      return {
        status: "failed",
        provider: this.provider,
        error: e instanceof Error ? e.message : String(e),
        idempotencyKey: message.idempotencyKey,
      };
    }
  }
}
