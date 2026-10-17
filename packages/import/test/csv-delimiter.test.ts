import { describe, expect, it } from "vitest";
import { detectCsvDelimiter } from "../src/csv-delimiter.js";

const BOM = String.fromCharCode(0xfeff);

describe("detectCsvDelimiter", () => {
  it.each([
    ["comma", "first_name,last_name,email\nAda,Test,ada@example.com", ","],
    ["semicolon", "first_name;last_name;email\nAda;Test;ada@example.com", ";"],
    ["tab", "first_name\tlast_name\temail\nAda\tTest\tada@example.com", "\t"],
  ])("picks the %s that gives the required columns", (_label, csv, expected) => {
    expect(detectCsvDelimiter(csv)).toBe(expected);
  });

  it.each([
    ["a byte order mark", `${BOM}first_name;last_name;email\nAda;Test;ada@example.com`, ";"],
    ["blank lines before the header", "\n   \r\n\nfirst_name;last_name;email\nAda;Test;ada@example.com", ";"],
    ["CRLF line endings", "first_name;last_name;email\r\nAda;Test;ada@example.com\r\n", ";"],
    ["capital letters and spaces in the header", " First_Name ; LAST_NAME ;Email \nAda;Test;ada@example.com", ";"],
    ["quoted header cells", '"first_name";"last_name";"email"\nAda;Test;ada@example.com', ";"],
    ["a comma inside a quoted header cell", '"first_name";"last_name";"email";"notes, extra"', ";"],
    ["a semicolon inside a quoted header cell", 'first_name,last_name,email,"notes; extra"', ","],
    ["only some of the required columns", "last_name;email", ";"],
    ["a header that is the only line", "first_name\tlast_name\temail", "\t"],
  ])("copes with %s", (_label, csv, expected) => {
    expect(detectCsvDelimiter(csv)).toBe(expected);
  });

  it("decides by the header only, not by the other lines", () => {
    expect(detectCsvDelimiter("first_name;last_name;email\nAda,Test,ada@example.com,x,y,z,w")).toBe(";");
    expect(detectCsvDelimiter("first_name,last_name,email\nAda;Test;ada@example.com;x;y;z;w")).toBe(",");
  });

  it.each([
    ["no separator matches the header", "name;mail\nAda;ada@example.com"],
    ["the header has a single required column", "email\nada@example.com"],
    ["two separators match the header equally", "first_name,last_name;email\nAda,Test;ada@example.com"],
    ["the text is empty", ""],
    ["the text is only white space", " \n\t\r\n  "],
  ])("keeps the comma when %s", (_label, csv) => {
    expect(detectCsvDelimiter(csv)).toBe(",");
  });
});
