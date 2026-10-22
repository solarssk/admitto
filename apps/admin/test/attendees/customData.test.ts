import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CustomDataFieldDef } from "../../src/attendees/customData.js";
import { setPreferredLocale } from "../../src/utils/locale-store.js";

const mockFetchEventCustomFields = vi.fn();
vi.mock("../../src/api/client.js", () => ({
  fetchEventCustomFields: (...args: unknown[]) => mockFetchEventCustomFields(...args),
}));

const {
  allCustomDataEntries,
  customDataApiErrorMessage,
  customDataFieldLabel,
  fetchAttendeeCustomFields,
  initialCustomFieldValues,
  isLongAnswer,
  readCustomDataField,
  validateCustomFieldsForm,
} = await import("../../src/attendees/customData.js");

describe("fetchAttendeeCustomFields", () => {
  it("drops registry fields whose source_field collides with a reserved profile column", async () => {
    mockFetchEventCustomFields.mockResolvedValueOnce([
      { id: "1", source_field: "email", label: "Email copy", type: "text", required: false, options: null, created_at: "2026-01-01T00:00:00.000Z" },
      { id: "2", source_field: "dietary", label: "Dietary", type: "text", required: false, options: null, created_at: "2026-01-01T00:00:00.000Z" },
    ]);

    const fields = await fetchAttendeeCustomFields("evt-1");

    expect(fields.map((f) => f.source_field)).toEqual(["dietary"]);
  });
});

describe("readCustomDataField", () => {
  it("trims string values", () => {
    expect(readCustomDataField({ jacket_size: "  L  " }, "jacket_size")).toBe("L");
  });

  it("returns null for missing or empty values", () => {
    expect(readCustomDataField({}, "jacket_size")).toBeNull();
    expect(readCustomDataField({ jacket_size: "   " }, "jacket_size")).toBeNull();
    expect(readCustomDataField(null, "jacket_size")).toBeNull();
  });

  it("ignores non-string values", () => {
    expect(readCustomDataField({ jacket_size: 42 }, "jacket_size")).toBeNull();
  });
});

describe("customDataFieldLabel (Codecov review — previously untested)", () => {
  it("appends a required marker for required fields", () => {
    expect(
      customDataFieldLabel({ label: "Size", source_field: "size", type: "text", required: true }),
    ).toBe("Size *");
  });

  it("leaves the label alone for optional fields", () => {
    expect(
      customDataFieldLabel({ label: "Notes", source_field: "notes", type: "text", required: false }),
    ).toBe("Notes");
  });
});

describe("initialCustomFieldValues", () => {
  it("starts all fields empty including required select", () => {
    expect(
      initialCustomFieldValues([
        {
          label: "Size",
          source_field: "size",
          type: "select",
          required: true,
          options: ["S", "M", "L"],
        },
      ]),
    ).toEqual({ size: "" });
  });

  it("starts optional fields empty", () => {
    expect(
      initialCustomFieldValues([
        { label: "Note", source_field: "note", type: "text" },
      ]),
    ).toEqual({ note: "" });
  });
});

describe("validateCustomFieldsForm", () => {
  const sizeField = {
    label: "Size",
    source_field: "size",
    type: "select" as const,
    required: true,
    options: ["S", "M", "L"],
  };

  it("requires non-empty values for required fields", () => {
    expect(validateCustomFieldsForm([sizeField], { size: "" })).toMatch(/required/i);
  });

  it("rejects invalid select options", () => {
    expect(validateCustomFieldsForm([sizeField], { size: "XL" })).toMatch(/must be one of/i);
  });

  it("rejects invalid boolean values", () => {
    expect(
      validateCustomFieldsForm(
        [{ label: "Lunch", source_field: "lunch", type: "boolean", required: true }],
        { lunch: "maybe" },
      ),
    ).toMatch(/yes or no/i);
  });

  it("accepts boolean aliases used by the API", () => {
    expect(
      validateCustomFieldsForm(
        [{ label: "Lunch", source_field: "lunch", type: "boolean" }],
        { lunch: "yes" },
      ),
    ).toBeNull();
  });

  it("returns null when all values are valid", () => {
    expect(validateCustomFieldsForm([sizeField], { size: "M" })).toBeNull();
  });

  it("treats a field missing from the values object as empty, same as an empty string (Codecov review)", () => {
    expect(validateCustomFieldsForm([sizeField], {})).toMatch(/required/i);
  });

  it("skips validation for an optional field left empty, instead of erroring (Codecov review)", () => {
    expect(
      validateCustomFieldsForm(
        [{ label: "Notes", source_field: "notes", type: "text", required: false }],
        { notes: "" },
      ),
    ).toBeNull();
  });

  it("defaults an untyped field to text (no extra validation beyond required)", () => {
    expect(
      validateCustomFieldsForm(
        [{ label: "Notes", source_field: "notes", required: false }],
        { notes: "anything goes" },
      ),
    ).toBeNull();
  });

  it("rejects any value for a select field with no configured options", () => {
    expect(
      validateCustomFieldsForm(
        [{ label: "Size", source_field: "size", type: "select", required: false }],
        { size: "M" },
      ),
    ).toMatch(/must be one of/i);
  });
});

describe("customDataApiErrorMessage", () => {
  const sizeField = {
    label: "Size",
    source_field: "size",
    type: "select" as const,
    required: true,
    options: ["S", "M", "L"],
  };
  const lunchField = { label: "Lunch", source_field: "lunch", type: "boolean" as const, required: false };
  const notesField = { label: "Notes", source_field: "notes", type: "text" as const, required: false };

  it("returns null for a code that isn't a custom-data error", () => {
    expect(customDataApiErrorMessage([sizeField], { code: "email_conflict" })).toBeNull();
  });

  it("names a removed field without needing a match in the current field list", () => {
    expect(
      customDataApiErrorMessage([sizeField], { code: "unknown_custom_data_field", field: "old_field" }),
    ).toMatch(/removed from this event/);
  });

  it("returns null when the field slug doesn't match any current field", () => {
    expect(
      customDataApiErrorMessage([sizeField], { code: "required_custom_data_field_missing", field: "missing" }),
    ).toBeNull();
  });

  it("names the required field", () => {
    expect(
      customDataApiErrorMessage([sizeField], { code: "required_custom_data_field_missing", field: "size" }),
    ).toBe("Size is required.");
  });

  it("lists the valid options for a select field", () => {
    expect(customDataApiErrorMessage([sizeField], { code: "validation_failed", field: "size" })).toBe(
      "Size must be one of: S, M, L.",
    );
  });

  it("explains a boolean field", () => {
    expect(customDataApiErrorMessage([lunchField], { code: "validation_failed", field: "lunch" })).toBe(
      "Lunch must be Yes or No.",
    );
  });

  it("falls back to a generic invalid-value message for a text field", () => {
    expect(customDataApiErrorMessage([notesField], { code: "validation_failed", field: "notes" })).toBe(
      "Notes has an invalid value.",
    );
  });

  it("returns null when the error carries no field slug", () => {
    expect(customDataApiErrorMessage([sizeField], { code: "validation_failed" })).toBeNull();
  });

  it("treats a field with no configured type as text", () => {
    const untypedField = { ...notesField, type: undefined } as unknown as CustomDataFieldDef;
    expect(
      customDataApiErrorMessage([untypedField], { code: "validation_failed", field: "notes" }),
    ).toBe("Notes has an invalid value.");
  });

  it("lists no options when a select field has none configured", () => {
    const emptyOptionsField = { ...sizeField, options: null };
    expect(
      customDataApiErrorMessage([emptyOptionsField], { code: "validation_failed", field: "size" }),
    ).toBe("Size must be one of: .");
  });
});

describe("allCustomDataEntries", () => {
  const lunchField = {
    label: "Lunch",
    source_field: "lunch",
    type: "boolean" as const,
    required: false,
  };

  it("shows Yes/No for a boolean field instead of the raw stored true/false string", () => {
    expect(allCustomDataEntries({ lunch: "true" }, [lunchField], (k) => k)).toEqual([
      ["lunch", "Lunch", "Yes"],
    ]);
    expect(allCustomDataEntries({ lunch: "false" }, [lunchField], (k) => k)).toEqual([
      ["lunch", "Lunch", "No"],
    ]);
  });

  it("also normalizes yes/no/1/0 aliases a CSV import could have written directly", () => {
    expect(allCustomDataEntries({ lunch: "YES" }, [lunchField], (k) => k)).toEqual([
      ["lunch", "Lunch", "Yes"],
    ]);
    expect(allCustomDataEntries({ lunch: "0" }, [lunchField], (k) => k)).toEqual([
      ["lunch", "Lunch", "No"],
    ]);
  });

  it("leaves non-boolean fields untouched", () => {
    expect(
      allCustomDataEntries(
        { dietary: "vegan" },
        [{ label: "Dietary", source_field: "dietary", type: "text", required: false }],
        (k) => k,
      ),
    ).toEqual([["dietary", "Dietary", "vegan"]]);
  });

  it("excludes company/department and humanizes unregistered keys", () => {
    expect(
      allCustomDataEntries(
        { company: "Globex", department: "Ops", shirt_size: "L" },
        [],
        (k) => k.replace(/_/g, " "),
      ),
    ).toEqual([["shirt_size", "shirt size", "L"]]);
  });

  it("leaves an unrecognized boolean-field value as-is instead of guessing Yes/No (Codecov review)", () => {
    expect(allCustomDataEntries({ lunch: "maybe" }, [lunchField], (k) => k)).toEqual([
      ["lunch", "Lunch", "maybe"],
    ]);
  });

  it("returns an empty list for null, a non-object primitive, or an array custom_data value (Codecov review)", () => {
    expect(allCustomDataEntries(null, [], (k) => k)).toEqual([]);
    expect(allCustomDataEntries("not-an-object", [], (k) => k)).toEqual([]);
    expect(allCustomDataEntries(["not", "an", "object"], [], (k) => k)).toEqual([]);
  });
});

/** A field of the answer types of 0.8, named "Answer": the type and what else differs is the test's. */
const field = (type: CustomDataFieldDef["type"], extra: Partial<CustomDataFieldDef> = {}) =>
  ({ label: "Answer", source_field: "answer", type, required: false, ...extra }) as CustomDataFieldDef;

describe("validateCustomFieldsForm for the answer types long text, date, date and time and phone", () => {
  const check = (f: CustomDataFieldDef, value: string) => validateCustomFieldsForm([f], { answer: value });

  it("accepts a good answer of every type, and an optional one left empty", () => {
    expect(check(field("long_text"), "A few lines\nof text")).toBeNull();
    expect(check(field("date"), "2026-11-04")).toBeNull();
    expect(check(field("datetime"), "2026-11-04T10:30")).toBeNull();
    expect(check(field("phone"), "+1 555 0100")).toBeNull();
    for (const type of ["long_text", "date", "datetime", "phone"] as const) expect(check(field(type), ""), type).toBeNull();
  });

  it("still asks for a required answer first", () => {
    expect(check(field("date", { required: true }), "")).toBe("Answer is required.");
    expect(check(field("datetime", { required: true }), "")).toBe("Answer is required.");
    expect(check(field("phone", { required: true }), "   ")).toBe("Answer is required.");
  });

  it("says what is wrong with a date, a date and time and a phone number, in the field's own name", () => {
    expect(check(field("date"), "2026-02-30")).toBe("Answer must be a valid date.");
    expect(check(field("datetime"), "2026-11-04T")).toBe("Answer needs both a date and a time.");
    expect(check(field("datetime"), "T10:30")).toBe("Answer needs both a date and a time.");
    expect(check(field("datetime"), "2026-11-04T25:00")).toBe("Answer must be a valid date and time.");
    expect(check(field("phone"), "12")).toBe("Answer must be a phone number with 3 to 15 digits.");
  });

  it("counts a long text in characters as a person does, and holds it to 1000, or to its own maximum", () => {
    const emoji = String.fromCodePoint(0x1f600);
    expect(check(field("long_text"), emoji.repeat(1000))).toBeNull();
    expect(check(field("long_text"), "x".repeat(1001))).toBe("Answer must be at most 1000 characters.");
    expect(check(field("long_text", { rules: { max_length: 20 } }), "x".repeat(21))).toBe("Answer must be at most 20 characters.");
  });

  it("holds a text to 100 characters, which the server refuses above, and to the field's rules", () => {
    expect(check(field("text"), "x".repeat(100))).toBeNull();
    expect(check(field("text"), "x".repeat(101))).toBe("Answer must be at most 100 characters.");
    const postcode = field("text", { label: "Postcode", rules: { digits_only: true, min_length: 5, max_length: 5 } });
    expect(check(postcode, "01234")).toBeNull();
    expect(check(postcode, "0123")).toBe("Postcode must be digits only, exactly 5 characters.");
    expect(check(postcode, "0123a")).toBe("Postcode must be digits only, exactly 5 characters.");
  });

  it("checks the rules of a phone number on the number as it is saved", () => {
    const mobile = field("phone", { label: "Mobile", rules: { digits_only: true } });
    expect(check(mobile, "555 0100")).toBeNull();
    expect(check(mobile, "+1 555 0100")).toBe("Mobile must be a phone number with 3 to 15 digits, digits only.");
  });

  it("stops at the first field with a problem, in the order of the fields", () => {
    const fields = [field("date", { label: "Day", source_field: "day" }), field("phone", { label: "Mobile", source_field: "mobile" })];
    expect(validateCustomFieldsForm(fields, { day: "2026-02-30", mobile: "12" })).toBe("Day must be a valid date.");
    expect(validateCustomFieldsForm(fields, { day: "2026-11-04", mobile: "12" })).toBe("Mobile must be a phone number with 3 to 15 digits.");
  });
});

describe("customDataApiErrorMessage for the answer types long text, date, date and time and phone", () => {
  const invalid = (f: CustomDataFieldDef) => customDataApiErrorMessage([f], { code: "validation_failed", field: "answer" });

  it("says what the field asks for, the way the form checks it", () => {
    expect(invalid(field("date"))).toBe("Answer must be a valid date.");
    expect(invalid(field("datetime"))).toBe("Answer must be a valid date and time.");
    expect(invalid(field("long_text"))).toBe("Answer must be at most 1000 characters.");
    expect(invalid(field("text", { rules: { digits_only: true, max_length: 5 } }))).toBe("Answer must be digits only, at most 5 characters.");
  });

  it("asks for a phone number to be typed again, whatever the rules: a number saved before the field became a phone field is refused though it looks right", () => {
    expect(invalid(field("phone"))).toBe("Answer could not be saved as a phone number. Type the number again.");
    expect(invalid(field("phone", { rules: { max_length: 10 } }))).toBe("Answer could not be saved as a phone number. Type the number again.");
  });

  it("keeps the plain wording for a text field that asks for nothing beyond its length", () => {
    expect(invalid(field("text"))).toBe("Answer has an invalid value.");
  });
});

describe("allCustomDataEntries for the answer types date and date and time", () => {
  // The account's date format decides how a date reads; the test pins one so that it does not depend on the machine's.
  beforeAll(() => setPreferredLocale("en-GB"));
  afterAll(() => setPreferredLocale(null));
  const shown = (type: CustomDataFieldDef["type"], value: string, zone?: string) => allCustomDataEntries({ answer: value }, [field(type)], (key) => key, zone)[0]![2];

  it("shows a date as a date, in the account's date format", () => {
    expect(shown("date", "2026-11-04")).toBe("04 Nov 2026");
  });

  it("shows a date and time as the time at the event, with the event's zone named, and the same text whatever the viewer's zone", () => {
    expect(shown("datetime", "2026-11-04T10:30", "Europe/Warsaw")).toBe("04 Nov 2026, 10:30 (Europe/Warsaw)");
    expect(shown("datetime", "2026-11-04T10:30", "America/New_York")).toBe("04 Nov 2026, 10:30 (America/New_York)");
    expect(shown("datetime", "2026-11-04T10:30")).toBe("04 Nov 2026, 10:30");
    expect(shown("datetime", "2026-11-04T22:05", "UTC")).toBe("04 Nov 2026, 22:05 (UTC)");
  });

  it("shows what is stored, as it is stored, when it is not in the form of its type (the field was retyped after it was answered)", () => {
    expect(shown("date", "tomorrow")).toBe("tomorrow");
    expect(shown("date", "2026-02-30")).toBe("2026-02-30");
    expect(shown("datetime", "next week", "Europe/Warsaw")).toBe("next week");
    expect(shown("datetime", "2026-02-30T10:30", "Europe/Warsaw")).toBe("2026-02-30T10:30");
  });

  it("leaves a phone number and a long text as they are stored", () => {
    expect(shown("phone", "+15550100")).toBe("+15550100");
    expect(shown("long_text", "one\ntwo")).toBe("one\ntwo");
  });
});

describe("isLongAnswer", () => {
  it("is true for an answer with a line break or of more than 60 characters, and false for a short one", () => {
    expect(isLongAnswer("Vegetarian")).toBe(false);
    expect(isLongAnswer("x".repeat(60))).toBe(false);
    expect(isLongAnswer("x".repeat(61))).toBe(true);
    expect(isLongAnswer("one\ntwo")).toBe(true);
    expect(isLongAnswer("")).toBe(false);
  });
});
