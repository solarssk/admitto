import { describe, expect, it } from "vitest";
import type { EventCustomFieldRules } from "@admitto/shared";
import {
  EMPTY_RULES_DRAFT,
  draftForType,
  formatRulesFromDraft,
  hasRulesProblem,
  rulesDraftFromRules,
  rulesLengthCap,
  rulesProblems,
  rulesToSave,
  sameAllRules,
  sameRules,
  suggestionTexts,
  typeTakesRules,
  typeTakesSuggestions,
  type RulesDraft,
} from "../../src/requirements/fieldRules.js";
import type { OptionRow } from "../../src/requirements/OptionsEditor.js";

const draft = (changes: Partial<RulesDraft>): RulesDraft => ({ ...EMPTY_RULES_DRAFT, ...changes });
const EMOJI = String.fromCodePoint(0x1f600);
/** The suggestion rows of a list of texts, as the editor holds them. */
const rowsOf = (...texts: string[]): OptionRow[] => texts.map((text, index) => ({ key: `r${index}`, text, originalText: "" }));
const ASKED_WHEN_PARKING = { field: "parking", value: true as const };

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

describe("rulesDraftFromRules and formatRulesFromDraft", () => {
  it("give the boxes what a field's format rules are, and back", () => {
    const rules = { min_length: 3, max_length: 6, digits_only: true, example: "123456" };
    expect(rulesDraftFromRules(rules)).toEqual({ ...EMPTY_RULES_DRAFT, minLength: "3", maxLength: "6", digitsOnly: true, example: "123456" });
    expect(formatRulesFromDraft(rulesDraftFromRules(rules))).toEqual(rules);
    expect(rulesDraftFromRules(null)).toEqual(EMPTY_RULES_DRAFT);
    expect(rulesDraftFromRules(undefined)).toEqual(EMPTY_RULES_DRAFT);
    expect(rulesDraftFromRules({})).toEqual(EMPTY_RULES_DRAFT);
  });

  it("give the form rules their own parts of the draft: the icon, the condition and a row for each suggestion", () => {
    const rules: EventCustomFieldRules = { icon: "car", show_when: ASKED_WHEN_PARKING, suggestions: ["Vegan", "Vegetarian"] };
    const asDraft = rulesDraftFromRules(rules);
    expect(asDraft.icon).toBe("car");
    expect(asDraft.showWhen).toEqual(ASKED_WHEN_PARKING);
    expect(asDraft.suggestions.map((row) => row.text)).toEqual(["Vegan", "Vegetarian"]);
    expect(new Set(asDraft.suggestions.map((row) => row.key)).size).toBe(2);
    expect(asDraft.suggestions.every((row) => row.originalText === "")).toBe(true);
    expect(rulesDraftFromRules({ icon: "pin" }).showWhen).toBeNull();
    expect(rulesDraftFromRules({ show_when: { field: "day", value: "Both" } }).showWhen).toEqual({ field: "day", value: "Both" });
  });

  it("leave a rule out that is not set, never as 0, false or an empty string: a key is a rule", () => {
    expect(formatRulesFromDraft(EMPTY_RULES_DRAFT)).toBeNull();
    expect(formatRulesFromDraft(draft({ digitsOnly: false, example: "   " }))).toBeNull();
    expect(formatRulesFromDraft(draft({ maxLength: "8" }))).toEqual({ max_length: 8 });
    expect(formatRulesFromDraft(draft({ digitsOnly: true }))).toEqual({ digits_only: true });
    expect(formatRulesFromDraft(draft({ example: "  Alex  " }))).toEqual({ example: "Alex" });
  });

  it("ignore a length that is not a whole number (rulesProblems says so, and the editor does not save it)", () => {
    expect(formatRulesFromDraft(draft({ minLength: "abc", maxLength: "1.5" }))).toBeNull();
  });
});

describe("typeTakesSuggestions", () => {
  it("is true for a text field and for no other type", () => {
    expect(typeTakesSuggestions("text")).toBe(true);
    for (const type of ["long_text", "date", "datetime", "phone", "select", "boolean", "mystery", ""]) {
      expect(typeTakesSuggestions(type), type).toBe(false);
    }
  });
});

describe("suggestionTexts", () => {
  it("trims each row, and a row left empty is no suggestion", () => {
    expect(suggestionTexts(rowsOf("  Vegan ", "", "   ", "Halal"))).toEqual(["Vegan", "Halal"]);
    expect(suggestionTexts([])).toEqual([]);
  });
});

describe("draftForType", () => {
  const everything = draft({
    minLength: "2",
    maxLength: "9",
    digitsOnly: true,
    example: "12",
    icon: "car",
    showWhen: ASKED_WHEN_PARKING,
    suggestions: rowsOf("Vegan"),
  });

  it("keeps all of it for a text field", () => {
    expect(draftForType(everything, "text")).toEqual(everything);
  });

  it("drops the suggestions for a long text or phone field, which take the format rules", () => {
    for (const type of ["long_text", "phone"]) {
      expect(draftForType(everything, type), type).toEqual({ ...everything, suggestions: [] });
    }
  });

  it("drops the format rules and the suggestions for a type that takes neither, and keeps the icon and the condition", () => {
    for (const type of ["date", "datetime", "select", "boolean"]) {
      expect(draftForType(everything, type), type).toEqual({ ...EMPTY_RULES_DRAFT, icon: "car", showWhen: ASKED_WHEN_PARKING });
    }
  });

  it("changes nothing it is given", () => {
    const frozen = Object.freeze({ ...everything, suggestions: Object.freeze(rowsOf("a")) as OptionRow[] });
    expect(draftForType(frozen, "select").icon).toBe("car");
    expect(frozen.suggestions).toHaveLength(1);
  });
});

describe("rulesToSave", () => {
  it("is the rules of the form: the format rules, the icon, the condition and the suggestions", () => {
    const form = draft({
      maxLength: "6",
      example: "Alex",
      icon: "car",
      showWhen: ASKED_WHEN_PARKING,
      suggestions: rowsOf("  Vegan  ", "", "Vegetarian"),
    });
    expect(rulesToSave(form, "text", null)).toEqual({
      max_length: 6,
      example: "Alex",
      icon: "car",
      show_when: ASKED_WHEN_PARKING,
      suggestions: ["Vegan", "Vegetarian"],
    });
  });

  it("is null when nothing is set, for any type and with no stored rules", () => {
    for (const type of ["text", "long_text", "phone", "date", "datetime", "select", "boolean"]) {
      expect(rulesToSave(EMPTY_RULES_DRAFT, type, null), type).toBeNull();
      expect(rulesToSave(EMPTY_RULES_DRAFT, type, undefined), type).toBeNull();
      expect(rulesToSave(EMPTY_RULES_DRAFT, type, {}), type).toBeNull();
    }
  });

  it("saves a length without losing the icon, the condition or the suggestions the field has", () => {
    const stored: EventCustomFieldRules = { max_length: 5, icon: "car", show_when: ASKED_WHEN_PARKING, suggestions: ["Vegan"] };
    const edited = { ...rulesDraftFromRules(stored), maxLength: "6" };
    expect(rulesToSave(edited, "text", stored)).toEqual({ max_length: 6, icon: "car", show_when: ASKED_WHEN_PARKING, suggestions: ["Vegan"] });
  });

  it("keeps the icon and the condition when the type changes, and drops the suggestions and the format rules a type does not take", () => {
    const stored: EventCustomFieldRules = { max_length: 5, example: "ab", icon: "car", show_when: ASKED_WHEN_PARKING, suggestions: ["Vegan"] };
    const asDraft = rulesDraftFromRules(stored);
    const kept = { icon: "car", show_when: ASKED_WHEN_PARKING };
    expect(rulesToSave(asDraft, "long_text", stored)).toEqual({ ...kept, max_length: 5, example: "ab" });
    expect(rulesToSave(asDraft, "phone", stored)).toEqual({ ...kept, max_length: 5, example: "ab" });
    for (const type of ["date", "datetime", "select", "boolean"]) {
      expect(rulesToSave(asDraft, type, stored), type).toEqual(kept);
    }
  });

  it("gives the suggestions back when the type goes back to text, as long as the form was not closed", () => {
    const asDraft = rulesDraftFromRules({ suggestions: ["Vegan"], max_length: 5 });
    expect(rulesToSave(asDraft, "boolean", { suggestions: ["Vegan"], max_length: 5 })).toBeNull();
    expect(rulesToSave(asDraft, "text", { suggestions: ["Vegan"], max_length: 5 })).toEqual({ suggestions: ["Vegan"], max_length: 5 });
  });

  it("clears a rule that is switched off in the form", () => {
    const stored: EventCustomFieldRules = { icon: "car", show_when: ASKED_WHEN_PARKING, suggestions: ["Vegan"], digits_only: true };
    const cleared = { ...rulesDraftFromRules(stored), icon: null, showWhen: null, suggestions: [], digitsOnly: false };
    expect(rulesToSave(cleared, "text", stored)).toBeNull();
  });

  it("never saves a condition that names no answer yet: the form holds the save back instead", () => {
    const incomplete = draft({ icon: "car", showWhen: { field: "meal", value: "" } });
    expect(rulesToSave(incomplete, "text", null)).toEqual({ icon: "car" });
    expect(rulesToSave(draft({ showWhen: { field: "meal", value: "" } }), "text", null)).toBeNull();
  });

  it("sends a rule that only a newer server knows again, so that a save never deletes what the editor does not show", () => {
    // A rule this version has no control for (the server's schema is strict, so only a newer server can store one).
    const stored = { max_length: 5, icon: "car", placeholder_image: "x.png", ask_twice: { when: [1, 2] } } as unknown as EventCustomFieldRules;
    const saved = rulesToSave({ ...rulesDraftFromRules(stored), maxLength: "6" }, "text", stored);
    expect(saved).toEqual({ max_length: 6, icon: "car", placeholder_image: "x.png", ask_twice: { when: [1, 2] } });
    // On any type, and with every control cleared.
    for (const type of ["long_text", "phone", "date", "datetime", "select", "boolean"]) {
      expect(rulesToSave(EMPTY_RULES_DRAFT, type, stored), type).toEqual({ placeholder_image: "x.png", ask_twice: { when: [1, 2] } });
    }
    expect(rulesToSave(EMPTY_RULES_DRAFT, "text", stored)).toEqual({ placeholder_image: "x.png", ask_twice: { when: [1, 2] } });
  });

  it("does not take a rule the form has a control for from the stored rules", () => {
    expect(rulesToSave(EMPTY_RULES_DRAFT, "text", { max_length: 5, digits_only: true, example: "1", icon: "car", suggestions: ["a"] })).toBeNull();
    expect(rulesToSave(EMPTY_RULES_DRAFT, "text", { show_when: ASKED_WHEN_PARKING })).toBeNull();
  });
});

describe("sameAllRules", () => {
  it("is sameRules, and the icon, the condition and the suggestions as well", () => {
    expect(sameAllRules({ max_length: 5, icon: "car" }, { max_length: 5, icon: "car" })).toBe(true);
    expect(sameAllRules({ max_length: 5, icon: "car" }, { max_length: 5 })).toBe(false);
    expect(sameAllRules({ icon: "car" }, { icon: "pin" })).toBe(false);
    expect(sameAllRules({ show_when: { field: "a", value: true } }, { show_when: { field: "a", value: true } })).toBe(true);
    expect(sameAllRules({ show_when: { field: "a", value: true } }, { show_when: { field: "b", value: true } })).toBe(false);
    expect(sameAllRules({ show_when: { field: "a", value: "x" } }, { show_when: { field: "a", value: true } })).toBe(false);
    expect(sameAllRules({ suggestions: ["a", "b"] }, { suggestions: ["a", "b"] })).toBe(true);
    expect(sameAllRules({ suggestions: ["a"] }, { suggestions: ["a", "b"] })).toBe(false);
    expect(sameAllRules(null, undefined)).toBe(true);
    expect(sameAllRules({ max_length: 5 }, { max_length: 6 })).toBe(false);
  });

  it("takes the order of the suggestions as a difference: it is the order a guest sees them in", () => {
    expect(sameAllRules({ suggestions: ["a", "b"] }, { suggestions: ["b", "a"] })).toBe(false);
  });

  it("does not mind the order of the keys, and takes none, an empty object and a rule that is off as the same", () => {
    expect(sameAllRules({ icon: "car", max_length: 5 }, { max_length: 5, icon: "car" })).toBe(true);
    expect(sameAllRules({ show_when: { value: true, field: "a" } }, { show_when: { field: "a", value: true } })).toBe(true);
    expect(sameAllRules(null, {})).toBe(true);
    expect(sameAllRules({ digits_only: false }, null)).toBe(true);
    expect(sameAllRules({ digits_only: false, icon: "car" }, { icon: "car" })).toBe(true);
    expect(sameAllRules({ digits_only: true }, null)).toBe(false);
  });

  it("looks at a rule that only a newer server knows", () => {
    const withExtra = { icon: "car", extra: { a: 1 } } as unknown as EventCustomFieldRules;
    const otherExtra = { icon: "car", extra: { a: 2 } } as unknown as EventCustomFieldRules;
    expect(sameAllRules(withExtra, { icon: "car" })).toBe(false);
    expect(sameAllRules(withExtra, otherExtra)).toBe(false);
    expect(sameAllRules(withExtra, { extra: { a: 1 }, icon: "car" } as unknown as EventCustomFieldRules)).toBe(true);
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
  it("is true when the lengths, the example, the suggestions or the condition have a problem", () => {
    expect(hasRulesProblem(rulesProblems("text", EMPTY_RULES_DRAFT))).toBe(false);
    expect(hasRulesProblem(rulesProblems("text", draft({ maxLength: "0" })))).toBe(true);
    expect(hasRulesProblem(rulesProblems("text", draft({ example: "x".repeat(101) })))).toBe(true);
    expect(hasRulesProblem(rulesProblems("text", draft({ suggestions: rowsOf("a", "A") })))).toBe(true);
    expect(hasRulesProblem(rulesProblems("boolean", draft({ showWhen: { field: "meal", value: "" } })))).toBe(true);
    expect(hasRulesProblem(rulesProblems("date", draft({ maxLength: "0" })))).toBe(false);
  });
});

describe("rulesProblems: the suggestions", () => {
  const suggestions = (...texts: string[]) => rulesProblems("text", draft({ suggestions: rowsOf(...texts) })).suggestions;
  const list = (count: number, length = 5) => Array.from({ length: count }, (_, index) => `${String(index).padStart(length, "x")}`);
  const cp = (code: number) => String.fromCodePoint(code);

  it("takes up to 30 suggestions, as the server does, and says so past that", () => {
    expect(suggestions(...list(30))).toBeUndefined();
    expect(suggestions(...list(31))).toEqual({ message: "Use at most 30 suggestions.", keys: new Set() });
    expect(suggestions()).toBeUndefined();
  });

  it("does not count a row that is left empty", () => {
    expect(suggestions(...list(30), "", "   ")).toBeUndefined();
    expect(suggestions("", "", "")).toBeUndefined();
  });

  it("takes a suggestion of 1 to 100 characters, as a person counts them, trimmed", () => {
    expect(suggestions("x".repeat(100))).toBeUndefined();
    expect(suggestions(`  ${"x".repeat(100)}  `)).toBeUndefined();
    expect(suggestions(EMOJI.repeat(100))).toBeUndefined();
    expect(suggestions("x")).toBeUndefined();
    expect(suggestions("x".repeat(101))?.message).toBe("A suggestion is longer than 100 characters.");
    expect(suggestions(EMOJI.repeat(101))?.message).toBe("A suggestion is longer than 100 characters.");
  });

  it("marks the rows that are too long, and counts them in the message", () => {
    const long = "x".repeat(101);
    const problem = suggestions("ok", long, "fine", `${long}!`);
    expect(problem?.message).toBe("2 suggestions are longer than 100 characters.");
    expect(problem?.keys).toEqual(new Set(["r1", "r3"]));
  });

  it("refuses the same suggestion twice, whatever its capital letters, and marks both rows", () => {
    expect(suggestions("Vegan", "Vegetarian")).toBeUndefined();
    const problem = suggestions("Vegan", "Vegetarian", "vegan");
    expect(problem?.message).toBe("“Vegan” is there more than once. Capital letters do not make a suggestion different.");
    expect(problem?.keys).toEqual(new Set(["r0", "r2"]));
    expect(suggestions("  Vegan", "VEGAN  ")?.keys).toEqual(new Set(["r0", "r1"]));
    expect(suggestions("Zażółć", "ZAŻÓŁĆ")).toBeDefined();
  });

  it("refuses the same suggestion written as a composed letter and as a letter and a mark", () => {
    expect(suggestions(`caf${cp(0xe9)}`, `cafe${cp(0x301)}`)).toBeDefined();
    expect(suggestions("a_b", "axb")).toBeUndefined();
    expect(suggestions("Vegan", "Vegan A")).toBeUndefined();
  });

  it("refuses a control, a line break, an invisible or a direction character, a lone surrogate, and says plainly what is wrong", () => {
    for (const code of [0x00, 0x09, 0x0a, 0x0d, 0x7f, 0x85, 0xad, 0x200b, 0x200d, 0x2028, 0x2029, 0x202e, 0x2066, 0x2060, 0xfe0f, 0xfeff, 0xfffe, 0xd800, 0xdc00]) {
      const problem = suggestions(`Ve${cp(code)}gan`);
      expect(problem?.message, code.toString(16)).toBe("A suggestion has an invisible or control character. Use plain text on one line.");
      expect(problem?.keys, code.toString(16)).toEqual(new Set(["r0"]));
    }
    expect(suggestions("Zażółć gęślą jaźń", "No pork (halal)", `${cp(0x1f331)} Plant based`, "Gluten-free")).toBeUndefined();
  });

  it("names the thing to fix first in the order a person fixes it: a character, then a length, then a repeat, then the count", () => {
    const long = "x".repeat(101);
    expect(suggestions(`a${cp(0x200b)}`, long, "b", "b")?.message).toContain("invisible or control character");
    expect(suggestions(long, "b", "B")?.message).toContain("longer than 100 characters");
    expect(suggestions("b", "B", ...list(40))?.message).toContain("more than once");
    expect(suggestions(...list(31))?.message).toBe("Use at most 30 suggestions.");
  });

  it("counts several rows with a bad character in the message", () => {
    expect(suggestions(`a${cp(0x0a)}x`, "ok", `b${cp(0x202e)}y`)?.message).toBe(
      "2 suggestions have an invisible or control character. Use plain text on one line.",
    );
  });

  it("is judged for a text field only: any other type is never sent the suggestions", () => {
    for (const type of ["long_text", "phone", "date", "datetime", "select", "boolean"]) {
      expect(rulesProblems(type, draft({ suggestions: rowsOf("a", "A") })).suggestions, type).toBeUndefined();
    }
  });
});

describe("rulesProblems: the condition", () => {
  it("asks for the answer when a choice question is named and no option is chosen yet", () => {
    expect(rulesProblems("text", draft({ showWhen: { field: "meal", value: "" } })).showWhen).toBe("Choose the answer that shows this question.");
    expect(rulesProblems("boolean", draft({ showWhen: { field: "meal", value: "" } })).showWhen).toBe("Choose the answer that shows this question.");
  });

  it("has nothing to say about no condition, a yes/no condition or a condition with its answer", () => {
    expect(rulesProblems("text", EMPTY_RULES_DRAFT).showWhen).toBeUndefined();
    expect(rulesProblems("text", draft({ showWhen: ASKED_WHEN_PARKING })).showWhen).toBeUndefined();
    expect(rulesProblems("text", draft({ showWhen: { field: "meal", value: "Vegan" } })).showWhen).toBeUndefined();
  });
});
