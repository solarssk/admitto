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

/** Reject archives whose declared uncompressed payload exceeds this total. */
const MAX_XLSX_UNCOMPRESSED_TOTAL = 50 * 1024 * 1024;

/** Reject a single ZIP entry whose declared uncompressed size exceeds this. */
const MAX_XLSX_UNCOMPRESSED_ENTRY = 20 * 1024 * 1024;

const EOCD_SIGNATURE = 0x06054b50;
const CD_SIGNATURE = 0x02014b50;

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

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! << 24)
  ) >>> 0;
}

/** Locate the end-of-central-directory record (PK\\x05\\x06) near the archive tail. */
function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const minEocd = 22;
  const maxComment = 65535;
  const start = Math.max(0, bytes.length - minEocd - maxComment);
  for (let i = bytes.length - minEocd; i >= start; i--) {
    if (readUint32LE(bytes, i) === EOCD_SIGNATURE) return i;
  }
  return -1;
}

/**
 * Scan the ZIP central directory and enforce entry count plus declared uncompressed
 * sizes before ExcelJS inflates the archive.
 */
function assertZipWithinUncompressedLimits(buf: ArrayBuffer): void {
  const bytes = new Uint8Array(buf);
  const eocd = findEndOfCentralDirectory(bytes);
  if (eocd < 0) throw new ImportZipBombError();

  const entryCount = readUint16LE(bytes, eocd + 10);
  if (entryCount > MAX_XLSX_ZIP_ENTRIES) throw new ImportZipBombError();

  const cdOffset = readUint32LE(bytes, eocd + 16);
  let pos = cdOffset;
  let totalUncompressed = 0;

  for (let n = 0; n < entryCount; n++) {
    if (pos + 46 > bytes.length) throw new ImportZipBombError();
    if (readUint32LE(bytes, pos) !== CD_SIGNATURE) throw new ImportZipBombError();

    const uncompressed = readUint32LE(bytes, pos + 24);
    const nameLen = readUint16LE(bytes, pos + 28);
    const extraLen = readUint16LE(bytes, pos + 30);
    const commentLen = readUint16LE(bytes, pos + 32);

    if (uncompressed > MAX_XLSX_UNCOMPRESSED_ENTRY) throw new ImportZipBombError();

    totalUncompressed += uncompressed;
    if (totalUncompressed > MAX_XLSX_UNCOMPRESSED_TOTAL) throw new ImportZipBombError();

    pos += 46 + nameLen + extraLen + commentLen;
  }
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
  if (/[",\r\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

/** Convert the first worksheet of an XLSX buffer to a CSV string (in memory). */
export async function xlsxBufferToCsv(buf: ArrayBuffer): Promise<string> {
  assertZipWithinUncompressedLimits(buf);

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
