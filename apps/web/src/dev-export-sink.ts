import type { ExportPayload } from "@admitto/mailer";

/** PII-safe dry-run log for local development when mail provider is export_only. */
export function devConsoleExportSink(payload: ExportPayload): void {
  const { message } = payload;
  const htmlBytes = Buffer.byteLength(message.html, "utf8");
  console.log(
    `[export_only dry-run] to=${message.to} subject=${message.subject} htmlBytes=${htmlBytes}`,
  );
}

/** Warn when production boot uses export_only via env lock (cannot send without a sink). */
export function warnExportOnlyProductionEnv(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "production") return;
  if (env.EMAIL_PROVIDER?.trim() !== "export_only") return;
  console.warn(
    "[admitto] EMAIL_PROVIDER=export_only cannot send in production; configure smtp, graph, or powerautomate",
  );
}
