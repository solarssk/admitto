import { describe, expect, it, vi } from "vitest";

// Only `extractCustomDataFromRow`'s "unrecognized error" fallback test below needs this mock (a
// field slug that makes the real normalizer throw a message the extractor can't classify); every
// other test in this file runs through the real @admitto/tickets normalizer untouched.
vi.mock("@admitto/tickets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/tickets")>();
  return {
    ...actual,
    normalizeCustomDataFieldValue: (
      field: Parameters<typeof actual.normalizeCustomDataFieldValue>[0],
      raw: Parameters<typeof actual.normalizeCustomDataFieldValue>[1],
    ) => {
      if (field.source_field === "boom") {
        throw new Error("unexpected_internal_error");
      }
      return actual.normalizeCustomDataFieldValue(field, raw);
    },
  };
});

import {
  buildAttributeHeaderKeys,
  extractCustomDataFromRow,
  importCustomDataSkipReason,
} from "../src/custom-data-import.js";

describe("buildAttributeHeaderKeys", () => {
  it("treats labels that differ only by case as duplicates", () => {
    const { duplicateLabels } = buildAttributeHeaderKeys([
      { label: "Sock Size", source_field: "sock_size" },
      { label: "sock size", source_field: "sock_size_alt" },
    ]);
    expect(duplicateLabels.has("sock size")).toBe(true);
  });

  it("accepts both slugs and normalized export headers", () => {
    const { allowedHeaders, duplicateLabels } = buildAttributeHeaderKeys([
      { label: "Dietary preference", source_field: "dietary_preference" },
      { label: "Meal", source_field: "lunch_meal" },
      { label: "Meal", source_field: "dinner_meal" },
    ]);

    expect(duplicateLabels).toEqual(new Set(["meal"]));
    expect(allowedHeaders).toEqual(
      new Set([
        "dietary_preference",
        "dietary preference",
        "lunch_meal",
        "meal (lunch_meal)",
        "dinner_meal",
        "meal (dinner_meal)",
      ]),
    );
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

  it("reads a non-reserved custom attribute from its normalized export header", () => {
    const result = extractCustomDataFromRow(
      { "dietary preference": "  vegan  " },
      [{ label: "Dietary preference", source_field: "dietary_preference", type: "text" }],
      new Set<string>(),
    );

    expect(result).toEqual({ ok: true, custom_data: { dietary_preference: "vegan" } });
  });

  it("falls back to a safe message for an error it doesn't recognize", () => {
    const result = extractCustomDataFromRow(
      { boom: "value" },
      [{ label: "Boom", source_field: "boom", type: "text" }],
      new Set<string>(),
    );

    expect(result).toEqual({ ok: false, reason: "Invalid custom attribute data" });
  });

  it("ignores a custom field that collides with a fixed import column", () => {
    const result = extractCustomDataFromRow(
      { email: "attendee@example.com" },
      [{ label: "Email override", source_field: "email", type: "text" }],
      new Set<string>(),
    );

    expect(result).toEqual({ ok: true });
  });
});

describe("importCustomDataSkipReason", () => {
  it("names a missing required field, with its slug as a safe fallback", () => {
    const fields = [{ label: "Meal preference", source_field: "meal", type: "select" as const }];

    expect(
      importCustomDataSkipReason(new Error("required_custom_data_field_missing:meal"), fields),
    ).toBe("Missing required attribute: Meal preference");
    expect(
      importCustomDataSkipReason(new Error("required_custom_data_field_missing:unknown"), fields),
    ).toBe("Missing required attribute: unknown");
  });

  it("keeps malformed custom-data errors operator-safe", () => {
    const fields = [{ label: "Meal preference", source_field: "meal", type: "select" as const }];

    expect(importCustomDataSkipReason(new Error("invalid_custom_data_value"), fields)).toBe(
      "Invalid custom attribute data",
    );
    expect(importCustomDataSkipReason("database detail", fields)).toBe("Invalid custom attribute data");
  });
});
