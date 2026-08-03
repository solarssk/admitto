import { parseMailerConfig } from "./config.js";
import { GraphAdapter } from "./adapters/graph.js";
import { SmtpAdapter } from "./adapters/smtp.js";
import { PowerAutomateAdapter } from "./adapters/powerAutomate.js";
import { ExportOnlyAdapter, type ExportSink } from "./adapters/exportOnly.js";
import type { FetchFn, MailerAdapter } from "./types.js";
import { resolveSafeMailDestination } from "./ssrfGuard.js";

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
      // Same connect-time SSRF gate as SmtpAdapter.create — otherwise destination is only
      // checked inside send(), which swallows failures into rejected SendResult and never
      // reaches API mappers that expect MailDestinationError from createMailer.
      await resolveSafeMailDestination(new URL(cfg.url).hostname);
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

/** Release transport resources (SMTP pool, etc.). Call when done with the adapter. */
export async function closeMailer(adapter: MailerAdapter): Promise<void> {
  await adapter.close();
}
