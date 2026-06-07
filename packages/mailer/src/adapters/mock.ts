import type { MailMessage, MailerAdapter, MailerProvider, SendResult } from "../types.js";

/**
 * Test / preview adapter. Does not send anything — records messages in memory.
 * Useful for: unit tests, dry-run mode, and rendering a preview in the UI.
 */
export class MockAdapter implements MailerAdapter {
  readonly provider: MailerProvider;
  readonly sent: MailMessage[] = [];
  private readonly failOn?: (m: MailMessage) => boolean;

  constructor(opts: { provider?: MailerProvider; failOn?: (m: MailMessage) => boolean } = {}) {
    this.provider = opts.provider ?? "powerautomate";
    this.failOn = opts.failOn;
  }

  async send(message: MailMessage): Promise<SendResult> {
    if (this.failOn?.(message)) {
      return {
        status: "failed",
        provider: this.provider,
        error: "MockAdapter: forced failure",
        idempotencyKey: message.idempotencyKey,
      };
    }
    this.sent.push(message);
    return {
      status: "sent",
      provider: this.provider,
      providerMessageId: `mock-${this.sent.length}`,
      idempotencyKey: message.idempotencyKey,
    };
  }
}
