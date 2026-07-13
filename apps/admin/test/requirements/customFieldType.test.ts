import { describe, expect, it } from "vitest";
import { customFieldTypeIcon } from "../../src/requirements/customFieldType.js";

describe("customFieldTypeIcon", () => {
  it("returns the icon for each known type", () => {
    expect(customFieldTypeIcon("text")).toBe("ti-letter-case");
    expect(customFieldTypeIcon("select")).toBe("ti-list");
    expect(customFieldTypeIcon("boolean")).toBe("ti-checkbox");
  });

  it("falls back to the text icon for an unrecognized type", () => {
    expect(customFieldTypeIcon("unknown")).toBe("ti-letter-case");
  });
});
