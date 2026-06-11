import type { ExportOnlyConfig } from "../config.js";
import { EXPORT_ONLY_CAPABILITIES } from "../capabilities.js";
import { toMailSender } from "../senderUtils.js";
import type { ExportPayload, MailMessage, MailerAdapter, SendResult } from "../types.js";

export type ExportSink = (payload: ExportPayload) => void;

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

  async send(message: MailMessage): Promise<SendResult> {
    const sender = toMailSender(this.config);
    this.exportSink?.({ message, sender });
    return {
      status: "accepted",
      provider: this.provider,
      idempotencyKey: message.idempotencyKey,
    };
  }
}
