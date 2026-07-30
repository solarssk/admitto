export function printError(message: string): void {
  console.error(message);
}

export function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function isStringifiablePrimitive(
  value: unknown,
): value is string | number | boolean | bigint {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  );
}

/** String(value ?? "") would print "[object Object]" for non-primitive cell values. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (isStringifiablePrimitive(value)) return String(value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
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
