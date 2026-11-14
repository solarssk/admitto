import { describe, expect, it } from "vitest";
import {
  EVENT_CUSTOM_FIELD_LONG_TEXT_MAX,
  EVENT_CUSTOM_FIELD_SUGGESTION_MAX,
  EVENT_CUSTOM_FIELD_SUGGESTIONS_MAX,
  EVENT_CUSTOM_FIELD_TEXT_MAX,
  EVENT_CUSTOM_FIELD_TYPES,
  GUEST_FORM_ICONS,
  eventCustomFieldRulesMaxLength,
  guestFormDrawsIcon,
  hasForbiddenSuggestionCharacter,
  isFreeInputCustomFieldType,
  isQuestionShown,
  suggestionKey,
  type EventCustomFieldRules,
  type ShowWhen,
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

describe("GUEST_FORM_ICONS", () => {
  it("is a short list of distinct lower case names, at most 20", () => {
    expect(GUEST_FORM_ICONS.length).toBeGreaterThan(0);
    expect(GUEST_FORM_ICONS.length).toBeLessThanOrEqual(20);
    expect(new Set(GUEST_FORM_ICONS).size).toBe(GUEST_FORM_ICONS.length);
    for (const icon of GUEST_FORM_ICONS) expect(icon).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });

  it("has the symbols of the approved form", () => {
    for (const icon of ["parking", "food", "accessible", "bed", "user-plus", "car", "building", "users"]) {
      expect(GUEST_FORM_ICONS).toContain(icon);
    }
  });
});

describe("guestFormDrawsIcon", () => {
  it("is true for the one-line answers: text, date, date and time and phone, required or not", () => {
    for (const type of ["text", "date", "datetime", "phone"]) {
      expect(guestFormDrawsIcon({ type, required: false }), type).toBe(true);
      expect(guestFormDrawsIcon({ type, required: true }), `${type}, required`).toBe(true);
    }
  });

  it("is true for an optional yes/no question, the row with a tick, and false for a required one, which is two buttons", () => {
    expect(guestFormDrawsIcon({ type: "boolean", required: false })).toBe(true);
    expect(guestFormDrawsIcon({ type: "boolean", required: true })).toBe(false);
  });

  it("is false for a single choice and for a long text, whether required or not", () => {
    for (const type of ["select", "long_text"]) {
      expect(guestFormDrawsIcon({ type, required: false }), type).toBe(false);
      expect(guestFormDrawsIcon({ type, required: true }), `${type}, required`).toBe(false);
    }
  });

  it("is false for a type this version does not know: nothing is promised for it", () => {
    for (const type of ["mystery", "", "Text", "constructor"]) expect(guestFormDrawsIcon({ type, required: false }), type).toBe(false);
  });

  it("says something for every type of answer, so a new type has to be decided here", () => {
    const drawn = EVENT_CUSTOM_FIELD_TYPES.filter((type) => guestFormDrawsIcon({ type, required: false }));
    expect([...drawn].sort()).toEqual(["boolean", "date", "datetime", "phone", "text"]);
  });
});

describe("the limits of a text field's suggestions", () => {
  it("are 30 suggestions of 100 characters", () => {
    expect(EVENT_CUSTOM_FIELD_SUGGESTIONS_MAX).toBe(30);
    expect(EVENT_CUSTOM_FIELD_SUGGESTION_MAX).toBe(100);
  });
});

describe("hasForbiddenSuggestionCharacter", () => {
  const cp = (code: number) => String.fromCodePoint(code);

  it("accepts plain text in any script, with spaces, punctuation and an emoji", () => {
    for (const text of ["Vegan", "Zażółć gęślą jaźń", "No pork (halal)", "Gluten-free", `${cp(0x1f331)} Plant based`, "日本語のメニュー", "a b  c"]) {
      expect(hasForbiddenSuggestionCharacter(text), text).toBe(false);
    }
  });

  it("refuses a control, a line break, a format character, a lone surrogate and what Unicode leaves out of sight", () => {
    const forbidden = [
      0x00, 0x09, 0x0a, 0x0d, 0x1f, 0x7f, 0x85, 0xad, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x202a, 0x202e, 0x2028, 0x2029, 0x2066, 0x2069,
      0x2060, 0xfe0f, 0xfeff, 0x061c, 0x180e, 0x3164, 0xfffe, 0xffff, 0xd800, 0xdc00, 0xe0001,
    ];
    for (const code of forbidden) {
      expect(hasForbiddenSuggestionCharacter(`Ve${cp(code)}gan`), code.toString(16)).toBe(true);
    }
  });
});

describe("suggestionKey", () => {
  it("is the same for the same text in another case, and for a composed and a decomposed letter", () => {
    expect(suggestionKey("Vegan")).toBe(suggestionKey("vegan"));
    expect(suggestionKey("Zażółć")).toBe(suggestionKey("ZAŻÓŁĆ"));
    expect(suggestionKey(`caf${String.fromCodePoint(0xe9)}`)).toBe(suggestionKey(`cafe${String.fromCodePoint(0x301)}`));
  });

  it("is different for different text, and keeps a character that only looks alike apart", () => {
    expect(suggestionKey("Vegan")).not.toBe(suggestionKey("Vegetarian"));
    expect(suggestionKey("a_b")).not.toBe(suggestionKey("axb"));
    expect(suggestionKey("Vegan")).not.toBe(suggestionKey("Vegan "));
  });
});

describe("isQuestionShown", () => {
  const whenYes = (field = "parking"): { rules: { show_when: ShowWhen } } => ({ rules: { show_when: { field, value: true } } });
  const whenOption = (value: string, field = "day"): { rules: { show_when: ShowWhen } } => ({ rules: { show_when: { field, value } } });

  it("asks a question that has no condition, whatever the answers are", () => {
    const withoutCondition: { rules?: EventCustomFieldRules | null }[] = [{}, { rules: null }, { rules: {} }, { rules: undefined }, { rules: { icon: "car" } }];
    for (const field of withoutCondition) {
      expect(isQuestionShown(field, {})).toBe(true);
      expect(isQuestionShown(field, { parking: "false", day: "Day 1" })).toBe(true);
    }
  });

  it("asks a question about a yes/no question only when the answer is true", () => {
    expect(isQuestionShown(whenYes(), { parking: "true" })).toBe(true);
    expect(isQuestionShown(whenYes(), { parking: "false" })).toBe(false);
  });

  it("does not ask it when there is no answer, or an answer that is not the stored true", () => {
    for (const answer of [undefined, null, "", " ", "True", "TRUE", "yes", "1", "true ", " true", "truee", "t", true, 1, {}, ["true"]]) {
      expect(isQuestionShown(whenYes(), { parking: answer }), JSON.stringify(answer)).toBe(false);
    }
    expect(isQuestionShown(whenYes(), {})).toBe(false);
    expect(isQuestionShown(whenYes(), { day: "true" })).toBe(false);
  });

  it("asks a question about a select question only when the answer is the option, as written", () => {
    expect(isQuestionShown(whenOption("Both"), { day: "Both" })).toBe(true);
    for (const answer of ["both", "BOTH", "Both ", " Both", "Day 1", "", "true", undefined, null, 1, ["Both"]]) {
      expect(isQuestionShown(whenOption("Both"), { day: answer }), JSON.stringify(answer)).toBe(false);
    }
    expect(isQuestionShown(whenOption("Both"), {})).toBe(false);
  });

  it("matches an option that is itself the text true, only with the stored answer true", () => {
    expect(isQuestionShown(whenOption("true"), { day: "true" })).toBe(true);
    expect(isQuestionShown(whenOption("true"), { day: "false" })).toBe(false);
  });

  it("reads the controller named by the condition, and no other answer", () => {
    expect(isQuestionShown(whenYes("lunch"), { parking: "true" })).toBe(false);
    expect(isQuestionShown(whenYes("lunch"), { parking: "true", lunch: "true" })).toBe(true);
    expect(isQuestionShown(whenOption("Both", "when"), { day: "Both" })).toBe(false);
  });

  it("is not met by a condition that is not one: no value, a value that is neither true nor a text", () => {
    for (const value of [undefined, null, false, 0, 1, {}, []]) {
      const field = { rules: { show_when: { field: "parking", value } as unknown as ShowWhen } };
      expect(isQuestionShown(field, { parking: "true" }), JSON.stringify(value)).toBe(false);
      expect(isQuestionShown(field, {}), `${JSON.stringify(value)} without an answer`).toBe(false);
    }
  });

  it("reads own properties only, so a key of the prototype chain is no answer", () => {
    for (const key of ["constructor", "toString", "hasOwnProperty", "valueOf", "__proto__"]) {
      expect(isQuestionShown(whenOption("Both", key), {}), key).toBe(false);
      expect(isQuestionShown(whenYes(key), {}), key).toBe(false);
    }
    const inherited = Object.create({ parking: "true" }) as Record<string, unknown>;
    expect(isQuestionShown(whenYes(), inherited)).toBe(false);
    // An own property of that name is an answer.
    const own = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(own, "__proto__", { value: "true", enumerable: true });
    expect(isQuestionShown(whenYes("__proto__"), own)).toBe(true);
  });

  it("changes nothing it is given", () => {
    const answers = Object.freeze({ parking: "true" });
    const field = Object.freeze({ rules: Object.freeze({ show_when: Object.freeze({ field: "parking", value: true as const }) }) });
    expect(isQuestionShown(field, answers)).toBe(true);
    expect(answers).toEqual({ parking: "true" });
  });
});
