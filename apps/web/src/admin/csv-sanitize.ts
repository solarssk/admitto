/** Guard against CSV/formula injection when exported files are opened in spreadsheets. */
export function sanitizeCsvCell(value: string | null | undefined): string {
  if (value == null) return "";
  const s = String(value);
  if (/^[\t\r\n]/.test(s) || /^[ \t\r\n]*[=+\-@]/.test(s)) return `'${s}`;
  return s;
}
