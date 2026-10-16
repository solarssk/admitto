// A child process loads this file as it is on disk to read a workbook (see xlsxBufferToCsv), so it
// imports no sibling module: from a TypeScript source (tests, `tsx`) a "./x.js" specifier only
// resolves under the compiler.
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import { emitSystemLog } from "@admitto/shared/system-log";
import ExcelJS from "exceljs";

/** Cap rows materialized from XLSX/CSV to limit decompression-bomb memory use. */
export const MAX_IMPORT_ROWS = 50_000;

/**
 * Max CSV text length after decode/conversion (post-decompression guard). decodeXlsxToCsv stops
 * building the text as soon as it passes this, not after all of it exists.
 */
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
 * decodeXlsxToCsv only applies after that memory is spent.
 */
const MAX_XLSX_ROW_ELEMENTS = MAX_IMPORT_ROWS + 1;

/**
 * Most `<c>` (cell) elements a workbook may hold, counted over every worksheet: an average of 20
 * for each of the rows allowed. ExcelJS builds an object for every cell it reads, empty ones that
 * only carry a format included, so a few rows can cost as much memory as many. The size limits
 * above already keep one worksheet of filled cells below this, so in practice it stops workbooks
 * made of empty cells.
 */
const MAX_XLSX_CELLS_PER_ROW = 20;
const MAX_XLSX_CELL_ELEMENTS = MAX_XLSX_ROW_ELEMENTS * MAX_XLSX_CELLS_PER_ROW;

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

/** Too many workbooks are already waiting to be read: try again shortly. */
class ImportBusyError extends Error {
  constructor() {
    super("xlsx import busy");
    this.name = "ImportBusyError";
  }
}

export { ImportBusyError, ImportRowLimitError, ImportZipBombError };

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
 * uncompressed sizes and the number of rows and cells before ExcelJS inflates and parses the
 * archive.
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
  const totals: ElementTotals = { rows: 0, cells: 0 };

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
    // is for ExcelJS to decide, and the rows and cells of all of them cost memory, not just the
    // first sheet's.
    countElements(entry, totals);

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

const LESS_THAN = 0x3c;
const LETTER_C = 0x63;
const LETTER_R = 0x72;
const LETTER_O = 0x6f;
const LETTER_W = 0x77;

/** True for the byte after the name in a start tag: XML whitespace, `>` or `/`. */
function endsElementName(byte: number | undefined): boolean {
  return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d || byte === 0x3e || byte === 0x2f;
}

/** True when the `<` at `at` starts a `<row>` tag. A longer name (`<rowBreaks`) is another one. */
function startsRow(xml: Buffer, at: number): boolean {
  return xml[at + 1] === LETTER_R && xml[at + 2] === LETTER_O && xml[at + 3] === LETTER_W && endsElementName(xml[at + 4]);
}

/**
 * True when the `<` at `at` starts a `<c>` tag. Longer names (`<col`, `<cfRule`) and prefixed ones
 * (`<c:v`) are other elements.
 */
function startsCell(xml: Buffer, at: number): boolean {
  return xml[at + 1] === LETTER_C && endsElementName(xml[at + 2]);
}

/** The `<row>` and `<c>` start tags found so far in the inflated entries of an archive. */
interface ElementTotals {
  rows: number;
  cells: number;
}

/**
 * Adds the `<row>` and `<c>` start tags of an inflated entry to `totals` and throws
 * ImportRowLimitError once either total is over its limit, counting no further then. It is one pass
 * over the bytes, so the work does not depend on what the entry holds. Rows and cells are counted
 * whether or not they hold values or an address: ExcelJS builds an object for each of them.
 */
function countElements(xml: Buffer, totals: ElementTotals): void {
  let { rows, cells } = totals;
  for (let at = 0; at < xml.length && rows <= MAX_XLSX_ROW_ELEMENTS && cells <= MAX_XLSX_CELL_ELEMENTS; at++) {
    if (xml[at] !== LESS_THAN) continue;
    if (startsCell(xml, at)) cells++;
    else if (startsRow(xml, at)) rows++;
  }
  totals.rows = rows;
  totals.cells = cells;
  if (rows > MAX_XLSX_ROW_ELEMENTS || cells > MAX_XLSX_CELL_ELEMENTS) throw new ImportRowLimitError();
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

/**
 * Worksheet parts the import does not read: the rules for what may be typed into cells and the
 * width and format of columns. They hold no attendee data, and ExcelJS builds an object for every
 * cell or column they name, which a rule for a whole column makes very expensive.
 * Merged ranges are not on this list: they decide which value each cell of a merge shows.
 */
const UNREAD_WORKSHEET_NODES = ["cols", "dataValidations"];

/**
 * Convert the first worksheet of an XLSX buffer to a CSV string (in memory), in the calling process.
 * The import calls xlsxBufferToCsv, which runs this in a child process.
 */
export async function decodeXlsxToCsv(buf: ArrayBuffer): Promise<string> {
  assertZipWithinUncompressedLimits(buf);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buf, { ignoreNodes: UNREAD_WORKSHEET_NODES });
  const sheet = workbook.worksheets[0];
  if (!sheet) return "";

  const lines: string[] = [];
  let dataRows = 0;
  // Length the joined text has so far: no newline comes before the first line.
  let chars = -1;
  const addChars = (count: number): void => {
    chars += count;
    if (chars > MAX_CSV_CHARS) throw new ImportRowLimitError();
  };
  sheet.eachRow((row, rowNumber) => {
    // Row 1 is the header — only count data rows against the limit.
    if (rowNumber > 1) {
      dataRows++;
      if (dataRows > MAX_IMPORT_ROWS) {
        throw new ImportRowLimitError();
      }
    }
    const values = row.values as ExcelJS.CellValue[];
    // The text is counted cell by cell, so a row over the limit is refused while it is built and
    // not after all of it exists. A row with empty columns adds their separators too.
    const cells = values.slice(1).map((v) => {
      const cell = csvEscape(cellToString(v));
      addChars(cell.length);
      return cell;
    });
    addChars(cells.length); // the commas between the cells and the newline after the line
    lines.push(cells.join(","));
  });
  return lines.join("\n");
}

/**
 * Node flags of the process that reads a workbook. The old generation limit is the heap it may use
 * (the buffers it unpacks are outside the heap, and the size limits above bound those): the largest
 * workbook the size limits let through needs about two thirds of it, and a workbook that needs more
 * ends the process instead of taking memory from the rest of the app. The young generation is capped
 * as well, which keeps the resident memory down and costs no time.
 *
 * These are the only node flags the process gets: none of the flags of the app is handed on. Node runs
 * this file as it is, so no loader such as tsx is needed; an `--env-file` flag would fill the empty
 * environment with the app's secrets again; and a flag that sizes the heap could replace the limits
 * above (`--max-old-space-size-percentage` takes precedence over them wherever it stands).
 */
const XLSX_CHILD_FLAGS = ["--max-old-space-size=384", "--max-semi-space-size=8"];

/**
 * Longest a workbook may take to read, counted from the start of its process. Memory is the limit
 * that matters; this only ends a process that never finishes, so it is far above what reading takes
 * on slow hardware.
 */
const XLSX_CHILD_TIMEOUT_MS = 60_000;

/**
 * Most workbooks the import holds at once, the one being read included. Each one that waits keeps
 * its upload in memory until its turn, and a slow workbook holds up every one behind it, so a
 * request over this is turned away at once instead of queued.
 */
const XLSX_MAX_PENDING = 4;

type Refusal = "rows" | "zip" | "invalid";

/** What the child process answers with: the CSV text, or the kind of refusal (an error message could hold text from the file). */
type ChildAnswer = { csv: string } | { refusal: Refusal };

function refusalOf(err: unknown): Refusal {
  if (err instanceof ImportRowLimitError) return "rows";
  if (err instanceof ImportZipBombError) return "zip";
  return "invalid";
}

function errorForRefusal(refusal: Refusal): Error {
  if (refusal === "rows") return new ImportRowLimitError();
  if (refusal === "zip") return new ImportZipBombError();
  return new Error("invalid xlsx workbook");
}

function isWorkbookTask(data: unknown): data is { workbook: ArrayBuffer } {
  return typeof data === "object" && data !== null && "workbook" in data && data.workbook instanceof ArrayBuffer;
}

/**
 * The child process's side: reads the workbook it was sent and reports the CSV text, or why it
 * refused. Does nothing for data that is not a workbook.
 */
export async function runXlsxChild(reply: (answer: ChildAnswer) => void, data: unknown): Promise<void> {
  if (!isWorkbookTask(data)) return;
  try {
    reply({ csv: await decodeXlsxToCsv(data.workbook) });
  } catch (err) {
    reply({ refusal: refusalOf(err) });
  }
}

/**
 * The child process's wiring: waits for the one workbook it is sent, answers and ends, and ends when
 * the app's side of the channel closes.
 */
export function startXlsxChild(proc: Pick<NodeJS.Process, "once" | "send" | "exit">): void {
  proc.once("message", (data: unknown) => {
    void runXlsxChild((answer) => proc.send?.(answer, () => proc.exit(0)), data);
  });
  proc.once("disconnect", () => proc.exit(0));
}

/** V8 ends its process with SIGABRT when the heap is full, and the system's memory killer uses SIGKILL. */
function stopReason(signal: NodeJS.Signals): "memory" | "crash" {
  return signal === "SIGABRT" || signal === "SIGKILL" ? "memory" : "crash";
}

function logDecodeStopped(reason: "memory" | "crash" | "time", signal?: NodeJS.Signals): void {
  emitSystemLog("api", "warn", "xlsx_decode_stopped", signal ? { reason, signal } : { reason });
}

function logDecodeFailed(cause: string): void {
  emitSystemLog("api", "error", "xlsx_decode_failed", { cause });
}

/**
 * Reads the workbook in a new process, and ends that process once it has answered, died or run out
 * of time. A process that dies (usually of the heap limit, which ends it with a signal) or runs out
 * of time is refused as ImportRowLimitError, the same answer as a workbook with too many rows. The
 * process gets an empty environment, since it needs none of the app's secrets, and nothing it prints
 * is kept.
 */
function decodeInChild(workbook: ArrayBuffer): Promise<string> {
  const child = fork(fileURLToPath(import.meta.url), [], {
    execArgv: XLSX_CHILD_FLAGS,
    serialization: "advanced",
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    env: {},
  });
  const result = new Promise<string>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      finish(() => {
        logDecodeStopped("time");
        reject(new ImportRowLimitError());
      });
    }, XLSX_CHILD_TIMEOUT_MS);

    // The first thing that happens decides. The listeners stay on, so that nothing the process does
    // afterwards (an exit, an error of its own) is left without one.
    function finish(settle: () => void): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      settle();
    }

    child.on("message", (answer: ChildAnswer) => {
      finish(() => ("csv" in answer ? resolve(answer.csv) : reject(errorForRefusal(answer.refusal))));
    });
    child.on("error", (err: NodeJS.ErrnoException) => {
      finish(() => {
        logDecodeFailed(err.code ?? err.name);
        reject(err);
      });
    });
    // "close", not "exit": it comes after the channel is closed too, so an answer that is still on its
    // way when the process is gone is handled first (the child ends as soon as it has sent it).
    child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      finish(() => {
        if (signal) {
          logDecodeStopped(stopReason(signal), signal);
          reject(new ImportRowLimitError());
        } else {
          logDecodeFailed(`exit ${code}`);
          reject(new Error("xlsx child process ended without an answer"));
        }
      });
    });
    child.send({ workbook });
  });
  return result.finally(() => {
    child.kill("SIGKILL");
  });
}

let lastDecode: Promise<unknown> = Promise.resolve();
let pendingDecodes = 0;

/**
 * Convert the first worksheet of an XLSX buffer to a CSV string, in a child process with its own
 * memory and time limits: a workbook that needs more than they allow is refused with
 * ImportRowLimitError, whatever the reader does with it, and reading it does not hold up the rest of
 * the app. Workbooks are read one at a time, so the memory they can take together stays at one
 * process's limit, and no more than XLSX_MAX_PENDING are held at once: one more is refused with
 * ImportBusyError. The process is not a sandbox; it bounds what a workbook can use.
 */
export function xlsxBufferToCsv(buf: ArrayBuffer): Promise<string> {
  if (pendingDecodes >= XLSX_MAX_PENDING) return Promise.reject(new ImportBusyError());
  pendingDecodes++;
  const result = lastDecode.then(() => decodeInChild(buf));
  lastDecode = result.catch(() => undefined);
  return result.finally(() => {
    pendingDecodes--;
  });
}

// True only in the child process: fork starts it with this file as its entry point.
/* v8 ignore next */
if (import.meta.main) startXlsxChild(process);

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
