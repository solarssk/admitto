import { parseAttendees } from "@admitto/import";
import ExcelJS from "exceljs";
import { deflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildXlsxBuffer,
  ImportRowLimitError,
  ImportZipBombError,
  MAX_IMPORT_ROWS,
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

describe("xlsxBufferToCsv zip guards", () => {
  it("rejects a deflate bomb whose central directory declares a small uncompressed size", async () => {
    const buf = buildForgedZipBomb(25 * 1024 * 1024, 1000);
    await expect(xlsxBufferToCsv(buf)).rejects.toBeInstanceOf(ImportZipBombError);
  });

  it("rejects an entry that inflates past the total budget even when each declared size is small", async () => {
    // 21 MB is over the per-entry cap but still tiny once deflated.
    const buf = buildForgedZipBomb(21 * 1024 * 1024, 10);
    await expect(xlsxBufferToCsv(buf)).rejects.toBeInstanceOf(ImportZipBombError);
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
    await expect(xlsxBufferToCsv(patched((bytes) => writeUint32LE(bytes, 0, 0)))).rejects.toBeInstanceOf(
      ImportZipBombError,
    );
    // Local header offset beyond the end of the file.
    await expect(
      xlsxBufferToCsv(patched((bytes, cd) => writeUint32LE(bytes, cd + 42, 0xfffffff0))),
    ).rejects.toBeInstanceOf(ImportZipBombError);
    // Compressed size running past the end of the file.
    await expect(
      xlsxBufferToCsv(patched((bytes, cd) => writeUint32LE(bytes, cd + 20, 0x7fffffff))),
    ).rejects.toBeInstanceOf(ImportZipBombError);
  });

  it("rejects a corrupt deflate stream instead of handing it on", async () => {
    const bytes = new Uint8Array(buildForgedZipBomb(1024, 1024).slice(0));
    // Data starts after the 30-byte local header and the 24-byte entry name.
    bytes.fill(0xff, 54, 60);
    await expect(xlsxBufferToCsv(bytes.buffer)).rejects.toBeInstanceOf(ImportZipBombError);
  });

  it("rejects a stored entry larger than the cap and entries with an unsupported method", async () => {
    await expect(xlsxBufferToCsv(buildForgedZipBomb(21 * 1024 * 1024, 10, 0))).rejects.toBeInstanceOf(
      ImportZipBombError,
    );
    await expect(xlsxBufferToCsv(buildForgedZipBomb(16, 16, 12))).rejects.toBeInstanceOf(ImportZipBombError);
  });

  it("rejects archives with an oversized declared uncompressed entry", async () => {
    const buf = buildZipBombBuffer(25 * 1024 * 1024);
    await expect(xlsxBufferToCsv(buf)).rejects.toBeInstanceOf(ImportZipBombError);
  });

  it("quotes embedded double quotes and leaves ordinary cells unquoted", async () => {
    const buf = await buildXlsxBuffer([
      ["name", "note"],
      ["Ada", 'said "hello"'],
      ["Grace", "plain text"],
    ]);

    await expect(xlsxBufferToCsv(buf)).resolves.toBe(
      'name,note\nAda,"said ""hello"""\nGrace,plain text',
    );
  });

  it("exports cached formula values and Excel error results without object stringification", async () => {
    const buf = await buildXlsxBuffer([
      ["name", "calculation"],
      ["Ada", { formula: "1+1", result: 2 }],
      ["Grace", { formula: "1/0", result: { error: "#DIV/0!" as const } }],
    ]);

    await expect(xlsxBufferToCsv(buf)).resolves.toBe("name,calculation\nAda,2\nGrace,#DIV/0!");
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

    await expect(xlsxBufferToCsv(buf)).resolves.toBe(
      "rich text,link,error,formula date,boolean,formula without result\nAda Lovelace,Admitto,#N/A,2026-09-17T12:00:00.000Z,true,",
    );
  });
});

describe("xlsxBufferToCsv row limit", () => {
  // ExcelJS builds an object for every <row> while it loads a workbook, so a workbook with too many
  // rows has to be refused before load() is called, not by the row check that runs afterwards.
  const xlsxPrototype: { load: (...args: unknown[]) => unknown } = Object.getPrototypeOf(new ExcelJS.Workbook().xlsx);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refuses a worksheet with far more rows than the import accepts, without loading the workbook", async () => {
    const load = vi.spyOn(xlsxPrototype, "load");
    const buf = buildZip(workbookParts([emptyRows(MAX_IMPORT_ROWS * 20)]));

    await expect(xlsxBufferToCsv(buf)).rejects.toBeInstanceOf(ImportRowLimitError);
    expect(load).not.toHaveBeenCalled();
  });

  it("counts the rows of every worksheet, not only the first", async () => {
    const load = vi.spyOn(xlsxPrototype, "load");
    const half = MAX_IMPORT_ROWS / 2;
    await expect(xlsxBufferToCsv(buildZip(workbookParts([emptyRows(half), emptyRows(half)])))).resolves.toBe("");

    const buf = buildZip(workbookParts([emptyRows(half + 1), emptyRows(half + 1)]));
    load.mockClear();
    await expect(xlsxBufferToCsv(buf)).rejects.toBeInstanceOf(ImportRowLimitError);
    expect(load).not.toHaveBeenCalled();
  });

  it("takes the header row plus MAX_IMPORT_ROWS data rows and refuses one row more", async () => {
    const atLimit = buildZip(workbookParts([emptyRows(MAX_IMPORT_ROWS + 1)]));
    const oneOver = buildZip(workbookParts([emptyRows(MAX_IMPORT_ROWS + 2)]));

    await expect(xlsxBufferToCsv(atLimit)).resolves.toBe("");
    await expect(xlsxBufferToCsv(oneOver)).rejects.toBeInstanceOf(ImportRowLimitError);
  });

  it("still imports a workbook with MAX_IMPORT_ROWS data rows of five columns", async () => {
    const rows: string[][] = [["first_name", "last_name", "email", "company", "ticket_type"]];
    for (let i = 1; i <= MAX_IMPORT_ROWS; i++) {
      rows.push([`First${i}`, `Last${i}`, `person${i}@example.com`, `Acme ${i % 500} Ltd`, i % 3 ? "Standard" : "VIP"]);
    }

    const csv = await xlsxBufferToCsv(await buildXlsxBuffer(rows));

    const lines = csv.split("\n");
    expect(lines).toHaveLength(MAX_IMPORT_ROWS + 1);
    expect(lines[0]).toBe("first_name,last_name,email,company,ticket_type");
    expect(lines.at(-1)).toBe(`First${MAX_IMPORT_ROWS},Last${MAX_IMPORT_ROWS},person${MAX_IMPORT_ROWS}@example.com,Acme 0 Ltd,Standard`);
  }, 60_000);

  it("counts a row start tag whatever follows `<row`", async () => {
    const forms = ['<row r="N"/>', '<row r="N"></row>', '<row\tr="N"/>', '<row\r\nr="N"/>', "<row></row>", "<row/>"];
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 2 }, (_, i) => forms[i % forms.length]!.replace("N", String(i + 1)));
    const buf = buildZip(workbookParts([`<sheetData>${rows.join("")}</sheetData>`]));

    await expect(xlsxBufferToCsv(buf)).rejects.toBeInstanceOf(ImportRowLimitError);
  });

  it("does not take another element that only begins with `<row` for a row", async () => {
    const breaks = '<rowBreaks count="1" manualBreakCount="1"><brk id="1" max="16383" man="1"/></rowBreaks>';
    const buf = buildZip(workbookParts([`${emptyRows(MAX_IMPORT_ROWS + 1)}${breaks}`]));

    await expect(xlsxBufferToCsv(buf)).resolves.toBe("");
  });

  it("refuses an archive that lists more entries than its end record declares", async () => {
    const load = vi.spyOn(xlsxPrototype, "load");
    const parts = workbookParts([emptyRows(10), emptyRows(MAX_IMPORT_ROWS)]);

    // The same archive is over the row limit when it declares every entry...
    await expect(xlsxBufferToCsv(buildZip(parts))).rejects.toBeInstanceOf(ImportRowLimitError);
    // ...and must not slip past it by declaring one less: the last record is the second worksheet.
    await expect(
      xlsxBufferToCsv(buildZip(parts, { declaredEntries: Object.keys(parts).length - 1 })),
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

    await expect(xlsxBufferToCsv(patched)).rejects.toBeInstanceOf(ImportZipBombError);
  });

  it("counts the rows of a stored (uncompressed) worksheet too", async () => {
    const load = vi.spyOn(xlsxPrototype, "load");
    const atLimit = buildZip(workbookParts([emptyRows(MAX_IMPORT_ROWS + 1)]), { method: 0 });
    const oneOver = buildZip(workbookParts([emptyRows(MAX_IMPORT_ROWS + 2)]), { method: 0 });

    await expect(xlsxBufferToCsv(atLimit)).resolves.toBe("");
    load.mockClear();
    await expect(xlsxBufferToCsv(oneOver)).rejects.toBeInstanceOf(ImportRowLimitError);
    expect(load).not.toHaveBeenCalled();
  });
});


it.each(["\n", "\r\n"])("round-trips XLSX multiline cells with %j through the import parser", async (newline) => {
  const company = `Synthetic, "Team"${newline}Headquarters`;
  const first = `Synthetic${newline}First`;
  const notes = `One${newline}Two`;
  const csv = await xlsxBufferToCsv(await buildXlsxBuffer([
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
