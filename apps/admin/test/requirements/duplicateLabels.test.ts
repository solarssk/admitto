import { describe, expect, it } from "vitest";
import { disambiguatedLabel, findDuplicateLabels } from "../../src/requirements/duplicateLabels.js";

describe("findDuplicateLabels", () => {
  it("returns an empty set when every label is unique", () => {
    expect(findDuplicateLabels(["Shirt size", "Dietary requirements"])).toEqual(new Set());
  });

  it("includes a label that appears more than once", () => {
    expect(findDuplicateLabels(["Shirt size", "Shirt size", "Dietary requirements"])).toEqual(
      new Set(["Shirt size"]),
    );
  });

  it("is case-sensitive, matching how the labels are rendered", () => {
    expect(findDuplicateLabels(["Shirt size", "shirt size"])).toEqual(new Set());
  });

  it("returns an empty set for an empty list", () => {
    expect(findDuplicateLabels([])).toEqual(new Set());
  });
});

describe("disambiguatedLabel", () => {
  it("returns the plain label when it has no duplicate", () => {
    expect(disambiguatedLabel("Shirt size", "shirt_size", new Set())).toBe("Shirt size");
  });

  it("appends the discriminator in parentheses when the label collides", () => {
    expect(disambiguatedLabel("Shirt size", "shirt_size_2", new Set(["Shirt size"]))).toBe(
      "Shirt size (shirt_size_2)",
    );
  });
});
