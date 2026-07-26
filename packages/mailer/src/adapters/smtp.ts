import nodemailer, { type Transporter } from "nodemailer";
import type { SmtpConfig } from "../config.js";
import { SMTP_CAPABILITIES } from "../capabilities.js";
import { extractSmtpCode, mapSmtpError } from "../errorMapping.js";
import { logMailSent, rejectedSendResult } from "../adapterUtils.js";
import { formatFromHeader, parseAddressList, resolveReplyTo } from "../senderUtils.js";
import { validateMailMessage } from "../validation.js";
import { assertSafeMailDestination, resolveSafeMailDestination } from "../ssrfGuard.js";
import type { MailMessage, MailerAdapter, SendResult } from "../types.js";
import { emitSystemLog } from "@admitto/shared/system-log";
import { redactEmail } from "@admitto/shared";

/**
 * SMTP via nodemailer. Works with any standards-compliant mail server.
 *
 * A transporter (or transport options like `{ jsonTransport: true }`) must be supplied —
 * tests inject one directly; production goes through `SmtpAdapter.create()`, which resolves
 * DNS and pins the transporter's connect target to the validated address (see `create()`).
 */
export class SmtpAdapter implements MailerAdapter {
  readonly provider = "smtp" as const;
  readonly capabilities = SMTP_CAPABILITIES;

  constructor(
    private readonly config: SmtpConfig,
    private readonly transporter: Transporter,
  ) {}

  /**
   * Resolve + validate `config.host`'s DNS before building the transporter, then pin the
   * transporter's connect target to that validated address (nodemailer skips its own DNS
   * lookup when `host` is already a literal IP — see `smtp-connection`'s `resolveHostname`).
   * Without this, nodemailer would re-resolve the hostname itself at connect time — a
   * second, separate DNS lookup that a rebinding attacker can answer differently from the
   * validation lookup here.
   */
  static async create(config: SmtpConfig): Promise<SmtpAdapter> {
    const records = await resolveSafeMailDestination(config.host);
    const transporter = SmtpAdapter.createTransporter(config, records[0]!.address);
    return new SmtpAdapter(config, transporter);
  }

  /**
   * Build a nodemailer transporter from SMTP config.
   * Enforces TLS 1.2 minimum via `tls.minVersion`. `connectHost` (defaults to `config.host`)
   * is what nodemailer actually connects to; `tls.servername` stays the real hostname
   * regardless, so SNI/cert validation is unaffected by connecting to a pinned IP.
   */
  static createTransporter(config: SmtpConfig, connectHost: string = config.host): Transporter {
    return nodemailer.createTransport({
      host: connectHost,
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
      const error = e instanceof Error ? e.message : "mail transport destination is not permitted";
      // Fixed category, not `error` - a DNS-lookup failure (as opposed to the SSRF guard's
      // own fixed "private/loopback" message) can surface the configured hostname in
      // Node's own error text; the real message still reaches the caller via the return
      // value below, just not the System-logs buffer/stdout.
      emitSystemLog("security", "warn", "mail_destination_blocked", {
        provider: this.provider,
        error: "destination blocked or unresolvable",
      });
      return rejectedSendResult(
        this.provider,
        error,
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
      logMailSent(this.provider, redactEmail(message.to));
      return {
        status: "accepted",
        provider: this.provider,
        providerMessageId: info.messageId,
        idempotencyKey: message.idempotencyKey,
      };
    } catch (e) {
      const mapped = mapSmtpError(e);
      const smtpCode = extractSmtpCode(e);
      // Logged reason is the SMTP reply code only - the raw exception text (nodemailer's
      // `e.message`/`response`) is the mail server's own reply, which commonly echoes the
      // rejected recipient address back verbatim (e.g. "550 no such user <bob@example.com>").
      // The full message still reaches the caller via SendResult.error below.
      emitSystemLog("mail", "error", "mail_send_failed", {
        provider: this.provider,
        error: smtpCode !== undefined ? `SMTP ${smtpCode}` : "SMTP send failed",
      });
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
