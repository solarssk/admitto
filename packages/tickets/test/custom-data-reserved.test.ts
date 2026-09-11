import { describe, expect, it } from "vitest";
import {
  filterCustomDataAttributeFields,
  isReservedCustomDataSourceField,
} from "../src/custom-data-reserved.js";

describe("isReservedCustomDataSourceField", () => {
  it("reserves import and profile column slugs", () => {
    expect(isReservedCustomDataSourceField("email")).toBe(true);
    expect(isReservedCustomDataSourceField("company")).toBe(true);
    expect(isReservedCustomDataSourceField("shirt_size")).toBe(false);
  });

  it("reserves plain-object prototype-chain keys", () => {
    // The admin-facing slug regex (^[a-z0-9_]+$) accepts all three - a source_field this shape
    // would resolve to the inherited prototype value (not undefined) wherever a consumer keys a
    // plain object by source_field, silently bypassing a `?? fallback` (see this file's own
    // module doc comment).
    expect(isReservedCustomDataSourceField("__proto__")).toBe(true);
    expect(isReservedCustomDataSourceField("constructor")).toBe(true);
    expect(isReservedCustomDataSourceField("prototype")).toBe(true);
  });
});

describe("filterCustomDataAttributeFields", () => {
  it("drops fields that collide with canonical import columns", () => {
    expect(
      filterCustomDataAttributeFields([
        { label: "Email copy", source_field: "email" },
        { label: "Size", source_field: "shirt_size" },
      ]),
    ).toEqual([{ label: "Size", source_field: "shirt_size" }]);
  });
});
