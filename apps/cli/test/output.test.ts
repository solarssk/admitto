import { describe, expect, it } from "vitest";
import { formatJson, formatTable } from "../src/lib/output.js";

describe("formatTable", () => {
  it("renders header and rows", () => {
    const out = formatTable([
      { id: "a1", name: "Jan" },
      { id: "b2", name: "Anna" },
    ]);
    expect(out).toContain("id");
    expect(out).toContain("a1");
    expect(out).toContain("Anna");
  });

  it("preserves numeric and boolean cells", () => {
    const out = formatTable([{ sent: 12, retryable: false }]);
    expect(out).toContain("12");
    expect(out).toContain("false");
  });

  it("handles empty list", () => {
    expect(formatTable([])).toBe("(no rows)");
  });

  it("renders null/undefined cells as blank", () => {
    const out = formatTable([{ id: "a1", note: null, tag: undefined }]);
    const row = out.split("\n")[1]!;
    expect(row.startsWith("a1")).toBe(true);
  });

  it("renders object-valued cells as JSON instead of [object Object]", () => {
    const out = formatTable([{ id: "a1", meta: { role: "admin" } }]);
    expect(out).toContain('{"role":"admin"}');
    expect(out).not.toContain("[object Object]");
  });

  it("renders bigint cells", () => {
    const out = formatTable([{ id: "a1", count: 9_007_199_254_740_993n }]);
    expect(out).toContain("9007199254740993");
  });

  it("falls back to String() for cell values with no other case (e.g. a function)", () => {
    const out = formatTable([{ id: "a1", handler: function noop() {} }]);
    expect(out).toContain("a1");
    expect(out).toContain("function");
  });
});

describe("formatJson", () => {
  it("pretty-prints JSON", () => {
    expect(formatJson({ ok: true })).toBe('{\n  "ok": true\n}');
  });
});
