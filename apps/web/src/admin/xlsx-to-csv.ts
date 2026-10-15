import { inflateRawSync } from "node:zlib";
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

/**
 * Most `<row>` elements a workbook may hold, counted over every worksheet: the header row plus
 * MAX_IMPORT_ROWS data rows, the same bound csvWithinLimits puts on a CSV. ExcelJS builds an
 * object for each one while it loads the workbook, blank rows included, so the row limit inside
 * xlsxBufferToCsv only applies after that memory is spent.
 */
const MAX_XLSX_ROW_ELEMENTS = MAX_IMPORT_ROWS + 1;

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
 * Reject an end record that does not describe the directory the way a ZIP reader will find it: one
 * disk, the declared entry count held on it, and a directory that ends where this record begins.
 * ExcelJS's reader moves its offsets when the declared size stops short of this record and switches
 * to ZIP64 on a sentinel in any of these fields, so it could open another directory than this scan.
 */
function assertPlainEndRecord(bytes: Uint8Array, eocd: number): void {
  const diskNumber = readUint16LE(bytes, eocd + 4);
  const directoryDisk = readUint16LE(bytes, eocd + 6);
  const entriesOnDisk = readUint16LE(bytes, eocd + 8);
  const entryCount = readUint16LE(bytes, eocd + 10);
  const directorySize = readUint32LE(bytes, eocd + 12);
  const directoryOffset = readUint32LE(bytes, eocd + 16);
  if (diskNumber !== 0 || directoryDisk !== 0 || entriesOnDisk !== entryCount || directoryOffset + directorySize !== eocd) {
    throw new ImportZipBombError();
  }
}

/**
 * Scan the ZIP central directory and enforce entry count, the real (measured, not declared)
 * uncompressed sizes and the number of rows before ExcelJS inflates and parses the archive.
 */
function assertZipWithinUncompressedLimits(buf: ArrayBuffer): void {
  const bytes = new Uint8Array(buf);
  const eocd = findEndOfCentralDirectory(bytes);
  if (eocd < 0) throw new ImportZipBombError();
  assertPlainEndRecord(bytes, eocd);

  const entryCount = readUint16LE(bytes, eocd + 10);
  if (entryCount > MAX_XLSX_ZIP_ENTRIES) throw new ImportZipBombError();

  const cdOffset = readUint32LE(bytes, eocd + 16);
  let pos = cdOffset;
  let totalUncompressed = 0;
  let totalRows = 0;

  for (let n = 0; n < entryCount; n++) {
    if (pos + 46 > bytes.length) throw new ImportZipBombError();
    if (readUint32LE(bytes, pos) !== CD_SIGNATURE) throw new ImportZipBombError();

    const uncompressed = readUint32LE(bytes, pos + 24);
    const nameLen = readUint16LE(bytes, pos + 28);
    const extraLen = readUint16LE(bytes, pos + 30);
    const commentLen = readUint16LE(bytes, pos + 32);

    if (uncompressed > MAX_XLSX_UNCOMPRESSED_ENTRY) throw new ImportZipBombError();

    // The declared size is attacker-controlled, so it only serves as a cheap early reject. What
    // the entry really inflates to is measured below, against the same limits.
    const entry = inflateEntry(bytes, pos, MAX_XLSX_UNCOMPRESSED_TOTAL - totalUncompressed);
    totalUncompressed += entry.length;
    if (totalUncompressed > MAX_XLSX_UNCOMPRESSED_TOTAL) throw new ImportZipBombError();

    // Counted on the inflated bytes of every entry, whatever its name: which parts are worksheets
    // is for ExcelJS to decide, and the rows of all of them cost memory, not just the first sheet's.
    totalRows += countRowElements(entry, MAX_XLSX_ROW_ELEMENTS - totalRows);
    if (totalRows > MAX_XLSX_ROW_ELEMENTS) throw new ImportRowLimitError();

    pos += 46 + nameLen + extraLen + commentLen;
  }

  // A ZIP reader walks the central directory until its records stop, not up to the declared count,
  // so a record past the declared ones would be opened by ExcelJS without ever being measured here.
  if (pos !== eocd) throw new ImportZipBombError();
}

const ZIP_METHOD_STORED = 0;
const ZIP_METHOD_DEFLATE = 8;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;

/**
 * Real uncompressed bytes of the entry whose central-directory header starts at `cdPos`, found by
 * inflating its data with a hard output cap (never allocates more than the cap, whatever the
 * entry claims). Throws ImportZipBombError on any malformed header or when the cap is exceeded.
 */
function inflateEntry(bytes: Uint8Array, cdPos: number, remainingTotalBudget: number): Buffer {
  const method = readUint16LE(bytes, cdPos + 10);
  const compressedSize = readUint32LE(bytes, cdPos + 20);
  const localHeaderOffset = readUint32LE(bytes, cdPos + 42);

  if (localHeaderOffset + 30 > bytes.length) throw new ImportZipBombError();
  if (readUint32LE(bytes, localHeaderOffset) !== LOCAL_FILE_HEADER_SIGNATURE) throw new ImportZipBombError();
  const dataStart =
    localHeaderOffset + 30 + readUint16LE(bytes, localHeaderOffset + 26) + readUint16LE(bytes, localHeaderOffset + 28);
  if (dataStart + compressedSize > bytes.length) throw new ImportZipBombError();

  const cap = Math.min(MAX_XLSX_UNCOMPRESSED_ENTRY, remainingTotalBudget);
  if (method === ZIP_METHOD_STORED) {
    if (compressedSize > cap) throw new ImportZipBombError();
    return Buffer.from(bytes.buffer, bytes.byteOffset + dataStart, compressedSize);
  }
  if (method !== ZIP_METHOD_DEFLATE) throw new ImportZipBombError();
  try {
    return inflateRawSync(bytes.subarray(dataStart, dataStart + compressedSize), { maxOutputLength: cap });
  } catch {
    // Output over the cap (ERR_BUFFER_TOO_LARGE) or a corrupt stream - neither is a workbook to open.
    throw new ImportZipBombError();
  }
}

const ROW_TAG = "<row";

/** True for the byte after `<row` in a row start tag: XML whitespace, `>` or `/`. */
function endsRowName(byte: number | undefined): boolean {
  return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d || byte === 0x3e || byte === 0x2f;
}

/**
 * Number of `<row>` start tags in an inflated entry, counted only until it passes `limit`. A tag
 * whose name goes on after `<row` (`<rowBreaks`) is another element. Rows are counted whether or not
 * they hold cells or a row number: ExcelJS builds an object for each of them.
 */
function countRowElements(xml: Buffer, limit: number): number {
  let count = 0;
  let at = xml.indexOf(ROW_TAG);
  while (at >= 0 && count <= limit) {
    if (endsRowName(xml[at + ROW_TAG.length])) count++;
    at = xml.indexOf(ROW_TAG, at + ROW_TAG.length);
  }
  return count;
}

function formulaResultToString(result: NonNullable<ExcelJS.CellFormulaValue["result"]>): string {
  if (result instanceof Date) return result.toISOString();
  if (typeof result === "object") return result.error;
  return String(result);
}

/** Normalize an ExcelJS cell value to a plain string for CSV export. */
function cellToString(value: ExcelJS.CellValue | undefined): string {
  if (value == null || value === "") return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("");
    }
    if ("text" in value && value.text != null) return value.text;
    if ("result" in value && value.result != null) return formulaResultToString(value.result);
    if ("error" in value) return value.error;
  }
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : "";
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
export async function buildXlsxBuffer(
  rows: readonly (readonly ExcelJS.CellValue[])[],
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  for (const row of rows) sheet.addRow([...row]);
  const written = await workbook.xlsx.writeBuffer();
  if (written instanceof ArrayBuffer) return written;
  const bytes = new Uint8Array(written);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
