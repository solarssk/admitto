import { closeMailer, createMailer, type CreateMailerDeps } from "./factory.js";
import { GraphAdapter } from "./adapters/graph.js";
import { SmtpAdapter } from "./adapters/smtp.js";
import { sanitizeProviderErrorForLog } from "./errorMapping.js";

/** Result of a non-sending transport reachability probe (health live checks). */
export type MailProbeResult =
  | { ok: true; skipped?: boolean }
  | { ok: false; error: string };

function probeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const sanitized = sanitizeProviderErrorForLog(raw);
  // Keep operator-facing text short; never echo secrets from provider replies.
  return sanitized.slice(0, 200) || "Connection probe failed";
}

/**
 * Prove mail transport credentials/endpoint without sending a message.
 * SMTP: nodemailer verify. Graph: client-credentials token. Power Automate /
 * export_only: create succeeds but live verify is skipped (`skipped: true`).
 */
export async function probeMailTransport(
  config: unknown,
  deps: CreateMailerDeps = {},
): Promise<MailProbeResult> {
  let mailer;
  try {
    mailer = await createMailer(config, deps);
  } catch (err) {
    return { ok: false, error: probeErrorMessage(err) };
  }

  try {
    if (mailer.provider === "powerautomate" || mailer.provider === "export_only") {
      return { ok: true, skipped: true };
    }
    if (mailer instanceof SmtpAdapter) {
      await mailer.verifyConnection();
      return { ok: true };
    }
    if (mailer instanceof GraphAdapter) {
      await mailer.verifyConnection();
      return { ok: true };
    }
    return { ok: true, skipped: true };
  } catch (err) {
    return { ok: false, error: probeErrorMessage(err) };
  } finally {
    await closeMailer(mailer);
  }
}
