import type { LookupAddress } from "node:dns";
import { Agent, fetch as undiciFetch } from "undici";
import type { PowerAutomateConfig } from "../config.js";
import { POWER_AUTOMATE_CAPABILITIES } from "../capabilities.js";
import { mapHttpStatus, mapNetworkError, sanitizeProviderErrorForLog } from "../errorMapping.js";
import { logMailSent, rejectedSendResult } from "../adapterUtils.js";
import { resolveReplyTo } from "../senderUtils.js";
import { validateMailMessage } from "../validation.js";
import { resolveSafeMailDestination } from "../ssrfGuard.js";
import { isSendSuccess, type FetchFn, type MailMessage, type MailerAdapter, type SendResult } from "../types.js";
import { emitSystemLog } from "@admitto/shared/system-log";
import { redactEmail } from "@admitto/shared";

/**
 * Pin the outbound connection to an already-validated address (see ssrfGuard.ts) while
 * keeping the original hostname for the Host header / TLS SNI. Without this, `fetch`
 * would re-resolve the hostname itself at connect time — a second, separate DNS lookup
 * that a rebinding attacker can answer differently from the validation lookup above.
 *
 * Takes a `handler` rather than returning the raw Response: `dispatcher.close()` in the
 * `finally` block waits for the request to fully complete, which for a response whose
 * body is never read means it waits forever — the caller must consume the body inside
 * `handler`, before this function (and its `finally`) returns.
 */
export async function withPinnedFetch<T>(
  url: string,
  hostname: string,
  record: LookupAddress,
  init: { method: string; headers: Record<string, string>; body: string },
  handler: (res: Response) => Promise<T>,
): Promise<T> {
  const dispatcher = new Agent({
    connect: {
      servername: hostname,
      lookup: (_host, options, callback) => {
        if (options.all) {
          (callback as (err: null, addresses: { address: string; family: number }[]) => void)(
            null,
            [{ address: record.address, family: record.family }],
          );
        } else {
          callback(null, record.address, record.family);
        }
      },
    },
  });
  try {
    const res = (await undiciFetch(url, {
      ...init,
      redirect: "error",
      dispatcher,
    } as Parameters<typeof undiciFetch>[1])) as unknown as Response;
    return await handler(res);
  } finally {
    await dispatcher.close();
  }
}

/**
 * Power Automate — sends via an HTTP-triggered flow (Admitto POSTs a ready-to-send
 * message; the flow sends it from a shared mailbox).
 */
export class PowerAutomateAdapter implements MailerAdapter {
  readonly provider = "powerautomate" as const;
  readonly capabilities = POWER_AUTOMATE_CAPABILITIES;

  /** `fetchFn` DI (tests only) bypasses DNS pinning; production leaves it unset. */
  constructor(
    private readonly config: PowerAutomateConfig,
    private readonly fetchFn?: FetchFn,
  ) {}

  async close(): Promise<void> {
    return Promise.resolve();
  }

  async send(message: MailMessage): Promise<SendResult> {
    const validationError = validateMailMessage(message);
    if (validationError) {
      return rejectedSendResult(this.provider, validationError, message.idempotencyKey);
    }

    const hostname = new URL(this.config.url).hostname;
    let records: LookupAddress[];
    try {
      records = await resolveSafeMailDestination(hostname);
    } catch (e) {
      const error = e instanceof Error ? e.message : "mail transport destination is not permitted";
      // Fixed category, not `error` - see the same note in smtp.ts. The real message
      // still reaches the caller via the return value below.
      emitSystemLog("security", "warn", "mail_destination_blocked", {
        provider: this.provider,
        error: "destination blocked or unresolvable",
      });
      return rejectedSendResult(this.provider, error, message.idempotencyKey);
    }

    const base: SendResult = {
      status: "failed",
      provider: this.provider,
      idempotencyKey: message.idempotencyKey,
    };

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.config.key) headers["x-admitto-key"] = this.config.key;

    const replyTo = resolveReplyTo(this.config.replyTo, message);

    const body = JSON.stringify({
      to: message.to,
      subject: message.subject,
      html: message.html,
      cc: message.cc,
      replyTo,
      fromAddress: this.config.fromAddress,
      fromName: this.config.fromName,
      envelopeFrom: this.config.envelopeFrom,
    });

    const processResponse = async (res: Response): Promise<SendResult> => {
      // Always consume the body — an unread response body keeps the underlying
      // socket/dispatcher from closing (see withPinnedFetch).
      const text = (await res.text().catch(() => "")).slice(0, 200);

      if (res.ok) {
        return {
          status: "accepted",
          provider: this.provider,
          providerMessageId: res.headers.get("x-ms-workflow-run-id") ?? undefined,
          idempotencyKey: message.idempotencyKey,
        };
      }
      const mapped = mapHttpStatus(res.status);
      return {
        ...base,
        status: mapped.status,
        retryable: mapped.retryable,
        error: `Power Automate: HTTP ${res.status}${text ? " — " + text : ""}`,
      };
    };

    try {
      // Reject outright rather than follow a redirect — a same-host-looking URL that
      // 302s to an internal target would otherwise bypass the destination check above.
      const result = this.fetchFn
        ? await this.fetchFn(this.config.url, { method: "POST", headers, redirect: "error", body }).then(
            processResponse,
          )
        : await withPinnedFetch(
            this.config.url,
            hostname,
            records[0]!,
            { method: "POST", headers, body },
            processResponse,
          );
      if (isSendSuccess(result.status)) {
        logMailSent(this.provider, redactEmail(message.to));
      } else {
        // Drop the response-body suffix - `processResponse` includes up to 200 raw chars
        // of the flow's HTTP response, which could echo the message we just posted
        // (recipient, subject) if the flow reflects request content back on error. The
        // full error (with suffix) still reaches the caller via SendResult.error.
        emitSystemLog("mail", "error", "mail_send_failed", {
          provider: this.provider,
          error: sanitizeProviderErrorForLog(result.error ?? "Power Automate send failed"),
        });
      }
      return result;
    } catch (e) {
      const mapped = mapNetworkError();
      const error = e instanceof Error ? e.message : String(e);
      emitSystemLog("mail", "error", "mail_send_failed", { provider: this.provider, error });
      return {
        ...base,
        status: mapped.status,
        retryable: mapped.retryable,
        error,
      };
    }
  }
}
