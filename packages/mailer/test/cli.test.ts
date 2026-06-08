import { describe, expect, it } from "vitest";
import { splitCsvLine } from "../src/csvUtils.js";

describe("splitCsvLine", () => {
  it("splits a simple CSV line", () => {
    expect(splitCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("handles quoted fields with embedded commas", () => {
    expect(splitCsvLine('"Smith, John",john@example.com')).toEqual(["Smith, John", "john@example.com"]);
  });

  it("handles double-quote escaping inside quoted fields", () => {
    expect(splitCsvLine('"say ""hello""",b')).toEqual(['say "hello"', "b"]);
  });

  it("handles empty fields", () => {
    expect(splitCsvLine("a,,c")).toEqual(["a", "", "c"]);
  });

  it("handles a single field with no commas", () => {
    expect(splitCsvLine("only")).toEqual(["only"]);
  });

  it("does not append phantom empty field for a single quoted field", () => {
    expect(splitCsvLine('"only"')).toEqual(["only"]);
  });

  it("does not append phantom empty field when final field is quoted", () => {
    expect(splitCsvLine('"a","b"')).toEqual(["a", "b"]);
  });

  it("handles quoted field containing newline-free content and trailing comma", () => {
    expect(splitCsvLine('"quoted",plain,')).toEqual(["quoted", "plain", ""]);
  });
});
