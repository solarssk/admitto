/**
 * The text of an uploaded .csv file. Excel on a Polish system saves "CSV UTF-8" as UTF-8 with a byte
 * order mark and plain "CSV" as Windows-1250, so both are read. Text that Admitto cannot store or
 * cannot trust is refused instead: UTF-16 ("Unicode Text" in Excel) and any NUL character.
 */

export type CsvEncoding = "utf-8" | "windows-1250";

export type DecodedCsv = { csv: string; encoding: CsvEncoding };

/**
 * The file is text in an encoding that is not read (UTF-16), or holds a NUL character, which Postgres
 * refuses in text and would fail the whole import. The message names no part of the file.
 */
export class UnsupportedCsvEncodingError extends Error {
  constructor() {
    super("The CSV file is UTF-16 text or contains a NUL character.");
    this.name = "UnsupportedCsvEncodingError";
  }
}

/** Shown in the preview when the file is not UTF-8. The sample rows are where the operator checks the letters. */
export const WINDOWS_1250_WARNING =
  "This file is not saved as UTF-8, so Admitto read it as Windows-1250. Check that names with accented letters look right in the sample rows. If they do not, save the file as CSV UTF-8 and upload it again.";

function startsWithUtf16ByteOrderMark(bytes: Uint8Array): boolean {
  const [first, second] = bytes;
  return (first === 0xff && second === 0xfe) || (first === 0xfe && second === 0xff);
}

/**
 * Strict UTF-8 first (a byte order mark is dropped). Bytes that are not UTF-8 are read as Windows-1250,
 * which accepts every byte, and the caller tells the operator. The checks run on bytes: a NUL byte is
 * a NUL character in both encodings, and a UTF-16 mark is not valid UTF-8 or readable Windows-1250.
 */
export function decodeCsvBytes(buf: ArrayBuffer): DecodedCsv {
  const bytes = new Uint8Array(buf);
  if (startsWithUtf16ByteOrderMark(bytes) || bytes.includes(0)) throw new UnsupportedCsvEncodingError();
  try {
    return { csv: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
  } catch {
    return { csv: new TextDecoder("windows-1250").decode(bytes), encoding: "windows-1250" };
  }
}
