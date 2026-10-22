import { describe, expect, it } from "vitest";
import {
  EMPTY_RULES_DRAFT,
  hasRulesProblem,
  rulesDraftFromRules,
  rulesFromDraft,
  rulesLengthCap,
  rulesProblems,
  rulesAfterSave,
  sameAllRules,
  sameRules,
  typeTakesRules,
  type RulesDraft,
} from "../../src/requirements/fieldRules.js";

const draft = (changes: Partial<RulesDraft>): RulesDraft => ({ ...EMPTY_RULES_DRAFT, ...changes });
const EMOJI = String.fromCodePoint(0x1f600);

describe("typeTakesRules and rulesLengthCap", () => {
  it("are the types that hold a free answer, with the longest answer each holds", () => {
    expect(rulesLengthCap("text")).toBe(100);
    expect(rulesLengthCap("long_text")).toBe(1000);
    expect(rulesLengthCap("phone")).toBe(16);
    for (const type of ["text", "long_text", "phone"]) expect(typeTakesRules(type)).toBe(true);
    for (const type of ["date", "datetime", "select", "boolean", "mystery"]) {
      expect(rulesLengthCap(type)).toBeNull();
      expect(typeTakesRules(type)).toBe(false);
    }
  });
});

describe("rulesDraftFromRules and rulesFromDraft", () => {
  it("give the boxes what a field's rules are, and back", () => {
    const rules = { min_length: 3, max_length: 6, digits_only: true, example: "123456" };
    expect(rulesDraftFromRules(rules)).toEqual({ minLength: "3", maxLength: "6", digitsOnly: true, example: "123456" });
    expect(rulesFromDraft(rulesDraftFromRules(rules))).toEqual(rules);
    expect(rulesDraftFromRules(null)).toEqual(EMPTY_RULES_DRAFT);
    expect(rulesDraftFromRules(undefined)).toEqual(EMPTY_RULES_DRAFT);
    expect(rulesDraftFromRules({})).toEqual(EMPTY_RULES_DRAFT);
  });

  it("leave a rule out that is not set, never as 0, false or an empty string: a key is a rule", () => {
    expect(rulesFromDraft(EMPTY_RULES_DRAFT)).toBeNull();
    expect(rulesFromDraft(draft({ digitsOnly: false, example: "   " }))).toBeNull();
    expect(rulesFromDraft(draft({ maxLength: "8" }))).toEqual({ max_length: 8 });
    expect(rulesFromDraft(draft({ digitsOnly: true }))).toEqual({ digits_only: true });
    expect(rulesFromDraft(draft({ example: "  Alex  " }))).toEqual({ example: "Alex" });
  });

  it("ignore a length that is not a whole number (rulesProblems says so, and the editor does not save it)", () => {
    expect(rulesFromDraft(draft({ minLength: "abc", maxLength: "1.5" }))).toBeNull();
  });
});

describe("rulesAfterSave", () => {
  const condition = { field: "parking", value: "Yes" };

  it("is the rules of the form, with the icon, the condition and the suggestions of the stored rules", () => {
    expect(rulesAfterSave({ max_length: 6 }, { max_length: 5, icon: "car", show_when: condition, suggestions: ["a"] }, "text")).toEqual({
      max_length: 6,
      icon: "car",
      show_when: condition,
      suggestions: ["a"],
    });
  });

  it("leaves the suggestions out unless the field is a text field", () => {
    expect(rulesAfterSave(null, { suggestions: ["a"] }, "text")).toEqual({ suggestions: ["a"] });
    expect(rulesAfterSave(null, { suggestions: ["a"], icon: "car" }, "long_text")).toEqual({ icon: "car" });
    expect(rulesAfterSave(null, { suggestions: ["a"] }, "select")).toBeNull();
  });

  it("is null when nothing is left, and the rules of the form when the field has no others", () => {
    expect(rulesAfterSave(null, null, "text")).toBeNull();
    expect(rulesAfterSave(null, undefined, "date")).toBeNull();
    expect(rulesAfterSave({ example: "a" }, null, "text")).toEqual({ example: "a" });
  });

  it("never takes a format rule from the stored rules: the form decides those", () => {
    expect(rulesAfterSave(null, { max_length: 5, digits_only: true, example: "1" }, "text")).toBeNull();
  });
});

describe("sameAllRules", () => {
  it("is sameRules, and the icon, the condition and the suggestions as well", () => {
    expect(sameAllRules({ max_length: 5, icon: "car" }, { max_length: 5, icon: "car" })).toBe(true);
    expect(sameAllRules({ max_length: 5, icon: "car" }, { max_length: 5 })).toBe(false);
    expect(sameAllRules({ icon: "car" }, { icon: "pin" })).toBe(false);
    expect(sameAllRules({ show_when: { field: "a", value: true } }, { show_when: { field: "a", value: true } })).toBe(true);
    expect(sameAllRules({ show_when: { field: "a", value: true } }, { show_when: { field: "b", value: true } })).toBe(false);
    expect(sameAllRules({ suggestions: ["a", "b"] }, { suggestions: ["a", "b"] })).toBe(true);
    expect(sameAllRules({ suggestions: ["a"] }, { suggestions: ["a", "b"] })).toBe(false);
    expect(sameAllRules(null, undefined)).toBe(true);
    expect(sameAllRules({ max_length: 5 }, { max_length: 6 })).toBe(false);
  });
});

describe("sameRules", () => {
  it("treats no rules as no rules, whether null, undefined or empty, and a rule that is off as no rule", () => {
    expect(sameRules(null, null)).toBe(true);
    expect(sameRules(null, undefined)).toBe(true);
    expect(sameRules(null, {})).toBe(true);
    expect(sameRules({ digits_only: false }, null)).toBe(true);
  });

  it("tells one rule from another", () => {
    expect(sameRules({ max_length: 5 }, { max_length: 5 })).toBe(true);
    expect(sameRules({ max_length: 5 }, { max_length: 6 })).toBe(false);
    expect(sameRules({ min_length: 1 }, null)).toBe(false);
    expect(sameRules({ digits_only: true }, null)).toBe(false);
    expect(sameRules({ example: "a" }, { example: "b" })).toBe(false);
    expect(sameRules({ example: "a" }, null)).toBe(false);
  });
});

describe("rulesProblems: the limits of the server", () => {
  const lengths = (type: string, changes: Partial<RulesDraft>) => rulesProblems(type, draft(changes)).lengths;

  it.each([
    ["text", "100", true],
    ["text", "101", false],
    ["long_text", "1000", true],
    ["long_text", "1001", false],
    ["phone", "16", true],
    ["phone", "17", false],
  ] as const)("a longest answer of %s takes %s: %s", (type, length, fits) => {
    expect(lengths(type, { maxLength: length }) === undefined).toBe(fits);
    expect(lengths(type, { minLength: length }) === undefined).toBe(fits);
  });

  it("says what a length box takes: a whole number from 1 to what the type holds", () => {
    expect(lengths("text", { maxLength: "101" })).toEqual({ message: "Enter a whole number from 1 to 100.", min: false, max: true });
    expect(lengths("text", { minLength: "0" })).toEqual({ message: "Enter a whole number from 1 to 100.", min: true, max: false });
    expect(lengths("long_text", { maxLength: "5000" })?.message).toBe("Enter a whole number from 1 to 1000.");
    expect(lengths("phone", { minLength: "17" })?.message).toBe("Enter a whole number from 1 to 16.");
    expect(lengths("text", { minLength: "abc" })?.message).toBe("Enter a whole number from 1 to 100.");
    expect(lengths("text", { minLength: "", maxLength: "" })).toBeUndefined();
    expect(lengths("text", { minLength: "  ", maxLength: "1" })).toBeUndefined();
  });

  it("names the first box that is wrong, the shortest before the longest", () => {
    expect(lengths("text", { minLength: "0", maxLength: "999" })).toMatchObject({ min: true, max: false });
  });

  it("refuses a shortest answer longer than the longest", () => {
    expect(lengths("text", { minLength: "10", maxLength: "9" })).toEqual({
      message: "The longest answer can't be shorter than the shortest.",
      min: true,
      max: true,
    });
    expect(lengths("text", { minLength: "9", maxLength: "9" })).toBeUndefined();
    expect(lengths("text", { minLength: "10" })).toBeUndefined();
  });

  it("refuses the lengths of a phone field that no number can meet, as the server does", () => {
    // A number is saved as an optional + and 3 to 15 digits: 3 to 16 characters, and 3 to 15 with digits only.
    expect(lengths("phone", { maxLength: "2" })?.message).toBe("No phone number fits these rules: a saved number has 3 to 16 characters.");
    expect(lengths("phone", { maxLength: "3" })).toBeUndefined();
    expect(lengths("phone", { minLength: "16" })).toBeUndefined();
    expect(lengths("phone", { digitsOnly: true, minLength: "16" })?.message).toBe(
      "No phone number fits these rules: a saved number has 3 to 15 characters.",
    );
    expect(lengths("phone", { digitsOnly: true, minLength: "15" })).toBeUndefined();
    expect(lengths("phone", { digitsOnly: true, maxLength: "2" })).toMatchObject({ min: true, max: true });
    // The same lengths are fine on a text field.
    expect(lengths("text", { maxLength: "2" })).toBeUndefined();
    expect(lengths("text", { digitsOnly: true, minLength: "16" })).toBeUndefined();
  });

  it("takes no rules for a date, a date and time, a choice or yes or no, whatever the boxes hold", () => {
    for (const type of ["date", "datetime", "select", "boolean"]) {
      expect(rulesProblems(type, draft({ minLength: "9", maxLength: "1", example: EMOJI.repeat(500) }))).toEqual({});
    }
  });
});

describe("rulesProblems: the example", () => {
  const example = (text: string) => rulesProblems("text", draft({ example: text })).example;

  it("is up to 100 characters, as a person counts them, trimmed", () => {
    expect(example("x".repeat(100))).toBeUndefined();
    expect(example(`  ${"x".repeat(100)}  `)).toBeUndefined();
    expect(example(EMOJI.repeat(100))).toBeUndefined();
    expect(example("x".repeat(101))).toBe("Use at most 100 characters.");
    expect(example(EMOJI.repeat(101))).toBe("Use at most 100 characters.");
    expect(example("")).toBeUndefined();
    expect(example("   ")).toBeUndefined();
  });

  it("is plain text on one line: no control, invisible or direction character, no lone surrogate", () => {
    for (const code of [0x0a, 0x00, 0x7f, 0x200b, 0x202e, 0xfeff, 0xd800]) {
      expect(example(`a${String.fromCodePoint(code)}b`), code.toString(16)).toBe("Use plain text on one line, with no invisible characters.");
    }
    expect(example("+1 555 0100")).toBeUndefined();
    expect(example("Zażółć gęślą jaźń")).toBeUndefined();
  });
});

describe("hasRulesProblem", () => {
  it("is true when either the lengths or the example have a problem", () => {
    expect(hasRulesProblem(rulesProblems("text", EMPTY_RULES_DRAFT))).toBe(false);
    expect(hasRulesProblem(rulesProblems("text", draft({ maxLength: "0" })))).toBe(true);
    expect(hasRulesProblem(rulesProblems("text", draft({ example: "x".repeat(101) })))).toBe(true);
    expect(hasRulesProblem(rulesProblems("date", draft({ maxLength: "0" })))).toBe(false);
  });
});
