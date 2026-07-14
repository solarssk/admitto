import { describe, expect, it, vi } from "vitest";

const mockFetchEventCustomFields = vi.fn();
vi.mock("../../src/api/client.js", () => ({
  fetchEventCustomFields: (...args: unknown[]) => mockFetchEventCustomFields(...args),
}));

const {
  fetchAttendeeCustomFields,
  initialCustomFieldValues,
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
});
