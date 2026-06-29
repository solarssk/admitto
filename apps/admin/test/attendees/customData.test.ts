import { describe, expect, it } from "vitest";
import {
  flattenCustomDataFieldsFromItems,
  initialCustomFieldValues,
  readCustomDataField,
  validateCustomFieldsForm,
} from "../../src/attendees/customData.js";
import type { EventItemDto } from "../../src/api/types.js";

function item(
  partial: Partial<EventItemDto> & Pick<EventItemDto, "id" | "key" | "label">,
): EventItemDto {
  return {
    type: "physical",
    enabled: true,
    icon: null,
    config: null,
    ...partial,
  };
}

describe("flattenCustomDataFieldsFromItems", () => {
  it("returns empty for no items", () => {
    expect(flattenCustomDataFieldsFromItems([])).toEqual([]);
  });

  it("skips items without contents", () => {
    expect(
      flattenCustomDataFieldsFromItems([
        item({ id: "1", key: "badge", label: "Badge", config: {} }),
      ]),
    ).toEqual([]);
  });

  it("deduplicates source_field across items (first label wins)", () => {
    expect(
      flattenCustomDataFieldsFromItems([
        item({
          id: "1",
          key: "giftbag",
          label: "Gift bag",
          config: { contents: [{ label: "Shirt size", source_field: "shirt_size" }] },
        }),
        item({
          id: "2",
          key: "socks",
          label: "Socks",
          config: { contents: [{ label: "Shirt (dup)", source_field: "shirt_size" }] },
        }),
      ]),
    ).toEqual([{ label: "Shirt size", source_field: "shirt_size" }]);
  });

  it("preserves content metadata from event items", () => {
    expect(
      flattenCustomDataFieldsFromItems([
        item({
          id: "1",
          key: "giftbag",
          label: "Gift bag",
          config: {
            contents: [
              {
                label: "Size",
                source_field: "size",
                type: "select",
                required: true,
                options: ["S", "M", "L"],
              },
            ],
          },
        }),
      ]),
    ).toEqual([
      {
        label: "Size",
        source_field: "size",
        type: "select",
        required: true,
        options: ["S", "M", "L"],
      },
    ]);
  });

  it("merges fields from multiple items", () => {
    expect(
      flattenCustomDataFieldsFromItems([
        item({
          id: "1",
          key: "giftbag",
          label: "Gift bag",
          config: { contents: [{ label: "Jacket size", source_field: "jacket_size" }] },
        }),
        item({
          id: "2",
          key: "socks",
          label: "Socks",
          enabled: false,
          config: { contents: [{ label: "Socks size", source_field: "sock_size" }] },
        }),
      ]),
    ).toEqual([
      { label: "Jacket size", source_field: "jacket_size" },
      { label: "Socks size", source_field: "sock_size" },
    ]);
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
  it("pre-selects first option for required select fields", () => {
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
    ).toEqual({ size: "S" });
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

  it("returns null when all values are valid", () => {
    expect(validateCustomFieldsForm([sizeField], { size: "M" })).toBeNull();
  });
});
