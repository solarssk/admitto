import type { MailMessage, MailerAdapter, SendResult } from "./types.js";
import { isSendSuccess } from "./types.js";

export * from "./types.js";
export * from "./config.js";
export * from "./errorMapping.js";
export { GraphAdapter } from "./adapters/graph.js";
export { SmtpAdapter } from "./adapters/smtp.js";
export { PowerAutomateAdapter } from "./adapters/powerAutomate.js";
export { ExportOnlyAdapter, type ExportSink } from "./adapters/exportOnly.js";
export { MockAdapter } from "./adapters/mock.js";
export { configFromEnv } from "./configFromEnv.js";
export { validateMailMessage } from "./validation.js";
export {
  MailDestinationError,
  assertSafeMailDestination,
  isBlockedMailHost,
  resolveSafeMailDestination,
  type MailDestinationErrorCode,
} from "./ssrfGuard.js";
export { createMailer, closeMailer, type CreateMailerDeps } from "./factory.js";
export { probeMailTransport, type MailProbeResult } from "./probe.js";

const MAX_BATCH_CONCURRENCY = 20;

export interface BatchOptions {
  /** Max parallel sends. Defaults to 3 (gentle on connectors). Capped at 20. */
  concurrency?: number;
  /** Callback after each result — for logging / updating DB status. */
  onResult?: (result: SendResult, message: MailMessage, index: number) => void;
}

export interface BatchSummary {
  total: number;
  /** Messages accepted by the provider (includes legacy "sent" status). */
  sent: number;
  failed: number;
  results: SendResult[];
}

/**
 * Batch send with bounded concurrency. Dedup/idempotency is the caller's
 * responsibility — pass only messages that should actually be sent.
 */
export async function sendBatch(
  adapter: MailerAdapter,
  messages: MailMessage[],
  options: BatchOptions = {},
): Promise<BatchSummary> {
  const concurrency = Math.min(MAX_BATCH_CONCURRENCY, Math.max(1, options.concurrency ?? 3));
  const pendingResults = new Map<number, SendResult>();
  let next = 0;

  async function worker() {
    while (true) {
      const index = next++;
      if (index >= messages.length) return;
      const message = messages.at(index)!;
      const result = await adapter.send(message);
      pendingResults.set(index, result);
      options.onResult?.(result, message, index);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, messages.length) }, () => worker());
  await Promise.all(workers);

  const results = Array.from({ length: messages.length }, (_, index) => pendingResults.get(index)!);
  const sent = results.filter((r) => isSendSuccess(r.status)).length;
  return { total: messages.length, sent, failed: messages.length - sent, results };
}
