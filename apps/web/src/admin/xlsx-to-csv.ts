import ExcelJS from "exceljs";

/** Cap rows materialized from XLSX/CSV to limit decompression-bomb memory use. */
export const MAX_IMPORT_ROWS = 50_000;

/** Max CSV text length after decode/conversion (post-decompression guard). */
export const MAX_CSV_CHARS = 10 * 1024 * 1024;

class ImportRowLimitError extends Error {
  constructor() {
    super("too many rows");
    this.name = "ImportRowLimitError";
  }
}

export { ImportRowLimitError };

/** Normalize an ExcelJS cell value to a plain string for CSV export. */
function cellToString(value: ExcelJS.CellValue | undefined): string {
  if (value == null || value === "") return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("");
    }
    if ("text" in value && value.text != null) return String(value.text);
    if ("result" in value && value.result != null) return String(value.result);
  }
  return String(value);
}

/** Quote and escape a CSV field when it contains special characters. */
function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Convert the first worksheet of an XLSX buffer to a CSV string (in memory). */
export async function xlsxBufferToCsv(buf: ArrayBuffer): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buf);
  const sheet = workbook.worksheets[0];
  if (!sheet) return "";

  const lines: string[] = [];
  sheet.eachRow((row) => {
    if (lines.length >= MAX_IMPORT_ROWS) {
      throw new ImportRowLimitError();
    }
    const values = row.values as ExcelJS.CellValue[];
    const cells = values.slice(1).map((v) => csvEscape(cellToString(v)));
    lines.push(cells.join(","));
  });
  return lines.join("\n");
}

/** Build a minimal XLSX buffer for tests (header + data rows). */
export async function buildXlsxBuffer(rows: string[][]): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  for (const row of rows) sheet.addRow(row);
  const written = await workbook.xlsx.writeBuffer();
  if (written instanceof ArrayBuffer) return written;
  const bytes = new Uint8Array(written);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
