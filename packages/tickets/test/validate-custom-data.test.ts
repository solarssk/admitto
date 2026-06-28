import { describe, expect, it } from "vitest";
import {
  buildCustomDataFromInput,
  normalizeCustomDataFieldValue,
  validateCustomDataPatch,
} from "../src/validate-custom-data.js";
import type { EventItemContent } from "../src/types.js";

const sizeField: EventItemContent = {
  label: "Size",
  source_field: "size",
  type: "select",
  required: true,
  options: ["S", "M", "L"],
};

const lunchField: EventItemContent = {
  label: "Lunch",
  source_field: "lunch",
  type: "boolean",
  required: true,
};

describe("normalizeCustomDataFieldValue", () => {
  it("accepts select options exactly", () => {
    expect(normalizeCustomDataFieldValue(sizeField, "M")).toBe("M");
    expect(() => normalizeCustomDataFieldValue(sizeField, "XL")).toThrow(
      "invalid_custom_data_value",
    );
  });

  it("normalizes boolean values to true/false strings", () => {
    expect(normalizeCustomDataFieldValue(lunchField, "yes")).toBe("true");
    expect(normalizeCustomDataFieldValue(lunchField, "No")).toBe("false");
  });
});

describe("buildCustomDataFromInput", () => {
  it("requires configured required fields on create", () => {
    expect(() => buildCustomDataFromInput([sizeField], { size: "M" })).not.toThrow();
    expect(() => buildCustomDataFromInput([sizeField], {})).toThrow(
      "required_custom_data_field_missing:size",
    );
  });
});

describe("validateCustomDataPatch", () => {
  it("rejects clearing a required field", () => {
    expect(() =>
      validateCustomDataPatch([sizeField], { size: "M" }, { size: null }),
    ).toThrow("required_custom_data_field_missing:size");
  });
});
