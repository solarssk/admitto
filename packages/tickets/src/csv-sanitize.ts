/** Guard against CSV/formula injection when exported files are opened in spreadsheets. */
export function sanitizeCsvCell(value: string | null | undefined): string {
  if (value == null) return "";
  const s = String(value);
  if (/^[\t\r\n]/.test(s) || /^[ \t\r\n]*[=+\-@]/.test(s)) return `'${s}`;
  return s;
}

/** RFC 4180 CSV field quoting (escape embedded double quotes). */
export function quoteCsvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
