import { closeMailer, createMailer, type CreateMailerDeps } from "./factory.js";
import { GraphAdapter } from "./adapters/graph.js";
import { SmtpAdapter } from "./adapters/smtp.js";
import { sanitizeProviderErrorForLog } from "./errorMapping.js";

/** Match OIDC / Cloudflare Access connection-test deadlines. */
export const MAIL_PROBE_TIMEOUT_MS = 15_000;

/** Result of a non-sending transport reachability probe (health live checks). */
export type MailProbeResult =
  | { ok: true; skipped?: boolean }
  | { ok: false; error: string };

export type ProbeMailTransportDeps = CreateMailerDeps & {
  /** Override probe deadline (tests). Defaults to {@link MAIL_PROBE_TIMEOUT_MS}. */
  probeTimeoutMs?: number;
};

function probeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const sanitized = sanitizeProviderErrorForLog(raw);
  // Keep operator-facing text short; never echo secrets from provider replies.
  return sanitized.slice(0, 200) || "Connection probe failed";
}

async function withProbeTimeout(work: Promise<void>, timeoutMs: number): Promise<void> {
  const signal = AbortSignal.timeout(timeoutMs);
  await Promise.race([
    work,
    new Promise<never>((_, reject) => {
      const onAbort = () => reject(new Error("Connection probe timed out"));
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }),
  ]);
}

/**
 * Prove mail transport credentials/endpoint without sending a message.
 * SMTP: nodemailer verify. Graph: client-credentials token. Power Automate /
 * export_only: create succeeds but live verify is skipped (`skipped: true`).
 * SMTP/Graph verifies are bounded by {@link MAIL_PROBE_TIMEOUT_MS}.
 */
export async function probeMailTransport(
  config: unknown,
  deps: ProbeMailTransportDeps = {},
): Promise<MailProbeResult> {
  const { probeTimeoutMs = MAIL_PROBE_TIMEOUT_MS, ...createDeps } = deps;
  let mailer;
  try {
    mailer = await createMailer(config, createDeps);
  } catch (err) {
    return { ok: false, error: probeErrorMessage(err) };
  }

  try {
    if (mailer.provider === "powerautomate" || mailer.provider === "export_only") {
      return { ok: true, skipped: true };
    }
    if (mailer instanceof SmtpAdapter) {
      await withProbeTimeout(mailer.verifyConnection(), probeTimeoutMs);
      return { ok: true };
    }
    if (mailer instanceof GraphAdapter) {
      await withProbeTimeout(mailer.verifyConnection(), probeTimeoutMs);
      return { ok: true };
    }
    return { ok: true, skipped: true };
  } catch (err) {
    return { ok: false, error: probeErrorMessage(err) };
  } finally {
    await closeMailer(mailer);
  }
}
