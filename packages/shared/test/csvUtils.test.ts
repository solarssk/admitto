import { describe, expect, it } from "vitest";
import { splitCsvLine } from "../src/csvUtils.js";

describe("splitCsvLine", () => {
  it("splits ordinary fields, including an empty trailing field", () => {
    expect(splitCsvLine("name,email,")).toEqual(["name", "email", ""]);
  });

  it("keeps commas in quoted fields and unescapes embedded quotes", () => {
    expect(splitCsvLine('"Doe, Jane","She said ""hello""",admin@example.com')).toEqual([
      "Doe, Jane",
      'She said "hello"',
      "admin@example.com",
    ]);
  });

  it("does not append a phantom field after a final quoted value", () => {
    expect(splitCsvLine('name,"Doe, Jane"')).toEqual(["name", "Doe, Jane"]);
  });

  it("keeps an unclosed quoted value as the rest of the line", () => {
    expect(splitCsvLine('name,"Doe, Jane')).toEqual(["name", "Doe, Jane"]);
  });
});
