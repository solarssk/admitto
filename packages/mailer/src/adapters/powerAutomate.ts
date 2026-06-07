import type { PowerAutomateConfig } from "../config.js";
import type { FetchFn, MailMessage, MailerAdapter, SendResult } from "../types.js";

/**
 * Power Automate — sends via an HTTP-triggered flow (Admitto POSTs a ready-to-send
 * message; the flow sends it from a shared mailbox).
 *
 * Licensing note: the "When an HTTP request is received" trigger is PREMIUM.
 * A free-tier variant (OneDrive file-drop) is a separate adapter to add later;
 * this adapter assumes an HTTP endpoint returning 2xx (ideally with a Response action).
 */
export class PowerAutomateAdapter implements MailerAdapter {
  readonly provider = "powerautomate" as const;

  constructor(
    private readonly config: PowerAutomateConfig,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  async send(message: MailMessage): Promise<SendResult> {
    const base: SendResult = {
      status: "failed",
      provider: this.provider,
      idempotencyKey: message.idempotencyKey,
    };

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.config.key) headers["x-admitto-key"] = this.config.key;

    try {
      const res = await this.fetchFn(this.config.url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          to: message.to,
          subject: message.subject,
          html: message.html,
          cc: message.cc,
          replyTo: message.replyTo,
        }),
      });

      if (res.ok) {
        return {
          status: "sent",
          provider: this.provider,
          providerMessageId: res.headers.get("x-ms-workflow-run-id") ?? undefined,
          idempotencyKey: message.idempotencyKey,
        };
      }
      const text = (await res.text().catch(() => "")).slice(0, 200);
      return { ...base, error: `Power Automate: HTTP ${res.status}${text ? " — " + text : ""}` };
    } catch (e) {
      return { ...base, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
