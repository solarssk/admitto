import { describe, expect, it } from "vitest";
import { sanitizeCsvCell } from "../src/admin/csv-sanitize.js";

describe("sanitizeCsvCell", () => {
  it("prefixes newline-led formula cells (SEC-001)", () => {
    const value = '\n=HYPERLINK("https://evil.example.com","click")';
    expect(sanitizeCsvCell(value)).toBe(`'${value}`);
  });

  it("prefixes leading formula characters", () => {
    expect(sanitizeCsvCell("=SUM(1)")).toBe("'=SUM(1)");
    expect(sanitizeCsvCell("+123")).toBe("'+123");
    expect(sanitizeCsvCell("-1")).toBe("'-1");
    expect(sanitizeCsvCell("@SUM(1)")).toBe("'@SUM(1)");
  });

  it("prefixes whitespace before formula characters", () => {
    expect(sanitizeCsvCell("  =SUM(1)")).toBe("'  =SUM(1)");
  });

  it("leaves normal text unchanged", () => {
    expect(sanitizeCsvCell("Jane Doe")).toBe("Jane Doe");
    expect(sanitizeCsvCell("")).toBe("");
    expect(sanitizeCsvCell(null)).toBe("");
    expect(sanitizeCsvCell(undefined)).toBe("");
  });
});
