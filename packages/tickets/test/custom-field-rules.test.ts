import { describe, expect, it } from "vitest";
import { EVENT_CUSTOM_FIELD_TYPES, GUEST_FORM_ICONS } from "@admitto/shared";
import {
  breaksFieldRules,
  eventCustomFieldRulesFitType,
  eventCustomFieldRulesSchema,
  hasNoRules,
  readStoredFieldRules,
} from "../src/custom-field-rules.js";
import { normalizeRegistrantText } from "../src/registrant-input.js";

const parse = (value: unknown) => eventCustomFieldRulesSchema.safeParse(value);

/** A character by its code point, so that invisible and bidi characters never appear in this file. */
const cp = (codePoint: number) => String.fromCodePoint(codePoint);

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
      { suggestion: ["Vegan", "Vegetarian"] },
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

describe("eventCustomFieldRulesSchema: the icon", () => {
  it("takes every name of the list, and no other", () => {
    for (const icon of GUEST_FORM_ICONS) expect(parse({ icon }).data, icon).toEqual({ icon });
    for (const icon of ["Parking", "PARKING", "map-pin", "rocket", "", " car", "car ", "../car", "__proto__", 5, null, true, ["car"], { name: "car" }]) {
      expect(parse({ icon }).success, JSON.stringify(icon)).toBe(false);
    }
  });

  it("stays a short list of lower case names, never more than 20", () => {
    expect(GUEST_FORM_ICONS.length).toBeLessThanOrEqual(20);
    expect(new Set(GUEST_FORM_ICONS).size).toBe(GUEST_FORM_ICONS.length);
    for (const icon of GUEST_FORM_ICONS) expect(icon).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });
});

describe("eventCustomFieldRulesSchema: the condition", () => {
  it("takes the key of a question and true, or the text of an option", () => {
    expect(parse({ show_when: { field: "parking", value: true } }).data).toEqual({ show_when: { field: "parking", value: true } });
    expect(parse({ show_when: { field: "day", value: "Day 1" } }).data).toEqual({ show_when: { field: "day", value: "Day 1" } });
    expect(parse({ show_when: { field: "a_1", value: "true" } }).success).toBe(true);
    expect(parse({ show_when: { field: "k".repeat(60), value: "v".repeat(60) } }).success).toBe(true);
    expect(parse({ icon: "car", show_when: { field: "parking", value: true }, max_length: 9 }).success).toBe(true);
  });

  it("trims the text of the answer", () => {
    expect(parse({ show_when: { field: "day", value: "  Day 1 " } }).data).toEqual({ show_when: { field: "day", value: "Day 1" } });
  });

  it("refuses a value that is not true or a text of 1 to 60 characters", () => {
    for (const value of [false, "", "   ", "v".repeat(61), 1, 0, null, undefined, [], ["true"], {}]) {
      expect(parse({ show_when: { field: "parking", value } }).success, JSON.stringify(value)).toBe(false);
    }
  });

  it("refuses a key that is not the key of a field: lower case letters, digits and an underscore, 1 to 60", () => {
    for (const field of ["", "Parking", "park ing", "park-ing", "parking!", "k".repeat(61), "päring", 5, null, undefined, ["parking"]]) {
      expect(parse({ show_when: { field, value: true } }).success, JSON.stringify(field)).toBe(false);
    }
  });

  it("is strict, and is not a list, an operator or nothing", () => {
    for (const show_when of [
      { field: "parking", value: true, extra: 1 },
      { field: "parking", value: true, operator: "equals" },
      { field: "parking" },
      { value: true },
      {},
      null,
      "parking",
      ["parking", true],
      [{ field: "parking", value: true }],
      JSON.parse('{"field": "parking", "value": true, "__proto__": {"x": 1}}') as unknown,
    ]) {
      expect(parse({ show_when }).success, JSON.stringify(show_when)).toBe(false);
    }
  });
});

describe("eventCustomFieldRulesSchema: the suggestions", () => {
  const list = (n: number) => Array.from({ length: n }, (_, index) => `Suggestion ${index}`);

  it("takes 1 to 30 texts", () => {
    expect(parse({ suggestions: ["Vegan"] }).data).toEqual({ suggestions: ["Vegan"] });
    expect(parse({ suggestions: list(30) }).success).toBe(true);
    expect(parse({ suggestions: list(31) }).success).toBe(false);
    expect(parse({ suggestions: [] }).success).toBe(false);
  });

  it("trims each text and counts 1 to 100 characters as a person sees them", () => {
    expect(parse({ suggestions: ["  Vegan  "] }).data).toEqual({ suggestions: ["Vegan"] });
    expect(parse({ suggestions: ["a".repeat(100)] }).success).toBe(true);
    expect(parse({ suggestions: ["a".repeat(101)] }).success).toBe(false);
    // 100 emoji are 200 UTF-16 units and still fit; 101 do not.
    expect(parse({ suggestions: [cp(0x1f600).repeat(100)] }).success).toBe(true);
    expect(parse({ suggestions: [cp(0x1f600).repeat(101)] }).success).toBe(false);
    for (const suggestion of ["", "   ", 5, null, undefined, ["a"], { text: "a" }]) {
      expect(parse({ suggestions: [suggestion] }).success, JSON.stringify(suggestion)).toBe(false);
    }
  });

  it("refuses the same suggestion twice, however it is written: another case, or composed and decomposed", () => {
    expect(parse({ suggestions: ["Vegan", "Vegetarian"] }).success).toBe(true);
    expect(parse({ suggestions: ["Vegan", "Vegan"] }).success).toBe(false);
    expect(parse({ suggestions: ["Vegan", "vegan"] }).success).toBe(false);
    expect(parse({ suggestions: ["VEGAN", "Vegetarian", " vegan "] }).success).toBe(false);
    expect(parse({ suggestions: ["Zażółć", "ZAŻÓŁĆ"] }).success).toBe(false);
    expect(parse({ suggestions: [`caf${cp(0xe9)}`, `cafe${cp(0x301)}`] }).success).toBe(false);
    expect(parse({ suggestions: ["a_b", "axb"] }).success).toBe(true);
  });

  it("refuses a suggestion with a control, format or invisible character, so it stays one plain line", () => {
    for (const code of [0x00, 0x09, 0x0a, 0x0d, 0x7f, 0x85, 0xad, 0x34f, 0x200b, 0x200d, 0x202e, 0x2028, 0x2029, 0x2066, 0xfe0f, 0xfeff, 0xffff, 0xe0041]) {
      expect(parse({ suggestions: [`Ve${cp(code)}gan`] }).success, code.toString(16)).toBe(false);
    }
    expect(parse({ suggestions: [`Ve${String.fromCharCode(0xd800)}gan`] }).success).toBe(false);
    expect(parse({ suggestions: [`Ve${String.fromCharCode(0xdc00)}gan`] }).success).toBe(false);
    expect(parse({ suggestions: ["Zażółć gęślą jaźń", "Gluten-free", "No pork (halal)", cp(0x1f331) + " Plant based"] }).success).toBe(true);
  });

  it("is not an object, a text or a number", () => {
    for (const suggestions of ["Vegan", 5, null, {}, { 0: "Vegan" }, true]) {
      expect(parse({ suggestions }).success, JSON.stringify(suggestions)).toBe(false);
    }
  });

  it("refuses every character that a guest's answer is refused for, so a suggestion can always be picked", () => {
    // A suggestion may be stricter than an answer (it refuses every format character, as an example does, among them
    // the Arabic number signs a guest may type) but never looser. Every character of the first plane, the lone
    // surrogates and a sample of the other planes, put in the middle of a text.
    const codes: number[] = [];
    for (let code = 0; code <= 0xffff; code += 1) codes.push(code);
    for (let code = 0x10000; code <= 0x10ffff; code += 61) codes.push(code);
    for (let code = 0xe0000; code <= 0xe01ef; code += 1) codes.push(code);
    const disagree: string[] = [];
    for (const code of codes) {
      const text = `Ve${code >= 0xd800 && code <= 0xdfff ? String.fromCharCode(code) : cp(code)}gan`;
      const asSuggestion = parse({ suggestions: [text] }).success;
      const asAnswer = normalizeRegistrantText(text, 100) !== null;
      if (asSuggestion && !asAnswer) disagree.push(code.toString(16));
    }
    expect(disagree).toEqual([]);
  });
});

describe("hasNoRules", () => {
  it("is true for no rules and for an object with none", () => {
    expect(hasNoRules(null)).toBe(true);
    expect(hasNoRules(undefined)).toBe(true);
    expect(hasNoRules({})).toBe(true);
    expect(hasNoRules({ digits_only: false })).toBe(false);
    expect(hasNoRules({ min_length: 1 })).toBe(false);
    expect(hasNoRules({ icon: "car" })).toBe(false);
    expect(hasNoRules({ show_when: { field: "parking", value: true } })).toBe(false);
    expect(hasNoRules({ suggestions: ["Vegan"] })).toBe(false);
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

  it("lets every type carry an icon and a condition", () => {
    for (const type of EVENT_CUSTOM_FIELD_TYPES) {
      expect(eventCustomFieldRulesFitType(type, { icon: "car" }), `${type} icon`).toBe(true);
      expect(eventCustomFieldRulesFitType(type, { show_when: { field: "parking", value: true } }), `${type} show_when`).toBe(true);
      expect(eventCustomFieldRulesFitType(type, { icon: "car", show_when: { field: "day", value: "Day 1" } }), `${type} both`).toBe(true);
    }
  });

  it("lets a text field carry suggestions, and no other type", () => {
    expect(eventCustomFieldRulesFitType("text", { suggestions: ["Vegan"] })).toBe(true);
    for (const type of ["long_text", "date", "datetime", "phone", "select", "boolean", "weird", ""]) {
      expect(eventCustomFieldRulesFitType(type, { suggestions: ["Vegan"] }), type).toBe(false);
      expect(eventCustomFieldRulesFitType(type, { icon: "car", suggestions: ["Vegan"] }), `${type} with an icon`).toBe(false);
    }
  });

  it("judges the format rules of a field that also has form rules as it did without them", () => {
    const form = { icon: "car", show_when: { field: "parking", value: true } } as const;
    expect(eventCustomFieldRulesFitType("text", { ...form, max_length: 100, suggestions: ["Vegan"] })).toBe(true);
    expect(eventCustomFieldRulesFitType("text", { ...form, max_length: 101 })).toBe(false);
    expect(eventCustomFieldRulesFitType("phone", { ...form, max_length: 17 })).toBe(false);
    expect(eventCustomFieldRulesFitType("phone", { ...form, max_length: 2 })).toBe(false);
    for (const type of ["date", "datetime", "select", "boolean"]) {
      expect(eventCustomFieldRulesFitType(type, { ...form, min_length: 1 }), type).toBe(false);
      expect(eventCustomFieldRulesFitType(type, { ...form, digits_only: false }), type).toBe(false);
      expect(eventCustomFieldRulesFitType(type, { ...form, example: "x" }), type).toBe(false);
    }
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
    expect(readStoredFieldRules({ min_length: 3, allow_other: true })).toBeUndefined();
  });

  it("reads the icon, the condition and the suggestions of a field", () => {
    const stored = { icon: "car", show_when: { field: "parking", value: true }, suggestions: ["Vegan", "Vegetarian"] };
    expect(readStoredFieldRules(stored)).toEqual(stored);
  });

  it("reads rules that name an icon the list does not have, or a condition that is not one, as none", () => {
    for (const stored of [
      { icon: "rocket" },
      { icon: "car", min_length: 3, show_when: { field: "parking", value: false } },
      { show_when: { field: "parking" } },
      { suggestions: [] },
    ]) {
      expect(readStoredFieldRules(stored), JSON.stringify(stored)).toBeUndefined();
    }
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
