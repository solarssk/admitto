import { describe, expect, it } from "vitest";
import { containsAddress } from "../src/erase-job-results.js";

describe("containsAddress", () => {
  it.each([
    ["the address alone", "gone@example.com"],
    ["a text that ends with the address and a full stop", "duplicate of gone@example.com."],
    ["a full stop that ends the sentence inside a quoted text", '"duplicate of gone@example.com."'],
    ["a hyphen after it", "gone@example.com-"],
    ["a comma, a semicolon and a colon around it", "mailto:gone@example.com, other@example.com;"],
    ["brackets around it", "(gone@example.com) <gone@example.com> [gone@example.com]"],
    ["double and single quotes around it", "invalid email: \"gone@example.com\" 'gone@example.com'"],
    ["backticks around it", "see `gone@example.com`"],
    ["a quote mark that opens the value, with no closing one", "'gone@example.com"],
    ["a quote mark that opens the value inside a quoted cell", "\"'gone@example.com'\""],
    ["a query after it", "mailto:gone@example.com?subject=hi"],
    ["a second occurrence after one that belongs to a longer address", "banana@example.com and gone@example.com"],
  ])("finds an address that stands alone: %s", (_label, text) => {
    expect(containsAddress(text, "gone@example.com")).toBe(true);
  });

  it.each([
    ["more letters before it", "xgone@example.com"],
    ["a dot and a letter before it", "john.gone@example.com"],
    ["an exclamation mark after a letter", "x!gone@example.com"],
    ["a hash after a letter", "x#gone@example.com"],
    ["an equals sign after a letter", "x=gone@example.com"],
    ["an apostrophe after a letter", "o'gone@example.com"],
    ["a plus after a letter", "x+gone@example.com"],
    ["an underscore after a letter", "x_gone@example.com"],
    ["a percent sign after a letter", "x%gone@example.com"],
    ["a hyphen after a letter", "x-gone@example.com"],
    ["an exclamation mark alone before it", "!gone@example.com"],
    ["a hash alone before it", "#gone@example.com"],
    ["an equals sign alone before it", "=gone@example.com"],
    ["a slash alone before it", "/gone@example.com"],
    ["an asterisk alone before it", "*gone@example.com"],
    ["an underscore alone before it (an address this app accepts)", "_gone@example.com"],
    ["a plus alone before it (an address this app accepts)", "+gone@example.com"],
    ["a hyphen alone before it (an address this app accepts)", "-gone@example.com"],
    ["a dot alone before it", ".gone@example.com"],
    ["a tilde alone before it", "~gone@example.com"],
    ["two quote marks before it", "''gone@example.com"],
    ["a digit before it", "1gone@example.com"],
    ["a letter of another script before it", "ßgone@example.com"],
    ["more letters after it", "gone@example.community"],
    ["a dot and a letter after it", "gone@example.com.au"],
    ["a hyphen and a letter after it", "gone@example.com-x"],
    ["a digit after it", "gone@example.com2"],
    ["only another address", "someone@example.com"],
    ["nothing", "no address in here"],
  ])("does not take part of a longer address for it: %s", (_label, text) => {
    expect(containsAddress(text, "gone@example.com")).toBe(false);
  });

  it("matches an address with an apostrophe or a plus in it as a whole, and not its tail", () => {
    expect(containsAddress('"o\'brien@example.com"', "o'brien@example.com")).toBe(true);
    expect(containsAddress('"o\'brien@example.com"', "brien@example.com")).toBe(false);
    expect(containsAddress("a+tag@example.com", "a+tag@example.com")).toBe(true);
    expect(containsAddress("a+tag@example.com", "tag@example.com")).toBe(false);
  });

  it("matches an internationalised address as a whole, and not its tail", () => {
    expect(containsAddress("jürgen@example.com.", "jürgen@example.com")).toBe(true);
    expect(containsAddress("xjürgen@example.com", "jürgen@example.com")).toBe(false);
    expect(containsAddress("jürgen@example.com", "rgen@example.com")).toBe(false);
  });
});
