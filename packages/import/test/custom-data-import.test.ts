import { describe, expect, it } from "vitest";
import {
  buildAttributeHeaderKeys,
  extractCustomDataFromRow,
} from "../src/custom-data-import.js";

describe("buildAttributeHeaderKeys", () => {
  it("treats labels that differ only by case as duplicates", () => {
    const { duplicateLabels } = buildAttributeHeaderKeys([
      { label: "Sock Size", source_field: "sock_size" },
      { label: "sock size", source_field: "sock_size_alt" },
    ]);
    expect(duplicateLabels.has("sock size")).toBe(true);
  });
});

describe("extractCustomDataFromRow", () => {
  it("does not map canonical import columns via export-style label headers", () => {
    const result = extractCustomDataFromRow(
      {
        first_name: "Jan",
        last_name: "K",
        email: "jan@example.com",
      },
      [{ label: "Email", source_field: "vendor_ref", type: "text" }],
      new Set<string>(),
    );
    expect(result).toEqual({ ok: true, custom_data: undefined });
  });

  it("explains the accepted values for an invalid boolean attribute", () => {
    const result = extractCustomDataFromRow(
      { newsletter: "sometimes" },
      [{ label: "Newsletter", source_field: "newsletter", type: "boolean" }],
      new Set<string>(),
    );

    expect(result).toEqual({
      ok: false,
      reason: "Invalid value for Newsletter (expected Yes/No or true/false)",
    });
  });

  it("lists allowed options for an invalid select attribute", () => {
    const result = extractCustomDataFromRow(
      { meal: "pasta" },
      [
        {
          label: "Meal",
          source_field: "meal",
          type: "select",
          options: ["vegetarian", "standard"],
        },
      ],
      new Set<string>(),
    );

    expect(result).toEqual({
      ok: false,
      reason: "Invalid value for Meal (expected one of: vegetarian, standard)",
    });
  });

  it("finds an invalid value through the disambiguated export header for duplicate labels", () => {
    const fields = [
      { label: "Meal", source_field: "lunch_meal", type: "select" as const, options: ["vegetarian"] },
      { label: "Meal", source_field: "dinner_meal", type: "select" as const, options: ["standard"] },
    ];
    const { duplicateLabels } = buildAttributeHeaderKeys(fields);

    const result = extractCustomDataFromRow(
      { "meal (dinner_meal)": "pasta" },
      fields,
      duplicateLabels,
    );

    expect(result).toEqual({
      ok: false,
      reason: "Invalid value for Meal (expected one of: standard)",
    });
  });

  it("trims and normalizes a present boolean custom attribute", () => {
    const result = extractCustomDataFromRow(
      { newsletter: " YES " },
      [{ label: "Newsletter", source_field: "newsletter", type: "boolean" }],
      new Set<string>(),
    );

    expect(result).toEqual({ ok: true, custom_data: { newsletter: "true" } });
  });
});
