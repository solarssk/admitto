import { parseAttendees } from "@admitto/import";
import { currentSystemLogCursor, querySystemLogs } from "@admitto/shared/system-log";
import ExcelJS from "exceljs";
import { EventEmitter } from "node:events";
import { deflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildXlsxBuffer,
  decodeXlsxToCsv,
  ImportRowLimitError,
  ImportZipBombError,
  MAX_CSV_CHARS,
  MAX_IMPORT_ROWS,
  runXlsxChild,
  startXlsxChild,
  xlsxBufferToCsv,
} from "../src/admin/xlsx-to-csv.js";

function writeUint32LE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function writeUint16LE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
}

/** Minimal ZIP with one central-directory entry declaring a huge uncompressed size. */
function buildZipBombBuffer(uncompressedSize: number): ArrayBuffer {
  const bytes = new Uint8Array(64);
  // Central directory file header at offset 0
  writeUint32LE(bytes, 0, 0x02014b50);
  writeUint32LE(bytes, 24, uncompressedSize);
  writeUint16LE(bytes, 28, 0); // name length
  writeUint16LE(bytes, 30, 0); // extra length
  writeUint16LE(bytes, 32, 0); // comment length
  // EOCD at offset 46
  writeUint32LE(bytes, 46, 0x06054b50);
  writeUint16LE(bytes, 54, 1); // entries on this disk
  writeUint16LE(bytes, 56, 1); // total entries
  writeUint32LE(bytes, 58, 46); // central directory size
  writeUint32LE(bytes, 60, 0); // central directory offset
  return bytes.buffer;
}

/**
 * Real single-entry ZIP (local header + deflated data + central directory) whose central
 * directory lies about the uncompressed size - the shape of a decompression bomb that passes a
 * guard trusting declared sizes.
 */
function buildForgedZipBomb(realUncompressedBytes: number, declaredSize: number, method = 8): ArrayBuffer {
  const raw = Buffer.alloc(realUncompressedBytes);
  const data = method === 8 ? deflateRawSync(raw) : raw;
  const name = Buffer.from("xl/worksheets/sheet1.xml");
  const local = Buffer.alloc(30);
  writeUint32LE(local, 0, 0x04034b50);
  writeUint16LE(local, 8, method);
  writeUint32LE(local, 18, data.length);
  writeUint32LE(local, 22, declaredSize);
  writeUint16LE(local, 26, name.length);
  const cd = Buffer.alloc(46);
  writeUint32LE(cd, 0, 0x02014b50);
  writeUint16LE(cd, 10, method);
  writeUint32LE(cd, 20, data.length);
  writeUint32LE(cd, 24, declaredSize);
  writeUint16LE(cd, 28, name.length);
  writeUint32LE(cd, 42, 0);
  const cdOffset = local.length + name.length + data.length;
  const eocd = Buffer.alloc(22);
  writeUint32LE(eocd, 0, 0x06054b50);
  writeUint16LE(eocd, 8, 1);
  writeUint16LE(eocd, 10, 1);
  writeUint32LE(eocd, 12, cd.length + name.length);
  writeUint32LE(eocd, 16, cdOffset);
  const out = Buffer.concat([local, name, data, cd, name, eocd]);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";

/** The parts of a minimal workbook, one worksheet for each `<sheetData>` body given. */
function workbookParts(sheetData: readonly string[]): Record<string, string> {
  const sheets = sheetData.map((_, i) => i + 1);
  const parts: Record<string, string> = {
    "[Content_Types].xml": `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`,
    "_rels/.rels": `${XML_HEADER}<Relationships xmlns="${PACKAGE_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `${XML_HEADER}<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><sheets>${sheets.map((n) => `<sheet name="Sheet${n}" sheetId="${n}" r:id="rId${n}"/>`).join("")}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `${XML_HEADER}<Relationships xmlns="${PACKAGE_REL_NS}">${sheets.map((n) => `<Relationship Id="rId${n}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${n}.xml"/>`).join("")}</Relationships>`,
  };
  for (const n of sheets) {
    parts[`xl/worksheets/sheet${n}.xml`] = `${XML_HEADER}<worksheet xmlns="${MAIN_NS}">${sheetData[n - 1]}</worksheet>`;
  }
  return parts;
}

/** A `<sheetData>` of `count` empty rows: the smallest worksheet that still has that many `<row>`s. */
function emptyRows(count: number): string {
  return `<sheetData>${Array.from({ length: count }, (_, i) => `<row r="${i + 1}"/>`).join("")}</sheetData>`;
}

/** A `<sheetData>` of `count` rows with one value each, in XFD, the last column a worksheet has. */
function lastColumnRows(count: number): string {
  const rows = Array.from(
    { length: count },
    (_, i) => `<row r="${i + 1}"><c r="XFD${i + 1}" t="inlineStr"><is><t>x</t></is></c></row>`,
  );
  return `<sheetData>${rows.join("")}</sheetData>`;
}

/**
 * Honest ZIP of the given entries, deflated (method 8) or stored (method 0); `declaredEntries` is
 * the count written to the end record.
 */
function buildZip(
  parts: Record<string, string>,
  { declaredEntries = Object.keys(parts).length, method = 8 } = {},
): ArrayBuffer {
  const body: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(parts)) {
    const nameBytes = Buffer.from(name);
    const data = method === 8 ? deflateRawSync(text) : Buffer.from(text);
    const local = Buffer.alloc(30);
    writeUint32LE(local, 0, 0x04034b50);
    writeUint16LE(local, 8, method);
    writeUint32LE(local, 18, data.length);
    writeUint32LE(local, 22, Buffer.byteLength(text));
    writeUint16LE(local, 26, nameBytes.length);
    const cd = Buffer.alloc(46);
    writeUint32LE(cd, 0, 0x02014b50);
    writeUint16LE(cd, 10, method);
    writeUint32LE(cd, 20, data.length);
    writeUint32LE(cd, 24, Buffer.byteLength(text));
    writeUint16LE(cd, 28, nameBytes.length);
    writeUint32LE(cd, 42, offset);
    body.push(local, nameBytes, data);
    directory.push(cd, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const directoryBytes = Buffer.concat(directory);
  const eocd = Buffer.alloc(22);
  writeUint32LE(eocd, 0, 0x06054b50);
  writeUint16LE(eocd, 8, declaredEntries);
  writeUint16LE(eocd, 10, declaredEntries);
  writeUint32LE(eocd, 12, directoryBytes.length);
  writeUint32LE(eocd, 16, offset);
  const out = Buffer.concat([...body, directoryBytes, eocd]);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

describe("decodeXlsxToCsv zip guards", () => {
  it("rejects a deflate bomb whose central directory declares a small uncompressed size", async () => {
    const buf = buildForgedZipBomb(25 * 1024 * 1024, 1000);
    await expect(decodeXlsxToCsv(buf)).rejects.toBeInstanceOf(ImportZipBombError);
  });

  it("rejects an entry that inflates past the total budget even when each declared size is small", async () => {
    // 21 MB is over the per-entry cap but still tiny once deflated.
    const buf = buildForgedZipBomb(21 * 1024 * 1024, 10);
    await expect(decodeXlsxToCsv(buf)).rejects.toBeInstanceOf(ImportZipBombError);
  });

  it("rejects an archive whose local file header is missing, out of range or points past the data", async () => {
    const patched = (mutate: (bytes: Uint8Array, cdOffset: number) => void): ArrayBuffer => {
      const bytes = new Uint8Array(buildForgedZipBomb(1024, 1024).slice(0));
      const cdOffset = readUint32(bytes, bytes.length - 22 + 16);
      mutate(bytes, cdOffset);
      return bytes.buffer;
    };
    const readUint32 = (bytes: Uint8Array, offset: number): number =>
      (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0;

    // Local header signature clobbered.
    await expect(decodeXlsxToCsv(patched((bytes) => writeUint32LE(bytes, 0, 0)))).rejects.toBeInstanceOf(
      ImportZipBombError,
    );
    // Local header offset beyond the end of the file.
    await expect(
      decodeXlsxToCsv(patched((bytes, cd) => writeUint32LE(bytes, cd + 42, 0xfffffff0))),
    ).rejects.toBeInstanceOf(ImportZipBombError);
    // Compressed size running past the end of the file.
    await expect(
      decodeXlsxToCsv(patched((bytes, cd) => writeUint32LE(bytes, cd + 20, 0x7fffffff))),
    ).rejects.toBeInstanceOf(ImportZipBombError);
  });

  it("rejects a corrupt deflate stream instead of handing it on", async () => {
    const bytes = new Uint8Array(buildForgedZipBomb(1024, 1024).slice(0));
    // Data starts after the 30-byte local header and the 24-byte entry name.
    bytes.fill(0xff, 54, 60);
    await expect(decodeXlsxToCsv(bytes.buffer)).rejects.toBeInstanceOf(ImportZipBombError);
  });

  it("rejects a stored entry larger than the cap and entries with an unsupported method", async () => {
    await expect(decodeXlsxToCsv(buildForgedZipBomb(21 * 1024 * 1024, 10, 0))).rejects.toBeInstanceOf(
      ImportZipBombError,
    );
    await expect(decodeXlsxToCsv(buildForgedZipBomb(16, 16, 12))).rejects.toBeInstanceOf(ImportZipBombError);
  });

  it("rejects archives with an oversized declared uncompressed entry", async () => {
    const buf = buildZipBombBuffer(25 * 1024 * 1024);
    await expect(decodeXlsxToCsv(buf)).rejects.toBeInstanceOf(ImportZipBombError);
  });

  it("quotes embedded double quotes and leaves ordinary cells unquoted", async () => {
    const buf = await buildXlsxBuffer([
      ["name", "note"],
      ["Ada", 'said "hello"'],
      ["Grace", "plain text"],
    ]);

    await expect(decodeXlsxToCsv(buf)).resolves.toBe(
      'name,note\nAda,"said ""hello"""\nGrace,plain text',
    );
  });

  it("exports cached formula values and Excel error results without object stringification", async () => {
    const buf = await buildXlsxBuffer([
      ["name", "calculation"],
      ["Ada", { formula: "1+1", result: 2 }],
      ["Grace", { formula: "1/0", result: { error: "#DIV/0!" as const } }],
    ]);

    await expect(decodeXlsxToCsv(buf)).resolves.toBe("name,calculation\nAda,2\nGrace,#DIV/0!");
  });

  it("preserves the other supported XLSX cell value shapes", async () => {
    const formulaDate = new Date("2026-09-17T12:00:00.000Z");
    const buf = await buildXlsxBuffer([
      ["rich text", "link", "error", "formula date", "boolean", "formula without result"],
      [
        { richText: [{ text: "Ada" }, { text: " Lovelace" }] },
        { text: "Admitto", hyperlink: "https://admitto.example.com" },
        { error: "#N/A" },
        { formula: "DATE(2026,9,17)", result: formulaDate },
        true,
        { formula: "1+1" },
      ],
    ]);

    await expect(decodeXlsxToCsv(buf)).resolves.toBe(
      "rich text,link,error,formula date,boolean,formula without result\nAda Lovelace,Admitto,#N/A,2026-09-17T12:00:00.000Z,true,",
    );
  });
});

describe("decodeXlsxToCsv row limit", () => {
  // ExcelJS builds an object for every <row> while it loads a workbook, so a workbook with too many
  // rows has to be refused before load() is called, not by the row check that runs afterwards.
  const xlsxPrototype: { load: (...args: unknown[]) => unknown } = Object.getPrototypeOf(new ExcelJS.Workbook().xlsx);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refuses a worksheet with far more rows than the import accepts, without loading the workbook", async () => {
    const load = vi.spyOn(xlsxPrototype, "load");
    const buf = buildZip(workbookParts([emptyRows(MAX_IMPORT_ROWS * 20)]));

    await expect(decodeXlsxToCsv(buf)).rejects.toBeInstanceOf(ImportRowLimitError);
    expect(load).not.toHaveBeenCalled();
  });

  it("counts the rows of every worksheet, not only the first", async () => {
    const load = vi.spyOn(xlsxPrototype, "load");
    const half = MAX_IMPORT_ROWS / 2;
    await expect(decodeXlsxToCsv(buildZip(workbookParts([emptyRows(half), emptyRows(half)])))).resolves.toBe("");

    const buf = buildZip(workbookParts([emptyRows(half + 1), emptyRows(half + 1)]));
    load.mockClear();
    await expect(decodeXlsxToCsv(buf)).rejects.toBeInstanceOf(ImportRowLimitError);
    expect(load).not.toHaveBeenCalled();
  });

  it("takes the header row plus MAX_IMPORT_ROWS data rows and refuses one row more", async () => {
    const atLimit = buildZip(workbookParts([emptyRows(MAX_IMPORT_ROWS + 1)]));
    const oneOver = buildZip(workbookParts([emptyRows(MAX_IMPORT_ROWS + 2)]));

    await expect(decodeXlsxToCsv(atLimit)).resolves.toBe("");
    await expect(decodeXlsxToCsv(oneOver)).rejects.toBeInstanceOf(ImportRowLimitError);
  });

  it.each([
    ["in this process", decodeXlsxToCsv],
    ["in a child process", xlsxBufferToCsv],
  ])("still imports a workbook with MAX_IMPORT_ROWS data rows of five columns, read %s", async (_where, read) => {
    const rows: string[][] = [["first_name", "last_name", "email", "company", "ticket_type"]];
    for (let i = 1; i <= MAX_IMPORT_ROWS; i++) {
      rows.push([`First${i}`, `Last${i}`, `person${i}@example.com`, `Acme ${i % 500} Ltd`, i % 3 ? "Standard" : "VIP"]);
    }

    const csv = await read(await buildXlsxBuffer(rows));

    const lines = csv.split("\n");
    expect(lines).toHaveLength(MAX_IMPORT_ROWS + 1);
    expect(lines[0]).toBe("first_name,last_name,email,company,ticket_type");
    expect(lines.at(-1)).toBe(`First${MAX_IMPORT_ROWS},Last${MAX_IMPORT_ROWS},person${MAX_IMPORT_ROWS}@example.com,Acme 0 Ltd,Standard`);
  }, 60_000);

  it("counts a row start tag whatever follows `<row`", async () => {
    const forms = ['<row r="N"/>', '<row r="N"></row>', '<row\tr="N"/>', '<row\r\nr="N"/>', "<row></row>", "<row/>"];
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 2 }, (_, i) => forms[i % forms.length]!.replace("N", String(i + 1)));
    const buf = buildZip(workbookParts([`<sheetData>${rows.join("")}</sheetData>`]));

    await expect(decodeXlsxToCsv(buf)).rejects.toBeInstanceOf(ImportRowLimitError);
  });

  it("does not take another element that only begins with `<row` for a row", async () => {
    const breaks = '<rowBreaks count="1" manualBreakCount="1"><brk id="1" max="16383" man="1"/></rowBreaks>';
    const buf = buildZip(workbookParts([`${emptyRows(MAX_IMPORT_ROWS + 1)}${breaks}`]));

    await expect(decodeXlsxToCsv(buf)).resolves.toBe("");
  });

  it("refuses an archive that lists more entries than its end record declares", async () => {
    const load = vi.spyOn(xlsxPrototype, "load");
    const parts = workbookParts([emptyRows(10), emptyRows(MAX_IMPORT_ROWS)]);

    // The same archive is over the row limit when it declares every entry...
    await expect(decodeXlsxToCsv(buildZip(parts))).rejects.toBeInstanceOf(ImportRowLimitError);
    // ...and must not slip past it by declaring one less: the last record is the second worksheet.
    await expect(
      decodeXlsxToCsv(buildZip(parts, { declaredEntries: Object.keys(parts).length - 1 })),
    ).rejects.toBeInstanceOf(ImportZipBombError);
    expect(load).not.toHaveBeenCalled();
  });

  it.each<[string, (eocd: Buffer) => void]>([
    ["a disk number", (eocd) => eocd.writeUInt16LE(1, 4)],
    ["a ZIP64 marker in the disk number", (eocd) => eocd.writeUInt16LE(0xffff, 4)],
    ["a disk that holds the directory", (eocd) => eocd.writeUInt16LE(1, 6)],
    ["an entry count for the disk that is not the total", (eocd) => eocd.writeUInt16LE(eocd.readUInt16LE(10) - 1, 8)],
    ["a directory size that stops short of the end record", (eocd) => eocd.writeUInt32LE(eocd.readUInt32LE(12) - 4, 12)],
    ["a directory size that runs past the end record", (eocd) => eocd.writeUInt32LE(eocd.readUInt32LE(12) + 4, 12)],
  ])("refuses an archive whose end record has %s", async (_label, patch) => {
    const archive = Buffer.from(buildZip(workbookParts([emptyRows(3)])));
    patch(archive.subarray(archive.length - 22));
    const patched = archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer;

    await expect(decodeXlsxToCsv(patched)).rejects.toBeInstanceOf(ImportZipBombError);
  });

  it("counts the rows of a stored (uncompressed) worksheet too", async () => {
    const load = vi.spyOn(xlsxPrototype, "load");
    const atLimit = buildZip(workbookParts([emptyRows(MAX_IMPORT_ROWS + 1)]), { method: 0 });
    const oneOver = buildZip(workbookParts([emptyRows(MAX_IMPORT_ROWS + 2)]), { method: 0 });

    await expect(decodeXlsxToCsv(atLimit)).resolves.toBe("");
    load.mockClear();
    await expect(decodeXlsxToCsv(oneOver)).rejects.toBeInstanceOf(ImportRowLimitError);
    expect(load).not.toHaveBeenCalled();
  });
});


// These workbooks hold a million cells or build ten million characters of text, and the CI runner
// is far slower than a laptop (with coverage and the other test files running in parallel), so the
// suites below get the same kind of generous explicit timeout as the 50,000-row test above.
const BIG_WORKBOOK_TIMEOUT_MS = 30_000;

describe("decodeXlsxToCsv cell limit", { timeout: BIG_WORKBOOK_TIMEOUT_MS }, () => {
  // ExcelJS builds an object for every <c> while it loads a workbook, so a workbook with too many
  // cells has to be refused before load() is called, as one with too many rows is.
  const xlsxPrototype: { load: (...args: unknown[]) => unknown } = Object.getPrototypeOf(new ExcelJS.Workbook().xlsx);
  const MAX_CELLS = (MAX_IMPORT_ROWS + 1) * 20;
  const rowOf = (cells: number): string => `<row>${"<c/>".repeat(cells)}</row>`;
  const sheetOfCells = (cells: number): string => `<sheetData>${rowOf(cells)}</sheetData>`;
  /** `rows` rows of 20 cells, the last one with `lastRowCells` instead. */
  const sheetOfRows = (rows: number, lastRowCells: number): string =>
    `<sheetData>${rowOf(20).repeat(rows - 1)}${rowOf(lastRowCells)}</sheetData>`;
  const textCell = (ref: string, text: string): string => `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refuses a worksheet with far more cells than the import accepts, without loading the workbook", async () => {
    const load = vi.spyOn(xlsxPrototype, "load");
    const buf = buildZip(workbookParts([`<sheetData>${rowOf(20_000).repeat(100)}</sheetData>`]));

    await expect(decodeXlsxToCsv(buf)).rejects.toBeInstanceOf(ImportRowLimitError);
    expect(load).not.toHaveBeenCalled();
  });

  it("counts the cells of every worksheet, not only the first", async () => {
    const load = vi.spyOn(xlsxPrototype, "load").mockResolvedValue(undefined);
    const half = MAX_CELLS / 2;
    await expect(decodeXlsxToCsv(buildZip(workbookParts([sheetOfCells(half), sheetOfCells(half)])))).resolves.toBe("");

    const buf = buildZip(workbookParts([sheetOfCells(half + 1), sheetOfCells(half + 1)]));
    load.mockClear();
    await expect(decodeXlsxToCsv(buf)).rejects.toBeInstanceOf(ImportRowLimitError);
    expect(load).not.toHaveBeenCalled();
  });

  it.each([
    ["deflated", 8],
    ["stored", 0],
  ])(
    "takes 20 cells for each of the header row and MAX_IMPORT_ROWS rows and refuses one cell more (%s)",
    async (_label, method) => {
      const load = vi.spyOn(xlsxPrototype, "load").mockResolvedValue(undefined);
      const atLimit = buildZip(workbookParts([sheetOfRows(MAX_IMPORT_ROWS + 1, 20)]), { method });
      const oneOver = buildZip(workbookParts([sheetOfRows(MAX_IMPORT_ROWS + 1, 21)]), { method });

      await expect(decodeXlsxToCsv(atLimit)).resolves.toBe("");
      expect(load).toHaveBeenCalledTimes(1);
      load.mockClear();
      await expect(decodeXlsxToCsv(oneOver)).rejects.toBeInstanceOf(ImportRowLimitError);
      expect(load).not.toHaveBeenCalled();
    },
  );

  it("still imports a workbook as wide as an event can use", async () => {
    // The 8 standard columns and the 20 custom fields an event can have.
    const header = [
      "email",
      "first_name",
      "last_name",
      "ticket_type",
      "company",
      "department",
      "external_uuid",
      "qr_payload",
      ...Array.from({ length: 20 }, (_, i) => `field_${i + 1}`),
    ];
    const rows = [header];
    for (let row = 1; row <= 100; row++) rows.push(header.map((name) => `${name} ${row}`));

    const lines = (await decodeXlsxToCsv(await buildXlsxBuffer(rows))).split("\n");

    expect(lines).toHaveLength(101);
    expect(lines[0]).toBe(header.join(","));
    expect(lines.at(-1)).toBe(header.map((name) => `${name} 100`).join(","));
  });

  it("counts a cell start tag whatever follows `<c`", async () => {
    const forms = [
      "<c/>",
      '<c r="A1"/>',
      '<c\tr="A1"/>',
      '<c\nr="A1"/>',
      '<c\r\nr="A1"/>',
      "<c></c>",
      '<c r="A1"><v>1</v></c>',
    ];
    const cells = Array.from({ length: MAX_CELLS + 1 }, (_, i) => forms[i % forms.length]!);
    const buf = buildZip(workbookParts([`<sheetData><row>${cells.join("")}</row></sheetData>`]));

    await expect(decodeXlsxToCsv(buf)).rejects.toBeInstanceOf(ImportRowLimitError);
  });

  it("does not take another element that only begins with `<c` for a cell", async () => {
    const load = vi.spyOn(xlsxPrototype, "load").mockResolvedValue(undefined);
    const others = ["<col/>", "<cols>", "<cfRule/>", "<c:v/>", "<cellXfs/>", "<cx/>"];
    const body = Array.from({ length: MAX_CELLS + 1 }, (_, i) => others[i % others.length]!).join("");

    await expect(decodeXlsxToCsv(buildZip(workbookParts([`<sheetData>${body}</sheetData>`])))).resolves.toBe("");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("counts the cells of an entry whatever its name", async () => {
    const load = vi.spyOn(xlsxPrototype, "load");
    const parts = { ...workbookParts([emptyRows(1)]), "docProps/custom.xml": sheetOfCells(MAX_CELLS + 1) };

    await expect(decodeXlsxToCsv(buildZip(parts))).rejects.toBeInstanceOf(ImportRowLimitError);
    expect(load).not.toHaveBeenCalled();
  });

  it("does not let ExcelJS read the rules and the column definitions of a worksheet", async () => {
    // A rule for a whole column makes ExcelJS build an object for each cell of that column.
    const load = vi.spyOn(xlsxPrototype, "load").mockResolvedValue(undefined);

    await decodeXlsxToCsv(buildZip(workbookParts([emptyRows(1)])));

    expect(load).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ignoreNodes: expect.arrayContaining(["cols", "dataValidations"]) }),
    );
  });

  it("still reads the values of a sheet with drop-down lists on whole columns", async () => {
    const lists = Array.from(
      "ABCDEF",
      (column) =>
        `<dataValidation type="list" sqref="${column}2:${column}1048576"><formula1>"yes,no"</formula1></dataValidation>`,
    ).join("");
    const sheet =
      '<cols><col min="1" max="16384" width="12" customWidth="1"/></cols>' +
      `<sheetData><row r="1">${textCell("A1", "email")}</row><row r="2">${textCell("A2", "ann@example.com")}</row></sheetData>` +
      `<dataValidations count="6">${lists}</dataValidations>`;

    await expect(decodeXlsxToCsv(buildZip(workbookParts([sheet])))).resolves.toBe("email\nann@example.com");
  });

  it("keeps the value of a merged cell on every row of the merge", async () => {
    const rows = [
      `<row r="1">${textCell("A1", "company")}${textCell("B1", "email")}</row>`,
      `<row r="2">${textCell("A2", "Acme Ltd")}${textCell("B2", "ann@example.com")}</row>`,
      `<row r="3">${textCell("B3", "bob@example.com")}</row>`,
      `<row r="4">${textCell("B4", "cid@example.com")}</row>`,
    ];
    const sheet = `<sheetData>${rows.join("")}</sheetData><mergeCells count="1"><mergeCell ref="A2:A4"/></mergeCells>`;

    await expect(decodeXlsxToCsv(buildZip(workbookParts([sheet])))).resolves.toBe(
      "company,email\nAcme Ltd,ann@example.com\nAcme Ltd,bob@example.com\nAcme Ltd,cid@example.com",
    );
  });
});

describe("decodeXlsxToCsv text limit", { timeout: BIG_WORKBOOK_TIMEOUT_MS }, () => {
  // The text is built in memory from the rows of the first sheet, so the limit on its length has to
  // apply while it is built, not after all of it exists. A text that many cells show keeps the
  // workbook small while the text made from it reaches the limit.
  const LAST_COLUMN_LINE_CHARS = 16_384; // 16,383 commas and the one value
  const KIB_64 = 64 * 1024;

  it("stops building text for rows that are mostly empty columns once it passes the limit", async () => {
    const rowsAtLimit = MAX_CSV_CHARS / LAST_COLUMN_LINE_CHARS;

    await expect(decodeXlsxToCsv(buildZip(workbookParts([lastColumnRows(3)])))).resolves.toHaveLength(
      3 * LAST_COLUMN_LINE_CHARS + 2,
    );
    await expect(decodeXlsxToCsv(buildZip(workbookParts([lastColumnRows(rowsAtLimit)])))).rejects.toBeInstanceOf(
      ImportRowLimitError,
    );
  });

  it("counts a large text once for every cell that shows it", async () => {
    const shared = "x".repeat(KIB_64);
    const cellsAtLimit = MAX_CSV_CHARS / shared.length;
    const sharedByCells = (cells: number) => buildXlsxBuffer([Array.from({ length: cells }, () => shared)]);

    await expect(decodeXlsxToCsv(await sharedByCells(cellsAtLimit - 1))).resolves.toHaveLength(
      (cellsAtLimit - 1) * shared.length + (cellsAtLimit - 2),
    );
    await expect(decodeXlsxToCsv(await sharedByCells(cellsAtLimit))).rejects.toBeInstanceOf(ImportRowLimitError);
  });

  it("takes text of exactly MAX_CSV_CHARS characters and refuses one character more", async () => {
    // A line of cells that all show one text, then a last line that makes the total exact: the
    // commas and the newline between the lines count too.
    const shared = "a".repeat(KIB_64 - 1);
    const sharedCells = 159;
    const lastLine = "b".repeat(MAX_CSV_CHARS - sharedCells * (shared.length + 1));
    const workbook = (last: string) => buildXlsxBuffer([Array.from({ length: sharedCells }, () => shared), [last]]);

    await expect(decodeXlsxToCsv(await workbook(lastLine))).resolves.toHaveLength(MAX_CSV_CHARS);
    await expect(decodeXlsxToCsv(await workbook(`${lastLine}b`))).rejects.toBeInstanceOf(ImportRowLimitError);
  });
});

it.each(["\n", "\r\n"])("round-trips XLSX multiline cells with %j through the import parser", async (newline) => {
  const company = `Synthetic, "Team"${newline}Headquarters`;
  const first = `Synthetic${newline}First`;
  const notes = `One${newline}Two`;
  const csv = await decodeXlsxToCsv(await buildXlsxBuffer([
    ["first_name", "last_name", "email", "company", "notes"],
    [first, "Person", "xlsx-multiline@example.com", company, notes],
  ]));
  const result = parseAttendees(csv, { attributeFields: [{ source_field: "notes", label: "Notes", type: "text" }] });
  expect(result.invalidRows).toEqual([]);
  // Existing ExcelJS decoding normalizes XLSX CRLF to LF before CSV parsing.
  const decoded = (value: string) => value.replaceAll("\r\n", "\n");
  expect(csv).toContain(`"${decoded(first)}"`);
  expect(result.validRows).toEqual([expect.objectContaining({ rowIndex: 1, first_name: decoded(first), company: decoded(company), custom_data: { notes: decoded(notes) } })]);
});

/** Column letters for 1 to 702, enough for the 40 columns of the fixture below. */
function columnName(n: number): string {
  const letter = (i: number): string => String.fromCharCode(65 + i);
  return n <= 26 ? letter(n - 1) : `${letter(Math.floor((n - 1) / 26) - 1)}${letter((n - 1) % 26)}`;
}

/**
 * A workbook that stays inside every limit above (about 25,000 rows, 999,960 cells, parts well under
 * the size limits) and still needs more memory to read than the process that reads it may use: a long
 * list of defined names and three worksheets of numbers.
 */
function memoryHungryWorkbook(): ArrayBuffer {
  const row = (r: number): string =>
    `<row r="${r}">${Array.from({ length: 40 }, (_, c) => `<c r="${columnName(c + 1)}${r}"><v>1</v></c>`).join("")}</row>`;
  const grid = `<sheetData>${Array.from({ length: 8_333 }, (_, r) => row(r + 1)).join("")}</sheetData>`;
  const names = Array.from(
    { length: 340_000 },
    (_, i) => `<definedName name="N${i}">Sheet1!$A$${i + 1}</definedName>`,
  ).join("");
  const parts = workbookParts([grid, grid, grid]);
  parts["xl/workbook.xml"] = parts["xl/workbook.xml"]!.replace(
    "</sheets>",
    `</sheets><definedNames>${names}</definedNames>`,
  );
  return buildZip(parts);
}

/** A workbook the limits above let through, whose worksheet is cut off in the middle of a row. */
function unreadableWorkbook(): ArrayBuffer {
  return buildZip({ ...workbookParts([emptyRows(1)]), "xl/worksheets/sheet1.xml": "<worksheet><sheetData><row" });
}

describe("xlsxBufferToCsv child process", { timeout: BIG_WORKBOOK_TIMEOUT_MS }, () => {
  // The workbook is read in a process of its own, so a workbook that needs more memory than that
  // process may use is refused without taking anything from the rest of the app.
  const xlsxPrototype: { load: (...args: unknown[]) => unknown } = Object.getPrototypeOf(new ExcelJS.Workbook().xlsx);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads the workbook in another process and returns the text reading it here would", async () => {
    const buf = await buildXlsxBuffer([
      ["name", "note"],
      ["Ada", 'said "hello"'],
      ["Grace", "plain text"],
    ]);
    const load = vi.spyOn(xlsxPrototype, "load");

    const csv = await xlsxBufferToCsv(buf);

    expect(load).not.toHaveBeenCalled();
    expect(buf.byteLength).toBeGreaterThan(0);
    expect(csv).toBe('name,note\nAda,"said ""hello"""\nGrace,plain text');
    expect(csv).toBe(await decodeXlsxToCsv(buf));
  });

  it("answers a workbook over the limits with the errors the import expects", async () => {
    await expect(xlsxBufferToCsv(buildZip(workbookParts([emptyRows(MAX_IMPORT_ROWS * 20)])))).rejects.toBeInstanceOf(
      ImportRowLimitError,
    );
    await expect(xlsxBufferToCsv(buildForgedZipBomb(25 * 1024 * 1024, 1000))).rejects.toBeInstanceOf(
      ImportZipBombError,
    );
  });

  it("answers a workbook that passes the limits but cannot be read with a plain error", async () => {
    const error: unknown = await xlsxBufferToCsv(unreadableWorkbook()).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ImportRowLimitError);
    expect(error).not.toBeInstanceOf(ImportZipBombError);
  });

  it("refuses a workbook that needs more memory than the process may use, and goes on reading others", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const cursor = currentSystemLogCursor();

    await expect(xlsxBufferToCsv(memoryHungryWorkbook())).rejects.toBeInstanceOf(ImportRowLimitError);

    // Only a process that ran out of memory is logged like this: a workbook over a limit is refused
    // by the process itself, so this one went through every limit first.
    expect(querySystemLogs({ sinceId: cursor }).map(({ message, fields }) => ({ message, fields }))).toEqual([
      { message: "xlsx_decode_stopped", fields: expect.objectContaining({ reason: "memory" }) },
    ]);
    await expect(xlsxBufferToCsv(await buildXlsxBuffer([["a"], ["b"]]))).resolves.toBe("a\nb");
  }, 120_000);

  it("keeps the memory limit of the process whatever heap-size flags this process was started with", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // A percentage of the host's memory takes precedence over the limit the process is given, and
    // would let it read the workbook below in full.
    const original = process.execArgv;
    process.execArgv = [
      ...original,
      "--max-old-space-size-percentage=50",
      "--max_old_space_size_percentage",
      "5e1",
      "-max-old-space-size=4096",
    ];
    try {
      await expect(xlsxBufferToCsv(memoryHungryWorkbook())).rejects.toBeInstanceOf(ImportRowLimitError);
    } finally {
      process.execArgv = original;
    }
  }, 120_000);
});

describe("runXlsxChild", { timeout: BIG_WORKBOOK_TIMEOUT_MS }, () => {
  const answersTo = async (data: unknown): Promise<unknown[]> => {
    const answers: unknown[] = [];
    await runXlsxChild((answer) => answers.push(answer), data);
    return answers;
  };

  it("answers with the text of the workbook it was sent", async () => {
    const workbook = await buildXlsxBuffer([
      ["a", "b"],
      ["1", "2"],
    ]);

    await expect(answersTo({ workbook })).resolves.toEqual([{ csv: "a,b\n1,2" }]);
  });

  it.each<[string, () => ArrayBuffer]>([
    ["rows", () => buildZip(workbookParts([emptyRows(MAX_IMPORT_ROWS * 20)]))],
    ["zip", () => buildForgedZipBomb(25 * 1024 * 1024, 1000)],
    ["invalid", unreadableWorkbook],
  ])("answers a refusal with its kind and nothing else: %s", async (refusal, build) => {
    await expect(answersTo({ workbook: build() })).resolves.toEqual([{ refusal }]);
  });

  it.each([[undefined], [null], ["workbook"], [{}], [{ workbook: "not a buffer" }], [{ workbook: new Uint8Array(4) }]])(
    "does nothing for data that is not a workbook: %j",
    async (data) => {
      await expect(answersTo(data)).resolves.toEqual([]);
    },
  );
});

describe("startXlsxChild", () => {
  /** The parts of a Node process the child's wiring uses, with the channel to the app faked. */
  function fakeProcess() {
    return Object.assign(new EventEmitter(), {
      send: vi.fn((_answer: unknown, done?: () => void) => {
        done?.();
        return true;
      }),
      exit: vi.fn(),
    });
  }

  it("answers the workbook it is sent, then ends", async () => {
    const proc = fakeProcess();
    startXlsxChild(proc as unknown as NodeJS.Process);

    proc.emit("message", { workbook: await buildXlsxBuffer([["a"], ["b"]]) });

    await vi.waitFor(() => expect(proc.exit).toHaveBeenCalledExactlyOnceWith(0));
    expect(proc.send).toHaveBeenCalledExactlyOnceWith({ csv: "a\nb" }, expect.any(Function));
  });

  it("ends when the app's side of the channel closes", () => {
    const proc = fakeProcess();
    startXlsxChild(proc as unknown as NodeJS.Process);

    proc.emit("disconnect");

    expect(proc.exit).toHaveBeenCalledExactlyOnceWith(0);
    expect(proc.send).not.toHaveBeenCalled();
  });

  it("stays quiet for a message that is not a workbook", async () => {
    const proc = fakeProcess();
    startXlsxChild(proc as unknown as NodeJS.Process);

    proc.emit("message", "hello");
    await Promise.resolve();

    expect(proc.send).not.toHaveBeenCalled();
    expect(proc.exit).not.toHaveBeenCalled();
  });
});
