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
