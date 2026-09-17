import { describe, expect, it } from "vitest";
import { buildXlsxBuffer, ImportZipBombError, xlsxBufferToCsv } from "../src/admin/xlsx-to-csv.js";

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
  writeUint16LE(bytes, 56, 1); // total entries
  writeUint32LE(bytes, 60, 0); // central directory offset
  return bytes.buffer;
}

describe("xlsxBufferToCsv zip guards", () => {
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
