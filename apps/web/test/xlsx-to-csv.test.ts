import { deflateRawSync } from "node:zlib";
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
  writeUint16LE(eocd, 10, 1);
  writeUint32LE(eocd, 12, cd.length + name.length);
  writeUint32LE(eocd, 16, cdOffset);
  const out = Buffer.concat([local, name, data, cd, name, eocd]);
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
