import { describe, expect, it } from "vitest";
import { quoteCsvCell, sanitizeCsvCell } from "../src/csv-sanitize.js";

describe("quoteCsvCell", () => {
  it("wraps a plain value in double quotes", () => {
    expect(quoteCsvCell("time")).toBe('"time"');
  });

  it("doubles embedded double quotes (RFC 4180)", () => {
    expect(quoteCsvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it("wraps an empty string", () => {
    expect(quoteCsvCell("")).toBe('""');
  });

  it("preserves embedded commas and CRLF as-is inside the quotes", () => {
    expect(quoteCsvCell("a,b\r\nc")).toBe('"a,b\r\nc"');
  });
});

describe("sanitizeCsvCell", () => {
  it("returns an empty string for null/undefined", () => {
    expect(sanitizeCsvCell(null)).toBe("");
    expect(sanitizeCsvCell(undefined)).toBe("");
  });

  it("prefixes a formula-injection value with a single quote", () => {
    expect(sanitizeCsvCell("=SUM(A1:A2)")).toBe("'=SUM(A1:A2)");
  });

  it("leaves an ordinary value untouched", () => {
    expect(sanitizeCsvCell("Jane Doe")).toBe("Jane Doe");
  });
});
