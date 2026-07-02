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

  it("handles empty list", () => {
    expect(formatTable([])).toBe("(no rows)");
  });
});

describe("formatJson", () => {
  it("pretty-prints JSON", () => {
    expect(formatJson({ ok: true })).toBe('{\n  "ok": true\n}');
  });
});
