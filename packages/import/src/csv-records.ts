/** Non-empty logical CSV records; quoted LF/CRLF remain part of their field. */
export type CsvRecord = { text: string; malformed: boolean };
type CsvState = {
  kind: "start" | "plain" | "quoted" | "closed" | "closedSpace";
  malformed: boolean;
};

/** True only for the second half of an escaped quote, which the caller skips. */
function advanceCsvState(state: CsvState, char: string, next: string): boolean {
  if (state.kind === "quoted") {
    if (char !== '"') return false;
    if (next === '"') return true;
    state.kind = "closed";
    return false;
  }
  if (char === ",") {
    state.malformed ||= state.kind === "closedSpace";
    state.kind = "start";
    return false;
  }
  if (state.kind === "start") {
    state.kind = char === '"' ? "quoted" : "plain";
    return false;
  }
  if (state.kind === "closed" || state.kind === "closedSpace") {
    state.malformed ||= char.trim().length > 0;
    state.kind = "closedSpace";
  }
  return false;
}

/** Streaming boundaries let upload limits stop before materializing every record. */
export function* csvRecords(csvString: string): Generator<CsvRecord> {
  const csv = csvString.replace(/^\uFEFF/, "");
  let start = 0;
  let state: CsvState = { kind: "start", malformed: false };
  for (let index = 0; index < csv.length; index++) {
    const char = csv.charAt(index);
    if (char === "\n" && state.kind !== "quoted") {
      const text = csv.slice(start, index).trimEnd();
      if (text.trim()) yield { text, malformed: state.malformed };
      start = index + 1;
      state = { kind: "start", malformed: false };
    } else if (advanceCsvState(state, char, csv.charAt(index + 1))) {
      index++;
    }
  }
  const text = csv.slice(start).trimEnd();
  if (text.trim()) yield { text, malformed: state.malformed || state.kind === "quoted" };
}
