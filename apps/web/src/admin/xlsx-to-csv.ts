import ExcelJS from "exceljs";

/** Cap rows materialized from XLSX/CSV to limit decompression-bomb memory use. */
export const MAX_IMPORT_ROWS = 50_000;

/** Max CSV text length after decode/conversion (post-decompression guard). */
export const MAX_CSV_CHARS = 10 * 1024 * 1024;

/**
 * Maximum number of ZIP entries allowed inside an XLSX archive.
 * A normal workbook has ~10–30 entries; a bomb uses thousands of entries or
 * massive shared-strings tables to inflate memory before any row is read.
 */
const MAX_XLSX_ZIP_ENTRIES = 1_000;

class ImportRowLimitError extends Error {
  constructor() {
    super("too many rows");
    this.name = "ImportRowLimitError";
  }
}

class ImportZipBombError extends Error {
  constructor() {
    super("xlsx zip entry limit exceeded");
    this.name = "ImportZipBombError";
  }
}

export { ImportRowLimitError, ImportZipBombError };

/** Count ZIP local-file-header signatures in the buffer without unpacking. */
function countZipEntries(buf: ArrayBuffer): number {
  const bytes = new Uint8Array(buf);
  let count = 0;
  // Local file header magic: PK\x03\x04
  for (let i = 0; i < bytes.length - 3; i++) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x03 && bytes[i + 3] === 0x04) {
      count++;
      i += 3;
    }
  }
  return count;
}

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
  if (countZipEntries(buf) > MAX_XLSX_ZIP_ENTRIES) {
    throw new ImportZipBombError();
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buf);
  const sheet = workbook.worksheets[0];
  if (!sheet) return "";

  const lines: string[] = [];
  let dataRows = 0;
  sheet.eachRow((row, rowNumber) => {
    // Row 1 is the header — only count data rows against the limit.
    if (rowNumber > 1) {
      dataRows++;
      if (dataRows > MAX_IMPORT_ROWS) {
        throw new ImportRowLimitError();
      }
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
