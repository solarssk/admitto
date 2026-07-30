export function printError(message: string): void {
  console.error(message);
}

export function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/** String(value ?? "") would print "[object Object]" for non-primitive cell values. */
function cellText(value: unknown): string {
  switch (typeof value) {
    case "undefined":
      return "";
    case "object":
      return value === null ? "" : JSON.stringify(value);
    case "string":
    case "number":
    case "boolean":
    case "bigint":
      return String(value);
    default:
      // "function" | "symbol" only (typeof's remaining cases) — not a realistic table cell
      // value (rows come from JSON-ish API/DB data); neither ever stringifies to "[object Object]".
      return String(value); // NOSONAR — exhaustively narrowed by the typeof switch above
  }
}

export function formatTable(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "(no rows)";
  const keys = Object.keys(rows[0]!);
  const widths = keys.map((k) =>
    Math.max(k.length, ...rows.map((r) => cellText(r[k]).length)),
  );
  const header = keys.map((k, i) => k.padEnd(widths[i]!)).join("  ");
  const lines = rows.map((row) =>
    keys.map((k, i) => cellText(row[k]).padEnd(widths[i]!)).join("  "),
  );
  return [header, ...lines].join("\n");
}
