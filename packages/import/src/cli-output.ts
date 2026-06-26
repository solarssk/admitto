import { redactEmail } from "@admitto/auth";

export function formatSkippedImportRow(row: { email: string; reason: string }): string {
  return `  ${redactEmail(row.email)} — ${row.reason}`;
}
