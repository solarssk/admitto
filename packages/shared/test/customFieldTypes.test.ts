import { describe, expect, it } from "vitest";
import {
  EVENT_CUSTOM_FIELD_LONG_TEXT_MAX,
  EVENT_CUSTOM_FIELD_TEXT_MAX,
  EVENT_CUSTOM_FIELD_TYPES,
  eventCustomFieldRulesMaxLength,
  isFreeInputCustomFieldType,
} from "../src/customFieldTypes.js";

describe("EVENT_CUSTOM_FIELD_TYPES", () => {
  it("lists the three original types and the four that came with the registration form", () => {
    expect([...EVENT_CUSTOM_FIELD_TYPES].sort()).toEqual(
      ["boolean", "date", "datetime", "long_text", "phone", "select", "text"],
    );
  });
});

describe("eventCustomFieldRulesMaxLength", () => {
  it("gives the longest answer of each type that takes rules", () => {
    expect(eventCustomFieldRulesMaxLength("text")).toBe(EVENT_CUSTOM_FIELD_TEXT_MAX);
    expect(eventCustomFieldRulesMaxLength("long_text")).toBe(EVENT_CUSTOM_FIELD_LONG_TEXT_MAX);
    // An optional + and 15 digits.
    expect(eventCustomFieldRulesMaxLength("phone")).toBe(16);
  });

  it("is null for every other type, and for a type it does not know", () => {
    for (const type of ["date", "datetime", "select", "boolean", "unknown", ""]) {
      expect(eventCustomFieldRulesMaxLength(type)).toBeNull();
    }
  });
});

describe("isFreeInputCustomFieldType", () => {
  it("is true for the types a person types, false for a choice, yes/no and anything unknown", () => {
    for (const type of ["text", "long_text", "date", "datetime", "phone"]) expect(isFreeInputCustomFieldType(type)).toBe(true);
    for (const type of ["select", "boolean", "unknown", ""]) expect(isFreeInputCustomFieldType(type)).toBe(false);
  });
});
