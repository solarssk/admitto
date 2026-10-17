import { splitCsvLine } from "@admitto/shared";

/**
 * The separators spreadsheet programs save. Excel writes a semicolon when the list separator of the
 * system is not a comma (as in Poland), and a tab for "Unicode Text". The comma comes first because
 * it wins every tie.
 */
export const CSV_DELIMITERS = [",", ";", "\t"] as const;
export type CsvDelimiter = (typeof CSV_DELIMITERS)[number];

/** The columns every import file needs. The separator that gives the most of them in the header is the file's. */
const REQUIRED_COLUMNS = ["first_name", "last_name", "email"];

const BYTE_ORDER_MARK = 0xfeff;

/** The first line that is not blank, without its line break. A header cell with a line break in it is not expected. */
function firstNonBlankLine(csv: string): string {
  let start = csv.codePointAt(0) === BYTE_ORDER_MARK ? 1 : 0;
  while (start < csv.length) {
    const lineEnd = csv.indexOf("\n", start);
    const end = lineEnd === -1 ? csv.length : lineEnd;
    const line = csv.slice(start, end);
    if (line.trim()) return line;
    start = end + 1;
  }
  return "";
}

/** How many of the required columns the header gives when it is split on this separator. */
function requiredColumnsFound(header: string, delimiter: CsvDelimiter): number {
  const names = new Set(splitCsvLine(header, delimiter).map((cell) => cell.trim().toLowerCase()));
  return REQUIRED_COLUMNS.filter((column) => names.has(column)).length;
}

/**
 * The separator of a CSV text, read from its header only. The header is the first line that is not
 * blank, and the separator that splits it into the most required columns wins. When the header does
 * not settle it (no separator gives a required column, or two give the same number), the comma stays.
 */
export function detectCsvDelimiter(csv: string): CsvDelimiter {
  const header = firstNonBlankLine(csv);
  let best: CsvDelimiter = ",";
  let bestScore = -1;
  for (const delimiter of CSV_DELIMITERS) {
    const score = requiredColumnsFound(header, delimiter);
    if (score > bestScore) {
      best = delimiter;
      bestScore = score;
    }
  }
  return best;
}
