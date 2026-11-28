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
import type { ImportAttributeField } from "../src/types.js";

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

const extract = (raw: Record<string, string>, fields: ImportAttributeField[]) =>
  extractCustomDataFromRow(raw, fields, new Set<string>());

describe("extractCustomDataFromRow: long text, date, date and time and phone fields", () => {
  const notes: ImportAttributeField = { label: "Notes", source_field: "notes", type: "long_text" };
  const arrival: ImportAttributeField = { label: "Arrival date", source_field: "arrival", type: "date" };
  const arrivesAt: ImportAttributeField = { label: "Arrival time", source_field: "arrives_at", type: "datetime" };
  const phone: ImportAttributeField = { label: "Mobile phone", source_field: "phone", type: "phone" };

  it("stores each type's answer in its normal form", () => {
    expect(
      extract(
        { notes: "Two seats,\r\nplease. ", arrival: " 2026-11-04 ", arrives_at: "2026-11-04T10:30", phone: "+48 600-100-200" },
        [notes, arrival, arrivesAt, phone],
      ),
    ).toEqual({
      ok: true,
      custom_data: {
        notes: "Two seats,\nplease.",
        arrival: "2026-11-04",
        arrives_at: "2026-11-04T10:30",
        phone: "+48600100200",
      },
    });
  });

  it("reads a column through its export-style header, so an exported file imports again", () => {
    expect(extract({ "arrival date": "2026-11-04", "mobile phone": "+48600100200" }, [arrival, phone])).toEqual({
      ok: true,
      custom_data: { arrival: "2026-11-04", phone: "+48600100200" },
    });
  });

  it("leaves a blank cell as no answer", () => {
    expect(extract({ arrival: "", phone: "  " }, [arrival, phone])).toEqual({ ok: true, custom_data: undefined });
  });

  it("reads the date cell of an XLSX file as the date it shows", () => {
    // The XLSX reader writes a date cell as an instant at midnight, and a date and time cell as an
    // instant at that wall-clock time, both with a Z.
    expect(
      extract({ arrival: "2026-11-04T00:00:00.000Z", arrives_at: "2026-11-04T10:30:00.000Z" }, [arrival, arrivesAt]),
    ).toEqual({ ok: true, custom_data: { arrival: "2026-11-04", arrives_at: "2026-11-04T10:30" } });
  });

  it("refuses an instant that is not a date or a minute-precise time", () => {
    expect(extract({ arrival: "2026-11-04T10:00:00.000Z" }, [arrival])).toEqual({
      ok: false,
      reason: "Invalid value for Arrival date (expected a date as YYYY-MM-DD)",
    });
    expect(extract({ arrives_at: "2026-11-04T10:30:15.000Z" }, [arrivesAt])).toEqual({
      ok: false,
      reason: "Invalid value for Arrival time (expected a date and time as YYYY-MM-DDTHH:mm)",
    });
    expect(extract({ arrives_at: "2026-11-04T10:30:00+01:00" }, [arrivesAt]).ok).toBe(false);
  });

  it("does not read an instant as a date for a field of another type", () => {
    expect(extract({ notes: "2026-11-04T00:00:00.000Z" }, [notes])).toEqual({
      ok: true,
      custom_data: { notes: "2026-11-04T00:00:00.000Z" },
    });
  });

  it("explains what a refused value should look like, without echoing it", () => {
    expect(extract({ arrival: "2026-02-30" }, [arrival])).toEqual({
      ok: false,
      reason: "Invalid value for Arrival date (expected a date as YYYY-MM-DD)",
    });
    expect(extract({ arrives_at: "tomorrow" }, [arrivesAt])).toEqual({
      ok: false,
      reason: "Invalid value for Arrival time (expected a date and time as YYYY-MM-DDTHH:mm)",
    });
    expect(extract({ phone: "call me" }, [phone])).toEqual({
      ok: false,
      reason: "Invalid value for Mobile phone (expected a phone number with 3 to 15 digits)",
    });
    expect(extract({ notes: "a".repeat(1001) }, [notes])).toEqual({
      ok: false,
      reason: "Invalid value for Notes (expected at most 1000 characters)",
    });
  });

  it("names the field that is wrong when another one in the same row is fine", () => {
    expect(extract({ arrival: "2026-11-04", phone: "12" }, [arrival, phone])).toEqual({
      ok: false,
      reason: "Invalid value for Mobile phone (expected a phone number with 3 to 15 digits)",
    });
  });
});

describe("extractCustomDataFromRow: format rules", () => {
  const plate = (rules: ImportAttributeField["rules"]): ImportAttributeField => ({
    label: "Plate",
    source_field: "plate",
    type: "text",
    rules,
  });

  it("refuses a value that breaks a rule and says which rules the field has", () => {
    const fields = [plate({ digits_only: true, min_length: 3, max_length: 6, example: "123456" })];
    expect(extract({ plate: "12a" }, fields)).toEqual({
      ok: false,
      reason: "Invalid value for Plate (expected digits only, 3 to 6 characters, for example 123456)",
    });
    expect(extract({ plate: "1234567" }, fields).ok).toBe(false);
    expect(extract({ plate: "12" }, fields).ok).toBe(false);
    expect(extract({ plate: "123456" }, fields)).toEqual({ ok: true, custom_data: { plate: "123456" } });
  });

  it("words each length rule on its own", () => {
    const reason = (rules: ImportAttributeField["rules"], value: string) => {
      const result = extract({ plate: value }, [plate(rules)]);
      return result.ok ? null : result.reason;
    };
    expect(reason({ min_length: 9, max_length: 9 }, "1")).toBe("Invalid value for Plate (expected exactly 9 characters)");
    expect(reason({ min_length: 9 }, "1")).toBe("Invalid value for Plate (expected at least 9 characters)");
    expect(reason({ max_length: 4 }, "12345")).toBe("Invalid value for Plate (expected at most 4 characters)");
    expect(reason({ digits_only: true }, "1a")).toBe("Invalid value for Plate (expected digits only)");
  });

  it("adds a phone number's own limits to its rules, and the long text limit to a long text's", () => {
    const phone: ImportAttributeField = {
      label: "Phone",
      source_field: "phone",
      type: "phone",
      rules: { min_length: 9, example: "600100200" },
    };
    expect(extract({ phone: "12345" }, [phone])).toEqual({
      ok: false,
      reason: "Invalid value for Phone (expected a phone number with 3 to 15 digits, at least 9 characters, for example 600100200)",
    });
    const notes: ImportAttributeField = { label: "Notes", source_field: "notes", type: "long_text", rules: { min_length: 10 } };
    expect(extract({ notes: "short" }, [notes])).toEqual({
      ok: false,
      reason: "Invalid value for Notes (expected 10 to 1000 characters)",
    });
    expect(extract({ notes: "a".repeat(500) }, [{ ...notes, rules: { max_length: 500 } }]).ok).toBe(true);
    expect(extract({ notes: "a".repeat(501) }, [{ ...notes, rules: { max_length: 500 } }]).ok).toBe(false);
  });

  it("keeps the old text behaviour: no rules, no hint, and the 100 character cut", () => {
    expect(extract({ plate: "a".repeat(150) }, [plate(undefined)])).toEqual({
      ok: true,
      custom_data: { plate: "a".repeat(100) },
    });
    expect(extract({ plate: "x" }, [plate({})])).toEqual({ ok: true, custom_data: { plate: "x" } });
  });
});
