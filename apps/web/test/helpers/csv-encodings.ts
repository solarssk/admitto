/**
 * Byte-level fixtures for the CSV upload tests: what spreadsheet programs write when they do not
 * save plain UTF-8. The Windows-1250 table is read back from the platform decoder, so no code
 * point is typed from memory.
 */

export type CsvSeparator = "," | ";" | "\t";

/** Synthetic attendees. Every Polish letter that Windows-1250 and UTF-8 spell differently shows up in a name. */
export const POLISH_ATTENDEES = [
  { first_name: "Łukasz", last_name: "Wiśniewski", email: "lukasz.wisniewski@example.com" },
  { first_name: "Żaneta", last_name: "Dąbrowska", email: "zaneta.dabrowska@example.com" },
  { first_name: "Józef", last_name: "Ćwikła", email: "jozef.cwikla@example.com" },
] as const;

/** The full name the import shows and stores for each of POLISH_ATTENDEES. */
export const POLISH_ATTENDEE_NAMES = POLISH_ATTENDEES.map((a) => `${a.first_name} ${a.last_name}`);

/** The same file Excel writes: a header and one line per attendee, CRLF line endings, one separator. */
export function polishAttendeesCsv(separator: CsvSeparator): string {
  const lines = [
    ["first_name", "last_name", "email"],
    ...POLISH_ATTENDEES.map((a) => [a.first_name, a.last_name, a.email]),
  ];
  return lines.map((cells) => cells.join(separator)).join("\r\n") + "\r\n";
}

function windows1250Table(): Map<string, number> {
  const decoder = new TextDecoder("windows-1250");
  const table = new Map<string, number>();
  for (let byte = 0x80; byte <= 0xff; byte++) table.set(decoder.decode(Uint8Array.of(byte)), byte);
  return table;
}

/** The text as Windows-1250 bytes, the way Excel on a Polish system saves "CSV". Throws for a character the encoding lacks. */
export function encodeWindows1250(text: string): Uint8Array<ArrayBuffer> {
  const table = windows1250Table();
  return Uint8Array.from(
    [...text].map((char) => {
      const code = char.codePointAt(0) ?? 0;
      if (code < 0x80) return code;
      const byte = table.get(char);
      if (byte === undefined) throw new Error(`"${char}" has no Windows-1250 byte`);
      return byte;
    }),
  );
}

/** UTF-8 with the three-byte mark that Excel's "CSV UTF-8" starts with. */
export function encodeUtf8WithBom(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from([0xef, 0xbb, 0xbf, ...Buffer.from(text, "utf8")]);
}

/** UTF-16 little-endian with a byte order mark: what Excel's "Unicode Text" writes. */
export function encodeUtf16le(text: string, options: { bom?: boolean } = {}): Uint8Array<ArrayBuffer> {
  const body = Buffer.from(text, "utf16le");
  return Uint8Array.from(options.bom === false ? body : [0xff, 0xfe, ...body]);
}

/** UTF-16 big-endian with a byte order mark. */
export function encodeUtf16be(text: string): Uint8Array<ArrayBuffer> {
  const body = Buffer.from(Buffer.from(text, "utf16le")).swap16();
  return Uint8Array.from([0xfe, 0xff, ...body]);
}
