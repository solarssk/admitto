import { describe, expect, it } from "vitest";
import {
  CUSTOM_FIELD_TYPES,
  customFieldTypeIcon,
  customFieldTypeLabel,
} from "../../src/requirements/customFieldType.js";

describe("customFieldType helpers", () => {
  it("maps each built-in type to its operator-facing label and icon", () => {
    for (const entry of CUSTOM_FIELD_TYPES) {
      expect(customFieldTypeLabel(entry.value)).toBe(entry.label);
      expect(customFieldTypeIcon(entry.value)).toBe(entry.icon);
    }
  });

  it("falls back to the raw type string for unknown values", () => {
    expect(customFieldTypeLabel("mystery")).toBe("mystery");
    expect(customFieldTypeIcon("mystery")).toBe("ti-letter-case");
  });
});
