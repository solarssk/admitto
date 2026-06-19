import { describe, expect, it } from "vitest";
import {
  flattenCustomDataFieldsFromItems,
  readCustomDataField,
} from "../../src/attendees/customData.js";
import type { EventItemDto } from "../../src/api/types.js";

function item(
  partial: Partial<EventItemDto> & Pick<EventItemDto, "id" | "key" | "label">,
): EventItemDto {
  return {
    type: "physical",
    enabled: true,
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
