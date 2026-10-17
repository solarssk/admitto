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

  it("splits on the given separator and leaves the other ones inside the cells", () => {
    expect(splitCsvLine("a,b;c;d", ";")).toEqual(["a,b", "c", "d"]);
    expect(splitCsvLine("a;b\tc\td", "\t")).toEqual(["a;b", "c", "d"]);
  });

  it("keeps a quoted separator inside its cell", () => {
    expect(splitCsvLine('"Doe; Jane";"She said ""hi""";x', ";")).toEqual(["Doe; Jane", 'She said "hi"', "x"]);
  });

  it("does not append a phantom field after a final quoted value, whatever the separator", () => {
    expect(splitCsvLine('name;"Doe; Jane"', ";")).toEqual(["name", "Doe; Jane"]);
  });

  it("keeps empty cells at both ends", () => {
    expect(splitCsvLine(";a;", ";")).toEqual(["", "a", ""]);
  });

  it("uses the comma when no separator is given", () => {
    expect(splitCsvLine("a;b,c")).toEqual(["a;b", "c"]);
  });
});
