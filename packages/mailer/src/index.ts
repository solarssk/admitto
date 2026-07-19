import { parseMailerConfig } from "./config.js";
import { GraphAdapter } from "./adapters/graph.js";
import { SmtpAdapter } from "./adapters/smtp.js";
import { PowerAutomateAdapter } from "./adapters/powerAutomate.js";
import { ExportOnlyAdapter, type ExportSink } from "./adapters/exportOnly.js";
import type { ExportPayload, FetchFn, MailMessage, MailerAdapter, SendResult } from "./types.js";
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

export interface CreateMailerDeps {
  /** Injectable fetch (for tests). Applies to graph/powerautomate adapters. */
  fetchFn?: FetchFn;
  /** Called by export_only for each message (optional persistence/export hook). */
  exportSink?: ExportSink;
}

/**
 * Factory — creates the correct adapter from a config (validated or raw).
 * The only place that knows about all transports. The rest of Admitto
 * uses the returned MailerAdapter without caring what's underneath.
 */
export async function createMailer(
  config: unknown,
  deps: CreateMailerDeps = {},
): Promise<MailerAdapter> {
  const cfg = parseMailerConfig(config);
  switch (cfg.provider) {
    case "graph":
      return new GraphAdapter(cfg, deps.fetchFn);
    case "smtp":
      return SmtpAdapter.create(cfg);
    case "powerautomate":
      return new PowerAutomateAdapter(cfg, deps.fetchFn);
    case "export_only":
      if (!deps.exportSink) {
        throw new Error("export_only provider requires exportSink in createMailer deps");
      }
      return new ExportOnlyAdapter(cfg, deps.exportSink);
    default: {
      const _exhaustive: never = cfg;
      throw new Error(`Unknown provider: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

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
  const results: SendResult[] = new Array(messages.length);
  let next = 0;

  async function worker() {
    while (true) {
      const index = next++;
      if (index >= messages.length) return;
      const message = messages[index]!;
      const result = await adapter.send(message);
      results[index] = result;
      options.onResult?.(result, message, index);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, messages.length) }, () => worker());
  await Promise.all(workers);

  const sent = results.filter((r) => isSendSuccess(r.status)).length;
  return { total: messages.length, sent, failed: messages.length - sent, results };
}

/** Release transport resources (SMTP pool, etc.). Call when done with the adapter. */
export async function closeMailer(adapter: MailerAdapter): Promise<void> {
  await adapter.close();
}
