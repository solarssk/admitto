import type { PowerAutomateConfig } from "../config.js";
import { POWER_AUTOMATE_CAPABILITIES } from "../capabilities.js";
import { mapHttpStatus, mapNetworkError } from "../errorMapping.js";
import { rejectedSendResult } from "../adapterUtils.js";
import { resolveReplyTo } from "../senderUtils.js";
import { validateMailMessage } from "../validation.js";
import type { FetchFn, MailMessage, MailerAdapter, SendResult } from "../types.js";

/**
 * Power Automate — sends via an HTTP-triggered flow (Admitto POSTs a ready-to-send
 * message; the flow sends it from a shared mailbox).
 */
export class PowerAutomateAdapter implements MailerAdapter {
  readonly provider = "powerautomate" as const;
  readonly capabilities = POWER_AUTOMATE_CAPABILITIES;

  constructor(
    private readonly config: PowerAutomateConfig,
    private readonly fetchFn: FetchFn = fetch,
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

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.config.key) headers["x-admitto-key"] = this.config.key;

    const replyTo = resolveReplyTo(this.config.replyTo, message);

    try {
      const res = await this.fetchFn(this.config.url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          to: message.to,
          subject: message.subject,
          html: message.html,
          cc: message.cc,
          replyTo,
          fromAddress: this.config.fromAddress,
          fromName: this.config.fromName,
          envelopeFrom: this.config.envelopeFrom,
        }),
      });

      if (res.ok) {
        return {
          status: "accepted",
          provider: this.provider,
          providerMessageId: res.headers.get("x-ms-workflow-run-id") ?? undefined,
          idempotencyKey: message.idempotencyKey,
        };
      }
      const text = (await res.text().catch(() => "")).slice(0, 200);
      const mapped = mapHttpStatus(res.status);
      return {
        ...base,
        status: mapped.status,
        retryable: mapped.retryable,
        error: `Power Automate: HTTP ${res.status}${text ? " — " + text : ""}`,
      };
    } catch (e) {
      const mapped = mapNetworkError();
      return {
        ...base,
        status: mapped.status,
        retryable: mapped.retryable,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }
}
