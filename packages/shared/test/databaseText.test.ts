import { describe, expect, it } from "vitest";
import { toDatabaseJson, toDatabaseText } from "../src/databaseText.js";

describe("toDatabaseText", () => {
  it("keeps ordinary text, including accents, CJK and emoji pairs, unchanged", () => {
    const text = "Zażółć gęślą jaźń 日本語 😀 a@example.com";
    expect(toDatabaseText(text)).toBe(text);
  });

  it("replaces U+0000 with the replacement character", () => {
    expect(toDatabaseText("x\u0000@example.com")).toBe("x\ufffd@example.com");
    expect(toDatabaseText("\u0000\u0000")).toBe("\ufffd\ufffd");
  });

  it("replaces a lone surrogate and keeps a valid pair", () => {
    expect(toDatabaseText("\ud800x")).toBe("\ufffdx");
    expect(toDatabaseText("x\udc00")).toBe("x\ufffd");
    expect(toDatabaseText("\udc00\ud800")).toBe("\ufffd\ufffd");
    expect(toDatabaseText("\ud83d\ude00\ud83d")).toBe("\ud83d\ude00\ufffd");
  });
});

describe("toDatabaseJson", () => {
  it("cleans every string key and value at any depth and leaves other values alone", () => {
    const input = {
      email: "x\u0000@example.com",
      "bad\u0000key": 1,
      nested: { list: ["ok", "\ud800", { deep: "a\u0000b" }], flag: true, none: null, count: 3 },
    };
    expect(toDatabaseJson(input)).toEqual({
      email: "x\ufffd@example.com",
      "bad\ufffdkey": 1,
      nested: { list: ["ok", "\ufffd", { deep: "a\ufffdb" }], flag: true, none: null, count: 3 },
    });
  });

  it("does not change its input", () => {
    const input = { email: "x\u0000@example.com", list: ["\ud800"] };
    toDatabaseJson(input);
    expect(input).toEqual({ email: "x\u0000@example.com", list: ["\ud800"] });
  });

  it("cleans an object without a prototype and leaves other class instances as they are", () => {
    const bare = Object.assign(Object.create(null) as Record<string, unknown>, { email: "x\u0000@example.com" });
    expect(toDatabaseJson(bare)).toEqual({ email: "x\ufffd@example.com" });
    const when = new Date(0);
    expect(toDatabaseJson({ when }).when).toBe(when);
  });

  it("returns primitives unchanged", () => {
    expect(toDatabaseJson(42)).toBe(42);
    expect(toDatabaseJson(null)).toBeNull();
    expect(toDatabaseJson("a\u0000")).toBe("a\ufffd");
  });
});
