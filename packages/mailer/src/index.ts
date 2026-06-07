import { type MailerConfig, parseMailerConfig } from "./config.js";
import { GraphAdapter } from "./adapters/graph.js";
import { SmtpAdapter } from "./adapters/smtp.js";
import { PowerAutomateAdapter } from "./adapters/powerAutomate.js";
import type { FetchFn, MailMessage, MailerAdapter, SendResult } from "./types.js";

export * from "./types.js";
export * from "./config.js";
export { GraphAdapter } from "./adapters/graph.js";
export { SmtpAdapter } from "./adapters/smtp.js";
export { PowerAutomateAdapter } from "./adapters/powerAutomate.js";
export { MockAdapter } from "./adapters/mock.js";
export { configFromEnv } from "./configFromEnv.js";

export interface CreateMailerDeps {
  /** Injectable fetch (for tests). Applies to graph/powerautomate adapters. */
  fetchFn?: FetchFn;
}

/**
 * Factory — creates the correct adapter from a config (validated or raw).
 * The only place that knows about all transports. The rest of Admitto
 * uses the returned MailerAdapter without caring what's underneath.
 */
export function createMailer(config: MailerConfig | unknown, deps: CreateMailerDeps = {}): MailerAdapter {
  // Always parse — applies defaults (port 587, secure, saveToSentItems) and validates.
  // parse is idempotent for an already-valid config.
  const cfg = parseMailerConfig(config);
  switch (cfg.provider) {
    case "graph":
      return new GraphAdapter(cfg, deps.fetchFn);
    case "smtp":
      return new SmtpAdapter(cfg);
    case "powerautomate":
      return new PowerAutomateAdapter(cfg, deps.fetchFn);
    default: {
      // exhaustive switch — TS will error here if a new provider is added without handling it
      const _exhaustive: never = cfg;
      throw new Error(`Unknown provider: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

export interface BatchOptions {
  /** Max parallel sends. Defaults to 3 (gentle on connectors). */
  concurrency?: number;
  /** Callback after each result — for logging / updating DB status. */
  onResult?: (result: SendResult, message: MailMessage, index: number) => void;
}

export interface BatchSummary {
  total: number;
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
  const concurrency = Math.max(1, options.concurrency ?? 3);
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

  const sent = results.filter((r) => r.status === "sent").length;
  return { total: messages.length, sent, failed: messages.length - sent, results };
}
