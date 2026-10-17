import { describe, expect, it } from "vitest";
import { UnsupportedCsvEncodingError, WINDOWS_1250_WARNING, decodeCsvBytes } from "../src/admin/csv-decode.js";
import { encodeUtf16be, encodeUtf16le, encodeUtf8WithBom, encodeWindows1250 } from "./helpers/csv-encodings.js";

const POLISH_LETTERS = "ąćęłńóśźż ĄĆĘŁŃÓŚŹŻ";
const REPLACEMENT_CHARACTER = String.fromCharCode(0xfffd);
const NUL = String.fromCharCode(0);

/** An exact-size copy, the way a request body arrives. */
const bufferOf = (bytes: Uint8Array): ArrayBuffer => Uint8Array.from(bytes).buffer;
const utf8 = (text: string): ArrayBuffer => bufferOf(Buffer.from(text, "utf8"));

describe("decodeCsvBytes", () => {
  it("reads plain ASCII as UTF-8", () => {
    expect(decodeCsvBytes(utf8("first_name,last_name\nAda,Test"))).toEqual({
      csv: "first_name,last_name\nAda,Test",
      encoding: "utf-8",
    });
  });

  it("reads UTF-8 text with Polish letters as it is", () => {
    const text = `first_name;last_name\n${POLISH_LETTERS};x`;
    expect(decodeCsvBytes(utf8(text))).toEqual({ csv: text, encoding: "utf-8" });
  });

  it("reads an empty file as empty UTF-8", () => {
    expect(decodeCsvBytes(new ArrayBuffer(0))).toEqual({ csv: "", encoding: "utf-8" });
  });

  it("drops the byte order mark of UTF-8 (Excel CSV UTF-8) and does not call the file Windows-1250", () => {
    const decoded = decodeCsvBytes(bufferOf(encodeUtf8WithBom("first_name;last_name\nŁukasz;Wiśniewski")));
    expect(decoded).toEqual({ csv: "first_name;last_name\nŁukasz;Wiśniewski", encoding: "utf-8" });
  });

  it("reads bytes that are not UTF-8 as Windows-1250 (Excel CSV on a Polish system)", () => {
    const text = `first_name;last_name\n${POLISH_LETTERS};x`;
    expect(decodeCsvBytes(bufferOf(encodeWindows1250(text)))).toEqual({ csv: text, encoding: "windows-1250" });
  });

  it("never turns a letter into the replacement character", () => {
    const fromUtf8 = decodeCsvBytes(utf8(POLISH_LETTERS)).csv;
    const fromWindows1250 = decodeCsvBytes(bufferOf(encodeWindows1250(POLISH_LETTERS))).csv;
    expect(fromUtf8).not.toContain(REPLACEMENT_CHARACTER);
    expect(fromWindows1250).not.toContain(REPLACEMENT_CHARACTER);
  });

  it("reads a byte that Windows-1250 leaves undefined as a control character instead of failing", () => {
    const decoded = decodeCsvBytes(bufferOf(Uint8Array.of(0x41, 0x81, 0xa3)));
    expect(decoded).toEqual({ csv: `A${String.fromCharCode(0x81)}Ł`, encoding: "windows-1250" });
  });

  it.each([
    ["little-endian", encodeUtf16le("first_name,last_name\r\nAda,Test\r\n")],
    ["big-endian", encodeUtf16be("first_name,last_name\r\nAda,Test\r\n")],
  ])("refuses UTF-16 %s with a byte order mark (Excel Unicode Text)", (_label, bytes) => {
    expect(() => decodeCsvBytes(bufferOf(bytes))).toThrow(UnsupportedCsvEncodingError);
  });

  it.each([
    ["little-endian", encodeUtf16le("ŁŁ")],
    ["big-endian", encodeUtf16be("ŁŁ")],
  ])("refuses UTF-16 %s on its byte order mark alone, when the text has no NUL byte", (_label, bytes) => {
    expect(bytes.includes(0)).toBe(false);
    expect(() => decodeCsvBytes(bufferOf(bytes))).toThrow(UnsupportedCsvEncodingError);
  });

  it.each([0xff, 0xfe])("does not take a Windows-1250 file that only starts with the byte %i for UTF-16", (first) => {
    const decoded = decodeCsvBytes(bufferOf(Uint8Array.of(first, 0x41)));
    expect(decoded).toEqual({ csv: `${new TextDecoder("windows-1250").decode(Uint8Array.of(first))}A`, encoding: "windows-1250" });
  });

  it("refuses UTF-16 without a byte order mark, which is full of NUL bytes", () => {
    const bytes = encodeUtf16le("first_name,last_name\r\nAda,Test\r\n", { bom: false });
    expect(() => decodeCsvBytes(bufferOf(bytes))).toThrow(UnsupportedCsvEncodingError);
  });

  it.each([
    ["in the middle of UTF-8 text", utf8(`first_name,last_name\nAda,Te${NUL}st`)],
    ["as the first byte", utf8(`${NUL}first_name,last_name\nAda,Test`)],
    ["as the last byte", utf8(`first_name,last_name\nAda,Test${NUL}`)],
    ["in a file that would be read as Windows-1250", bufferOf(Uint8Array.of(0xa3, 0x00, 0x75))],
  ])("refuses a NUL character %s", (_label, buffer) => {
    expect(() => decodeCsvBytes(buffer)).toThrow(UnsupportedCsvEncodingError);
  });
});

describe("WINDOWS_1250_WARNING", () => {
  it("names the encoding that was used and the way out", () => {
    expect(WINDOWS_1250_WARNING).toContain("Windows-1250");
    expect(WINDOWS_1250_WARNING).toContain("CSV UTF-8");
  });
});
