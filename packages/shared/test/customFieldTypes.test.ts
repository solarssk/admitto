import { describe, expect, it } from "vitest";
import {
  EVENT_CUSTOM_FIELD_LONG_TEXT_MAX,
  EVENT_CUSTOM_FIELD_SUGGESTION_MAX,
  EVENT_CUSTOM_FIELD_SUGGESTIONS_MAX,
  EVENT_CUSTOM_FIELD_TEXT_MAX,
  EVENT_CUSTOM_FIELD_TYPES,
  GUEST_FORM_ICONS,
  eventCustomFieldRulesMaxLength,
  isFreeInputCustomFieldType,
  isQuestionShown,
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

describe("the limits of a text field's suggestions", () => {
  it("are 30 suggestions of 100 characters", () => {
    expect(EVENT_CUSTOM_FIELD_SUGGESTIONS_MAX).toBe(30);
    expect(EVENT_CUSTOM_FIELD_SUGGESTION_MAX).toBe(100);
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
