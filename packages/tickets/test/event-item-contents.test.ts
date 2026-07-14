import { describe, expect, it } from "vitest";
import { buildItemDetail } from "../src/event-item-contents.js";
import { customDataValue } from "../src/custom-data.js";
import type { EventItemContent } from "../src/types.js";

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

  it("returns undefined when content_fields is explicitly empty", () => {
    expect(buildItemDetail({ content_fields: [] }, { shirt_size: "L" }, new Map())).toBeUndefined();
  });
});

describe("customDataValue", () => {
  it("reads arbitrary slug fields", () => {
    expect(customDataValue({ sock_size: " 42 " }, "sock_size")).toBe("42");
    expect(customDataValue({}, "sock_size")).toBeNull();
  });
});
