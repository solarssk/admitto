import { describe, expect, it } from "vitest";
import { buildItemDetail, collectEventCustomDataFields, resolveEventItemContents } from "../src/event-item-contents.js";
import { customDataValue } from "../src/custom-data.js";
import type { EventItemContent } from "../src/types.js";

describe("resolveEventItemContents", () => {
  it("preserves content metadata from config", () => {
    expect(
      resolveEventItemContents({
        contents: [
          {
            label: "Size",
            source_field: "size",
            type: "select",
            required: true,
            options: ["S", "M", "L"],
          },
        ],
      }),
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

  it("returns contents from config", () => {
    expect(
      resolveEventItemContents({
        contents: [
          { label: "Shirt size", source_field: "shirt_size" },
          { label: "Socks size", source_field: "sock_size" },
        ],
      }),
    ).toEqual([
      { label: "Shirt size", source_field: "shirt_size" },
      { label: "Socks size", source_field: "sock_size" },
    ]);
  });

  it("returns empty for missing config", () => {
    expect(resolveEventItemContents(null)).toEqual([]);
    expect(resolveEventItemContents({})).toEqual([]);
  });

  it("returns empty for the new content_fields shape (nothing left to resolve)", () => {
    expect(resolveEventItemContents({ content_fields: ["shirt_size"] })).toEqual([]);
  });

  it("trims labels and source fields", () => {
    expect(
      resolveEventItemContents({
        contents: [{ label: "  Shirt size  ", source_field: " shirt_size " }],
      }),
    ).toEqual([{ label: "Shirt size", source_field: "shirt_size" }]);
  });

  it("drops invalid source_field slugs", () => {
    expect(
      resolveEventItemContents({
        contents: [{ label: "Bad", source_field: "Shirt-Size" }],
      }),
    ).toEqual([]);
  });

  it("drops select fields without options", () => {
    expect(
      resolveEventItemContents({
        contents: [{ label: "Size", source_field: "size", type: "select" }],
      }),
    ).toEqual([]);
  });

  it("drops source_field slugs longer than 60 characters", () => {
    expect(
      resolveEventItemContents({
        contents: [{ label: "Long", source_field: `a_${"x".repeat(60)}` }],
      }),
    ).toEqual([]);
  });
});

describe("collectEventCustomDataFields", () => {
  it("deduplicates source_field across items (first label wins)", () => {
    expect(
      collectEventCustomDataFields([
        { contents: [{ label: "Shirt size", source_field: "shirt_size" }] },
        { contents: [{ label: "Shirt (dup)", source_field: "shirt_size" }] },
      ]),
    ).toEqual([{ label: "Shirt size", source_field: "shirt_size" }]);
  });

  it("merges stricter metadata when source_field is shared across items", () => {
    expect(
      collectEventCustomDataFields([
        { contents: [{ label: "Shirt size", source_field: "shirt_size" }] },
        {
          contents: [
            {
              label: "Shirt (dup)",
              source_field: "shirt_size",
              type: "select",
              required: true,
              options: ["S", "M", "L"],
            },
          ],
        },
      ]),
    ).toEqual([
      {
        label: "Shirt size",
        source_field: "shirt_size",
        type: "select",
        required: true,
        options: ["S", "M", "L"],
      },
    ]);
  });

  it("intersects select options when both items define the same source_field", () => {
    expect(
      collectEventCustomDataFields([
        {
          contents: [
            {
              label: "Size",
              source_field: "size",
              type: "select",
              options: ["S", "M", "L"],
            },
          ],
        },
        {
          contents: [
            {
              label: "Size dup",
              source_field: "size",
              type: "select",
              required: true,
              options: ["S", "M"],
            },
          ],
        },
      ]),
    ).toEqual([
      {
        label: "Size",
        source_field: "size",
        type: "select",
        required: true,
        options: ["S", "M"],
      },
    ]);
  });

  it("rejects disjoint select options for the same source_field", () => {
    expect(() =>
      collectEventCustomDataFields([
        {
          contents: [
            { label: "Size", source_field: "size", type: "select", options: ["S"] },
          ],
        },
        {
          contents: [
            { label: "Size dup", source_field: "size", type: "select", options: ["XL"] },
          ],
        },
      ]),
    ).toThrow("conflicting_custom_data_field_options:size");
  });

  it("merges fields from multiple items", () => {
    expect(
      collectEventCustomDataFields([
        { contents: [{ label: "Jacket size", source_field: "jacket_size" }] },
        { contents: [{ label: "Socks size", source_field: "sock_size" }] },
      ]),
    ).toEqual([
      { label: "Jacket size", source_field: "jacket_size" },
      { label: "Socks size", source_field: "sock_size" },
    ]);
  });

  it("returns empty for no configs", () => {
    expect(collectEventCustomDataFields([])).toEqual([]);
  });
});

describe("buildItemDetail", () => {
  it("formats boolean values and required markers", () => {
    const registry = new Map<string, EventItemContent>([
      ["lunch", { label: "Lunch", source_field: "lunch", type: "boolean", required: true }],
      [
        "size",
        { label: "Size", source_field: "size", type: "select", required: true, options: ["S", "M"] },
      ],
    ]);
    expect(
      buildItemDetail({ content_fields: ["lunch", "size"] }, { lunch: "true", size: "M" }, registry),
    ).toBe("Lunch*: Yes · Size*: M");

    const lunchOnly = new Map<string, EventItemContent>([
      ["lunch", { label: "Lunch", source_field: "lunch", type: "boolean" }],
    ]);
    expect(buildItemDetail({ content_fields: ["lunch"] }, { lunch: "yes" }, lunchOnly)).toBe(
      "Lunch: Yes",
    );

    const sizeRequired = new Map<string, EventItemContent>([
      ["size", { label: "Size", source_field: "size", required: true }],
    ]);
    expect(buildItemDetail({ content_fields: ["size"] }, {}, sizeRequired)).toBe("Size*: —");
  });

  it("joins multiple attributes with middle dot", () => {
    const registry = new Map<string, EventItemContent>([
      ["shirt_size", { label: "Shirt size", source_field: "shirt_size" }],
      ["sock_size", { label: "Socks size", source_field: "sock_size" }],
    ]);
    const detail = buildItemDetail(
      { content_fields: ["shirt_size", "sock_size"] },
      { shirt_size: "L", sock_size: "42" },
      registry,
    );
    expect(detail).toBe("Shirt size: L · Socks size: 42");
  });

  it("skips attributes missing from custom_data", () => {
    const registry = new Map<string, EventItemContent>([
      ["shirt_size", { label: "Shirt size", source_field: "shirt_size" }],
    ]);
    const detail = buildItemDetail({ content_fields: ["shirt_size"] }, { sock_size: "42" }, registry);
    expect(detail).toBeUndefined();
  });

  it("builds detail for any item key via content_fields (not giftbag-specific)", () => {
    const registry = new Map<string, EventItemContent>([
      ["sock_size", { label: "Socks size", source_field: "sock_size" }],
    ]);
    const detail = buildItemDetail({ content_fields: ["sock_size"] }, { sock_size: "M" }, registry);
    expect(detail).toBe("Socks size: M");
  });

  it("silently skips a content_fields entry missing from the registry (stale reference)", () => {
    const detail = buildItemDetail(
      { content_fields: ["deleted_field"] },
      { deleted_field: "X" },
      new Map(),
    );
    expect(detail).toBeUndefined();
  });

  it("returns undefined when content_fields is absent", () => {
    expect(buildItemDetail({}, {}, new Map())).toBeUndefined();
  });
});

describe("customDataValue", () => {
  it("reads arbitrary slug fields", () => {
    expect(customDataValue({ sock_size: " 42 " }, "sock_size")).toBe("42");
    expect(customDataValue({}, "sock_size")).toBeNull();
  });
});
