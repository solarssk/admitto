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

  it("returns empty contents when all rows are blank", () => {
    expect(validateContentsRows([])).toEqual({ ok: true, contents: [] });
    expect(validateContentsRows([{ label: "", source_field: "" }])).toEqual({
      ok: true,
      contents: [],
    });
  });

  it("rejects partial rows", () => {
    expect(validateContentsRows([{ label: "Shirt size", source_field: "" }])).toMatchObject({
      ok: false,
      message: expect.stringMatching(/both a label and a source field/i),
    });
  });

  it("rejects invalid source_field slugs instead of dropping them", () => {
    expect(validateContentsRows([{ label: "Shirt size", source_field: "shirt-size" }])).toMatchObject({
      ok: false,
      message: expect.stringMatching(/lowercase letters/i),
    });
  });

  it("rejects when a later row has an invalid slug", () => {
    expect(
      validateContentsRows([
        { label: "Valid", source_field: "valid_field" },
        { label: "Bad", source_field: "bad-slug" },
      ]),
    ).toMatchObject({
      ok: false,
      message: expect.stringMatching(/lowercase letters/i),
    });
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
