import type { ExportOnlyConfig } from "../config.js";
import { EXPORT_ONLY_CAPABILITIES } from "../capabilities.js";
import { rejectedSendResult } from "../adapterUtils.js";
import { toMailSender } from "../senderUtils.js";
import { validateMailMessage } from "../validation.js";
import type { ExportPayload, MailMessage, MailerAdapter, SendResult } from "../types.js";
import { emitSystemLog } from "@admitto/shared/system-log";
import { redactEmail } from "@admitto/shared";

export type ExportSink = (payload: ExportPayload) => void | Promise<void>;

/**
 * Does not send email — returns accepted and optionally hands the rendered message
 * to an injected sink for persistence/export by a higher layer.
 */
export class ExportOnlyAdapter implements MailerAdapter {
  readonly provider = "export_only" as const;
  readonly capabilities = EXPORT_ONLY_CAPABILITIES;

  constructor(
    private readonly config: ExportOnlyConfig,
    private readonly exportSink?: ExportSink,
  ) {}

  async close(): Promise<void> {
    return Promise.resolve();
  }

  async send(message: MailMessage): Promise<SendResult> {
    const validationError = validateMailMessage(message);
    if (validationError) {
      return rejectedSendResult(this.provider, validationError, message.idempotencyKey);
    }

    const base: SendResult = {
      status: "failed",
      provider: this.provider,
      idempotencyKey: message.idempotencyKey,
    };

    if (this.exportSink) {
      try {
        await this.exportSink({ message, sender: toMailSender(this.config) });
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        emitSystemLog("mail", "error", "mail_send_failed", { provider: this.provider, error });
        return {
          ...base,
          retryable: false,
          error,
        };
      }
    }

    emitSystemLog("mail", "info", "mail_sent", { provider: this.provider, to: redactEmail(message.to) });
    return {
      status: "accepted",
      provider: this.provider,
      idempotencyKey: message.idempotencyKey,
    };
  }
}
