export function printError(message: string): void {
  console.error(message);
}

export function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function formatTable(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "(no rows)";
  const keys = Object.keys(rows[0]!);
  const widths = keys.map((k) =>
    Math.max(k.length, ...rows.map((r) => (typeof r[k] === "string" ? r[k] : "").length)),
  );
  const header = keys.map((k, i) => k.padEnd(widths[i]!)).join("  ");
  const lines = rows.map((row) =>
    keys.map((k, i) => (typeof row[k] === "string" ? row[k] : "").padEnd(widths[i]!)).join("  "),
  );
  return [header, ...lines].join("\n");
}
