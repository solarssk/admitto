import { describe, expect, it } from "vitest";
import { EVENT_CUSTOM_FIELD_TYPES } from "@admitto/shared";
import {
  breaksFieldRules,
  eventCustomFieldRulesFitType,
  eventCustomFieldRulesSchema,
  hasNoRules,
  readStoredFieldRules,
} from "../src/custom-field-rules.js";

const parse = (value: unknown) => eventCustomFieldRulesSchema.safeParse(value);

describe("eventCustomFieldRulesSchema", () => {
  it("accepts no rule, each rule alone and all four together", () => {
    expect(parse({}).success).toBe(true);
    expect(parse({ min_length: 3 }).success).toBe(true);
    expect(parse({ max_length: 9 }).success).toBe(true);
    expect(parse({ digits_only: true }).success).toBe(true);
    expect(parse({ digits_only: false }).success).toBe(true);
    expect(parse({ example: "AB 12345" }).success).toBe(true);
    expect(parse({ min_length: 3, max_length: 9, digits_only: true, example: "600100200" }).success).toBe(true);
  });

  it("returns the rules as given, with the example trimmed", () => {
    expect(parse({ min_length: 3, example: "  AB 12345  " }).data).toEqual({ min_length: 3, example: "AB 12345" });
  });

  it("is strict: a key that is not a rule is an error, whatever it is", () => {
    for (const rules of [
      { pattern: "^[0-9]+$" },
      { regex: "a" },
      { suggestions: ["Vegan", "Vegetarian"] },
      { allow_other: true },
      { show_when: { field: "parking", equals: "true" } },
      { MIN_LENGTH: 3 },
      { min_length: 3, extra: true },
      JSON.parse('{"__proto__": {"min_length": 1}}') as unknown,
    ]) {
      expect(parse(rules).success, JSON.stringify(rules)).toBe(false);
    }
  });

  it("accepts a length from 1 to 1000 and no other number", () => {
    for (const key of ["min_length", "max_length"]) {
      expect(parse({ [key]: 1 }).success).toBe(true);
      expect(parse({ [key]: 1000 }).success).toBe(true);
      for (const value of [0, -1, 1001, 3.5, Number.NaN, Number.POSITIVE_INFINITY, "3", null, true, [3]]) {
        expect(parse({ [key]: value }).success, `${key}: ${String(value)}`).toBe(false);
      }
    }
  });

  it("refuses a minimum above the maximum and accepts equal ones", () => {
    expect(parse({ min_length: 10, max_length: 9 }).success).toBe(false);
    expect(parse({ min_length: 9, max_length: 9 }).success).toBe(true);
  });

  it("takes digits_only as a boolean only", () => {
    for (const value of ["true", 1, 0, null, {}, []]) {
      expect(parse({ digits_only: value }).success, String(value)).toBe(false);
    }
  });

  it("takes an example of 1 to 100 characters on one plain line", () => {
    expect(parse({ example: "a".repeat(100) }).success).toBe(true);
    expect(parse({ example: "+48 600 100 200 (Łódź)" }).success).toBe(true);
    // The limit is in characters, not UTF-16 units: 100 emoji are 200 units and still fit.
    expect(parse({ example: "\u{1F600}".repeat(100) }).success).toBe(true);
    expect(parse({ example: "\u{1F600}".repeat(101) }).success).toBe(false);
    for (const example of [
      "",
      "   ",
      "a".repeat(101),
      "line one\nline two",
      "tab\there",
      "nul\u0000nul",
      "zero\u200bwidth",
      "bidi\u202eoverride",
      "lone\uD800surrogate",
      5,
      null,
      ["a"],
    ]) {
      expect(parse({ example }).success, JSON.stringify(example)).toBe(false);
    }
  });

  it("refuses anything that is not an object", () => {
    for (const value of [null, undefined, "digits_only", 5, true, [], [{ min_length: 3 }]]) {
      expect(parse(value).success, String(value)).toBe(false);
    }
  });
});

describe("hasNoRules", () => {
  it("is true for no rules and for an object with none", () => {
    expect(hasNoRules(null)).toBe(true);
    expect(hasNoRules(undefined)).toBe(true);
    expect(hasNoRules({})).toBe(true);
    expect(hasNoRules({ digits_only: false })).toBe(false);
    expect(hasNoRules({ min_length: 1 })).toBe(false);
  });
});

describe("eventCustomFieldRulesFitType", () => {
  const EVERY_RULE = [
    { min_length: 1 },
    { max_length: 9 },
    { digits_only: true },
    { digits_only: false },
    { example: "x" },
    { min_length: 1, max_length: 5, digits_only: true, example: "x" },
  ];

  it("lets text, long text and phone take every rule", () => {
    for (const type of ["text", "long_text", "phone"]) {
      for (const rules of EVERY_RULE) expect(eventCustomFieldRulesFitType(type, rules), `${type} ${JSON.stringify(rules)}`).toBe(true);
    }
  });

  it("refuses every rule on the other types, and on a type it does not know", () => {
    for (const type of ["date", "datetime", "select", "boolean", "weird", ""]) {
      for (const rules of EVERY_RULE) expect(eventCustomFieldRulesFitType(type, rules), `${type} ${JSON.stringify(rules)}`).toBe(false);
    }
  });

  it("fits no rules, null and an empty object to every type", () => {
    for (const type of [...EVENT_CUSTOM_FIELD_TYPES, "weird"]) {
      expect(eventCustomFieldRulesFitType(type, undefined)).toBe(true);
      expect(eventCustomFieldRulesFitType(type, null)).toBe(true);
      expect(eventCustomFieldRulesFitType(type, {})).toBe(true);
    }
  });

  it("holds a length to what the type can hold: 100 for text, 1000 for long text, 16 for a phone number", () => {
    expect(eventCustomFieldRulesFitType("text", { max_length: 100 })).toBe(true);
    expect(eventCustomFieldRulesFitType("text", { max_length: 101 })).toBe(false);
    expect(eventCustomFieldRulesFitType("text", { min_length: 101 })).toBe(false);
    expect(eventCustomFieldRulesFitType("long_text", { max_length: 1000 })).toBe(true);
    expect(eventCustomFieldRulesFitType("long_text", { min_length: 1000 })).toBe(true);
    expect(eventCustomFieldRulesFitType("phone", { max_length: 16 })).toBe(true);
    expect(eventCustomFieldRulesFitType("phone", { max_length: 17 })).toBe(false);
    expect(eventCustomFieldRulesFitType("phone", { min_length: 17 })).toBe(false);
  });

  it("refuses phone rules that no number can meet: a phone number has 3 to 16 characters, 3 to 15 with digits only", () => {
    expect(eventCustomFieldRulesFitType("phone", { max_length: 2 })).toBe(false);
    expect(eventCustomFieldRulesFitType("phone", { digits_only: true, min_length: 16 })).toBe(false);
    expect(eventCustomFieldRulesFitType("phone", { digits_only: true, max_length: 2 })).toBe(false);
    expect(eventCustomFieldRulesFitType("phone", { max_length: 3 })).toBe(true);
    expect(eventCustomFieldRulesFitType("phone", { min_length: 16 })).toBe(true);
    expect(eventCustomFieldRulesFitType("phone", { digits_only: true, min_length: 15 })).toBe(true);
    expect(eventCustomFieldRulesFitType("phone", { digits_only: true, min_length: 3, max_length: 15 })).toBe(true);
    expect(eventCustomFieldRulesFitType("phone", { min_length: 4, max_length: 9 })).toBe(true);
  });

  it("leaves a text field's short length rules alone: only a phone number has a shortest length", () => {
    expect(eventCustomFieldRulesFitType("text", { max_length: 2 })).toBe(true);
    expect(eventCustomFieldRulesFitType("long_text", { max_length: 1 })).toBe(true);
  });
});

describe("readStoredFieldRules", () => {
  it("reads a stored rules object", () => {
    expect(readStoredFieldRules({ min_length: 3, digits_only: true })).toEqual({ min_length: 3, digits_only: true });
  });

  it("reads no rules, an empty object and anything that is not rules as none", () => {
    for (const stored of [null, undefined, {}, [], "x", 5, true, { max_length: "9" }, { min_length: 5, max_length: 2 }]) {
      expect(readStoredFieldRules(stored), JSON.stringify(stored)).toBeUndefined();
    }
  });

  it("reads rules with a key it does not know as none, so one bad row never stops a form", () => {
    expect(readStoredFieldRules({ min_length: 3, suggestions: ["a"] })).toBeUndefined();
  });
});

describe("breaksFieldRules", () => {
  it("never breaks without rules", () => {
    expect(breaksFieldRules("anything", undefined)).toBe(false);
    expect(breaksFieldRules("anything", {})).toBe(false);
  });

  it("checks digits_only on the characters 0 to 9 only", () => {
    expect(breaksFieldRules("0123456789", { digits_only: true })).toBe(false);
    expect(breaksFieldRules("12 3", { digits_only: true })).toBe(true);
    expect(breaksFieldRules("1_000", { digits_only: true })).toBe(true);
    expect(breaksFieldRules("-1", { digits_only: true })).toBe(true);
    // Fullwidth digits, as an East Asian keyboard types them.
    expect(breaksFieldRules("\uFF11\uFF12\uFF13", { digits_only: true })).toBe(true);
    expect(breaksFieldRules("12a", { digits_only: false })).toBe(false);
  });

  it("measures the length in code points", () => {
    expect(breaksFieldRules("😀😀", { max_length: 2 })).toBe(false);
    expect(breaksFieldRules("😀😀😀", { max_length: 2 })).toBe(true);
    expect(breaksFieldRules("😀", { min_length: 2 })).toBe(true);
  });
});
