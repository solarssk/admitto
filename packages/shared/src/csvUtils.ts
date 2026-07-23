/**
 * Parses a double-quoted CSV field, starting right after its opening quote.
 * Returns the unescaped field value and the index just past the closing quote
 * (or the end of the line, if the quote is never closed).
 */
function parseQuotedField(line: string, start: number): { field: string; next: number } {
  let field = "";
  let i = start;
  while (i < line.length) {
    if (line[i] === '"' && line[i + 1] === '"') { field += '"'; i += 2; }
    else if (line[i] === '"') { i++; break; }
    else { field += line[i++]; }
  }
  return { field, next: i };
}

/** RFC 4180-compatible CSV field splitter — handles double-quoted fields with embedded commas. */
export function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  while (i <= line.length) {
    if (line[i] === '"') {
      const { field, next } = parseQuotedField(line, i + 1); // i + 1 skips opening quote
      fields.push(field);
      i = next;
      if (line[i] === ",") i++; // skip comma after closing quote
      else break; // end-of-line after quoted field — no phantom empty field
    } else {
      const end = line.indexOf(",", i);
      if (end === -1) { fields.push(line.slice(i)); break; }
      fields.push(line.slice(i, end));
      i = end + 1;
    }
  }
  return fields;
}
