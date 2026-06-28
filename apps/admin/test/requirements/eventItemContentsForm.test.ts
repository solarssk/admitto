import { describe, expect, it } from "vitest";
import {
  contentRowFromDto,
  parseOptionsText,
  validateContentsRows,
} from "../../src/requirements/eventItemContentsForm.js";

const textRow = {
  label: "Shirt size",
  source_field: "shirt_size",
  type: "text" as const,
  required: false,
  options: "",
};

describe("validateContentsRows", () => {
  it("accepts valid rows and skips fully empty placeholders", () => {
    expect(
      validateContentsRows([
        textRow,
        { label: "", source_field: "", type: "text", required: false, options: "" },
      ]),
    ).toEqual({
      ok: true,
      contents: [{ label: "Shirt size", source_field: "shirt_size" }],
    });
  });

  it("returns empty contents when all rows are blank", () => {
    expect(validateContentsRows([])).toEqual({ ok: true, contents: [] });
    expect(
      validateContentsRows([{ label: "", source_field: "", type: "text", required: false, options: "" }]),
    ).toEqual({
      ok: true,
      contents: [],
    });
  });

  it("rejects partial rows", () => {
    expect(
      validateContentsRows([{ label: "Shirt size", source_field: "", type: "text", required: false, options: "" }]),
    ).toMatchObject({
      ok: false,
      message: expect.stringMatching(/both a label and a source field/i),
    });
  });

  it("rejects invalid source_field slugs instead of dropping them", () => {
    expect(
      validateContentsRows([
        { label: "Shirt size", source_field: "shirt-size", type: "text", required: false, options: "" },
      ]),
    ).toMatchObject({
      ok: false,
      message: expect.stringMatching(/lowercase letters/i),
    });
  });

  it("rejects when a later row has an invalid slug", () => {
    expect(
      validateContentsRows([
        { label: "Valid", source_field: "valid_field", type: "text", required: false, options: "" },
        { label: "Bad", source_field: "bad-slug", type: "text", required: false, options: "" },
      ]),
    ).toMatchObject({
      ok: false,
      message: expect.stringMatching(/lowercase letters/i),
    });
  });

  it("trims whitespace before validation", () => {
    expect(
      validateContentsRows([
        { label: "  Shirt size  ", source_field: " shirt_size ", type: "text", required: false, options: "" },
      ]),
    ).toEqual({
      ok: true,
      contents: [{ label: "Shirt size", source_field: "shirt_size" }],
    });
  });

  it("rejects duplicate source_field", () => {
    expect(
      validateContentsRows([
        { label: "A", source_field: "same_field", type: "text", required: false, options: "" },
        { label: "B", source_field: "same_field", type: "text", required: false, options: "" },
      ]),
    ).toMatchObject({
      ok: false,
      message: expect.stringMatching(/duplicate/i),
    });
  });

  it("rejects select type without options", () => {
    expect(
      validateContentsRows([
        { label: "Size", source_field: "size", type: "select", required: false, options: "" },
      ]),
    ).toMatchObject({
      ok: false,
      message: expect.stringMatching(/at least one option/i),
    });
  });

  it("does not skip rows with metadata but no label/source_field", () => {
    expect(
      validateContentsRows([
        { label: "", source_field: "", type: "select", required: false, options: "S, M" },
      ]),
    ).toMatchObject({
      ok: false,
      message: expect.stringMatching(/both a label and a source field/i),
    });
  });

  it("parses select options and preserves type/required", () => {
    expect(
      validateContentsRows([
        {
          label: "Size",
          source_field: "size",
          type: "select",
          required: true,
          options: " S, M , L ",
        },
      ]),
    ).toEqual({
      ok: true,
      contents: [
        {
          label: "Size",
          source_field: "size",
          type: "select",
          required: true,
          options: ["S", "M", "L"],
        },
      ],
    });
  });
});

describe("parseOptionsText", () => {
  it("splits comma-separated values", () => {
    expect(parseOptionsText("A, B, C")).toEqual(["A", "B", "C"]);
    expect(parseOptionsText("only")).toEqual(["only"]);
    expect(parseOptionsText("  ,  , ")).toEqual([]);
  });
});

describe("contentRowFromDto round-trip", () => {
  it("preserves select options through join and parse", () => {
    const dto = {
      label: "Size",
      source_field: "size",
      type: "select" as const,
      required: true,
      options: ["S", "M", "L"],
    };
    const row = contentRowFromDto(dto);
    expect(row.options).toBe("S, M, L");
    expect(validateContentsRows([row])).toEqual({
      ok: true,
      contents: [dto],
    });
  });
});
