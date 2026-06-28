import { describe, expect, it } from "vitest";
import { buildItemDetail, collectEventCustomDataFields, resolveEventItemContents } from "../src/event-item-contents.js";
import { customDataValue } from "../src/custom-data.js";

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

  it("falls back to legacy size_field", () => {
    expect(resolveEventItemContents({ size_field: "shirt_size" })).toEqual([
      { label: "Shirt size", source_field: "shirt_size" },
    ]);
  });

  it("prefers contents over size_field", () => {
    expect(
      resolveEventItemContents({
        size_field: "shirt_size",
        contents: [{ label: "Sock size", source_field: "sock_size" }],
      }),
    ).toEqual([{ label: "Sock size", source_field: "sock_size" }]);
  });

  it("returns empty for missing config", () => {
    expect(resolveEventItemContents(null)).toEqual([]);
    expect(resolveEventItemContents({})).toEqual([]);
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

  it("resolves legacy size_field per config", () => {
    expect(collectEventCustomDataFields([{ size_field: "shirt_size" }, {}])).toEqual([
      { label: "Shirt size", source_field: "shirt_size" },
    ]);
  });

  it("returns empty for no configs", () => {
    expect(collectEventCustomDataFields([])).toEqual([]);
  });
});

describe("buildItemDetail", () => {
  it("formats boolean values and required markers", () => {
    expect(
      buildItemDetail(
        {
          contents: [
            { label: "Lunch", source_field: "lunch", type: "boolean", required: true },
            { label: "Size", source_field: "size", type: "select", required: true, options: ["S", "M"] },
          ],
        },
        { lunch: "true", size: "M" },
      ),
    ).toBe("Lunch*: Yes · Size*: M");

    expect(
      buildItemDetail(
        { contents: [{ label: "Size", source_field: "size", required: true }] },
        {},
      ),
    ).toBe("Size*: —");
  });

  it("joins multiple attributes with middle dot", () => {
    const detail = buildItemDetail(
      {
        contents: [
          { label: "Shirt size", source_field: "shirt_size" },
          { label: "Socks size", source_field: "sock_size" },
        ],
      },
      { shirt_size: "L", sock_size: "42" },
    );
    expect(detail).toBe("Shirt size: L · Socks size: 42");
  });

  it("skips attributes missing from custom_data", () => {
    const detail = buildItemDetail(
      { contents: [{ label: "Shirt size", source_field: "shirt_size" }] },
      { sock_size: "42" },
    );
    expect(detail).toBeUndefined();
  });

  it("builds detail for any item key via contents (not giftbag-specific)", () => {
    const detail = buildItemDetail(
      { contents: [{ label: "Socks size", source_field: "sock_size" }] },
      { sock_size: "M" },
    );
    expect(detail).toBe("Socks size: M");
  });

  it("uses legacy size_field when contents absent", () => {
    expect(buildItemDetail({ size_field: "shirt_size" }, { shirt_size: "XL" })).toBe(
      "Shirt size: XL",
    );
  });
});

describe("customDataValue", () => {
  it("reads arbitrary slug fields", () => {
    expect(customDataValue({ sock_size: " 42 " }, "sock_size")).toBe("42");
    expect(customDataValue({}, "sock_size")).toBeNull();
  });
});
