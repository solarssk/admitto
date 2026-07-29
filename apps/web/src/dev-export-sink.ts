/**
 * Development-only hooks for the `export_only` mail provider.
 *
 * Do not use these sinks in environments where stdout is collected or archived (CI log
 * retention, container platforms) — `recipientRef` is a truncated hash (pseudonym under
 * GDPR), not anonymous data.
 */
import { createHash } from "node:crypto";
import type { ExportPayload } from "@admitto/mailer";

/**
 * Truncated SHA-256 prefix for correlating dry-run lines in local dev only.
 * Pseudonymous — reversible for small known address sets; never log raw recipient/subject/html.
 */
function recipientLogRef(address: string): string {
  return createHash("sha256").update(address).digest("hex").slice(0, 8);
}

/**
 * PII-safe dry-run log when `NODE_ENV=development` and mail provider is `export_only`.
 * Logs byte lengths and `recipientRef` only — never full HTML, email, or subject text.
 */
export function devConsoleExportSink(payload: ExportPayload): void {
  const { message } = payload;
  const htmlBytes = Buffer.byteLength(message.html, "utf8");
  const subjectBytes = Buffer.byteLength(message.subject, "utf8");
  console.log(
    `[export_only dry-run] recipientRef=${recipientLogRef(message.to)} subjectBytes=${subjectBytes} htmlBytes=${htmlBytes}`,
  );
}

/**
 * Soft boot guard: log only (does not exit). Production with env-locked `export_only` still
 * starts; the first send fails in `createMailer` until a real provider is configured.
 */
export function warnExportOnlyProductionEnv(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "production") return;
  if (env.EMAIL_PROVIDER?.trim() !== "export_only") return;
  console.warn(
    "[admitto] EMAIL_PROVIDER=export_only cannot send in production (no exportSink); " +
      "configure smtp, graph, or powerautomate; sends will fail until changed",
  );
}
