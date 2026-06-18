import { describe, expect, it } from "vitest";
import { validateContentsRows } from "../../src/requirements/eventItemContentsForm.js";

describe("validateContentsRows", () => {
  it("accepts valid rows and skips fully empty placeholders", () => {
    expect(
      validateContentsRows([
        { label: "Shirt size", source_field: "shirt_size" },
        { label: "", source_field: "" },
      ]),
    ).toEqual({
      ok: true,
      contents: [{ label: "Shirt size", source_field: "shirt_size" }],
    });
  });

  it("rejects partial rows", () => {
    const result = validateContentsRows([{ label: "Shirt size", source_field: "" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/both a label and a source field/i);
    }
  });

  it("rejects invalid source_field slugs instead of dropping them", () => {
    const result = validateContentsRows([{ label: "Shirt size", source_field: "shirt-size" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/lowercase letters/i);
    }
  });

  it("trims whitespace before validation", () => {
    expect(
      validateContentsRows([{ label: "  Shirt size  ", source_field: " shirt_size " }]),
    ).toEqual({
      ok: true,
      contents: [{ label: "Shirt size", source_field: "shirt_size" }],
    });
  });
});
