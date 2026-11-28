import { describe, expect, it } from "vitest";
import {
  assertCustomDataMeetsRequirements,
  buildCustomDataFromInput,
  keepShownAnswers,
  validateCustomDataPatch,
} from "../src/validate-custom-data.js";
import { RegistrantInputError, buildRegistrantCustomData, type RegistrantFormField } from "../src/registrant-input.js";
import type { EventItemContent } from "../src/types.js";

/** A character by its code point, so that invisible characters never appear in this file. */
const cp = (codePoint: number) => String.fromCodePoint(codePoint);

const parking: EventItemContent = { label: "Parking", source_field: "parking", type: "boolean" };
const day: EventItemContent = { label: "Day", source_field: "day", type: "select", options: ["Day 1", "Day 2", "Both"] };
const plate = (required: boolean): EventItemContent => ({
  label: "Plate",
  source_field: "plate",
  type: "text",
  ...(required ? { required } : {}),
  rules: { show_when: { field: "parking", value: true } },
});
const badge = (required: boolean): EventItemContent => ({
  label: "Badge",
  source_field: "badge",
  type: "text",
  ...(required ? { required } : {}),
  rules: { show_when: { field: "day", value: "Both" } },
});

const onForm = (fields: readonly EventItemContent[]): RegistrantFormField[] =>
  fields.map((field) => ({ ...field, show_on_form: true }));

/** What a create path gives for an input: the stored map, or the message of the refusal. */
function created(fields: EventItemContent[], input: Record<string, unknown>): Record<string, string> | undefined | string {
  try {
    return buildCustomDataFromInput(fields, input);
  } catch (err) {
    return (err as Error).message;
  }
}

/** The same for the guest's path: the stored map, or the fixed refusal. */
function submitted(fields: EventItemContent[], input: unknown): Record<string, string> | undefined | string {
  try {
    return buildRegistrantCustomData(onForm(fields), input);
  } catch (err) {
    expect(err).toBeInstanceOf(RegistrantInputError);
    return "refused";
  }
}

type Case = {
  name: string;
  fields: EventItemContent[];
  input: Record<string, unknown>;
  /** The stored answers. */
  stored?: Record<string, string>;
  /** Set when the input is refused: the message of the staff path (the guest's path always says `refused`). */
  refused?: string;
};

const CASES: Case[] = [
  // A yes/no question controls the plate.
  { name: "yes/no, condition met: the answer is stored", fields: [parking, plate(false)], input: { parking: "true", plate: "WA 12345" }, stored: { parking: "true", plate: "WA 12345" } },
  { name: "yes/no, condition met with an alias: yes", fields: [parking, plate(false)], input: { parking: "yes", plate: "WA 12345" }, stored: { parking: "true", plate: "WA 12345" } },
  { name: "yes/no, condition met with another case and spaces", fields: [parking, plate(false)], input: { parking: " TRUE ", plate: "WA 12345" }, stored: { parking: "true", plate: "WA 12345" } },
  { name: "yes/no, condition not met: the answer is dropped", fields: [parking, plate(false)], input: { parking: "false", plate: "WA 12345" }, stored: { parking: "false" } },
  { name: "yes/no, condition not met by an alias: no", fields: [parking, plate(false)], input: { parking: "No", plate: "WA 12345" }, stored: { parking: "false" } },
  { name: "yes/no, controller not answered: the answer is dropped", fields: [parking, plate(false)], input: { plate: "WA 12345" } },
  { name: "yes/no, controller answered with an empty text: the answer is dropped", fields: [parking, plate(false)], input: { parking: "", plate: "WA 12345" } },
  { name: "yes/no, controller answered with a blank text: the answer is dropped", fields: [parking, plate(false)], input: { parking: "   ", plate: "WA 12345" } },
  { name: "yes/no, controller null: the answer is dropped", fields: [parking, plate(false)], input: { parking: null, plate: "WA 12345" } },
  { name: "required, condition met, answered", fields: [parking, plate(true)], input: { parking: "true", plate: "WA 12345" }, stored: { parking: "true", plate: "WA 12345" } },
  { name: "required, condition met, not answered: refused", fields: [parking, plate(true)], input: { parking: "true" }, refused: "required_custom_data_field_missing:plate" },
  { name: "required, condition met, answered with an empty text: refused", fields: [parking, plate(true)], input: { parking: "true", plate: "" }, refused: "required_custom_data_field_missing:plate" },
  { name: "required, condition met, answered with spaces: refused", fields: [parking, plate(true)], input: { parking: "true", plate: "   " }, refused: "required_custom_data_field_missing:plate" },
  { name: "required, condition met by an alias, not answered: refused", fields: [parking, plate(true)], input: { parking: "1" }, refused: "required_custom_data_field_missing:plate" },
  { name: "required, condition not met, not answered: not required", fields: [parking, plate(true)], input: { parking: "false" }, stored: { parking: "false" } },
  { name: "required, condition not met, answered: not required and dropped", fields: [parking, plate(true)], input: { parking: "false", plate: "WA 12345" }, stored: { parking: "false" } },
  { name: "required, controller not answered, not answered: not required", fields: [parking, plate(true)], input: {} },
  { name: "optional, condition met, not answered", fields: [parking, plate(false)], input: { parking: "true" }, stored: { parking: "true" } },
  // A select question controls the badge.
  { name: "select, condition met: the answer is stored", fields: [day, badge(false)], input: { day: "Both", badge: "Blue" }, stored: { day: "Both", badge: "Blue" } },
  { name: "select, condition met after trimming", fields: [day, badge(false)], input: { day: " Both ", badge: "Blue" }, stored: { day: "Both", badge: "Blue" } },
  { name: "select, another option: the answer is dropped", fields: [day, badge(false)], input: { day: "Day 1", badge: "Blue" }, stored: { day: "Day 1" } },
  { name: "select, controller not answered: the answer is dropped", fields: [day, badge(false)], input: { badge: "Blue" } },
  { name: "select, required, condition met, not answered: refused", fields: [day, badge(true)], input: { day: "Both" }, refused: "required_custom_data_field_missing:badge" },
  { name: "select, required, another option: not required", fields: [day, badge(true)], input: { day: "Day 2" }, stored: { day: "Day 2" } },
  { name: "select, required, controller not answered: not required", fields: [day, badge(true)], input: {}, },
  // A controller value that is not a possible answer is an error, never a way to hide a question.
  { name: "yes/no controller with a value that is no answer: refused", fields: [parking, plate(false)], input: { parking: "maybe", plate: "WA 12345" }, refused: "invalid_custom_data_value:parking" },
  { name: "yes/no controller with a value that is no answer, question not required: still refused", fields: [parking, plate(false)], input: { parking: "maybe" }, refused: "invalid_custom_data_value:parking" },
  { name: "select controller with an option it does not have: refused", fields: [day, badge(false)], input: { day: "Day 3", badge: "Blue" }, refused: "invalid_custom_data_value:day" },
  { name: "select controller with an option in another case: refused", fields: [day, badge(false)], input: { day: "both", badge: "Blue" }, refused: "invalid_custom_data_value:day" },
  { name: "select controller with the text true: refused", fields: [day, badge(false)], input: { day: "true", badge: "Blue" }, refused: "invalid_custom_data_value:day" },
  // What a hidden question's answer may be: anything, it is not read.
  { name: "hidden question, answer too long: dropped without an error", fields: [parking, plate(false)], input: { parking: "false", plate: "x".repeat(5000) }, stored: { parking: "false" } },
  { name: "hidden question, answer that is not a text: dropped without an error", fields: [parking, plate(false)], input: { parking: "false", plate: 5 }, stored: { parking: "false" } },
  { name: "hidden question, answer that is an object: dropped without an error", fields: [parking, plate(false)], input: { parking: "false", plate: { x: 1 } }, stored: { parking: "false" } },
  { name: "hidden question, answer with an invisible character: dropped without an error", fields: [parking, plate(false)], input: { parking: "false", plate: `WA${cp(0x200b)}1` }, stored: { parking: "false" } },
  { name: "shown question, answer too long: refused", fields: [parking, plate(false)], input: { parking: "true", plate: "x".repeat(101) }, refused: "validation_failed:plate" },
  { name: "shown question, answer that is not a text: refused", fields: [parking, plate(false)], input: { parking: "true", plate: 5 }, refused: "validation_failed:plate" },
  // Other questions around the pair.
  { name: "the order of the keys does not matter", fields: [plate(true), parking], input: { plate: "WA 12345", parking: "true" }, stored: { parking: "true", plate: "WA 12345" } },
  { name: "two conditions on two controllers, one met", fields: [parking, day, plate(true), badge(true)], input: { parking: "true", day: "Day 1", plate: "WA 1" }, stored: { parking: "true", day: "Day 1", plate: "WA 1" } },
  { name: "two conditions on one controller", fields: [parking, plate(true), { ...badge(true), rules: { show_when: { field: "parking", value: true } } }], input: { parking: "false" }, stored: { parking: "false" } },
  // A condition that names a question the form does not have is never met.
  { name: "a condition on a question that is not among the fields: never met", fields: [plate(true)], input: { plate: "WA 12345" } },
  { name: "a condition on a question that is not among the fields: not required", fields: [plate(true)], input: {} },
];

describe("a question with a condition, on a create path", () => {
  it.each(CASES)("the staff form: $name", ({ fields, input, stored, refused }) => {
    expect(created(fields, input)).toEqual(refused ?? stored);
  });

  it.each(CASES)("the guest form: $name", ({ fields, input, stored, refused }) => {
    expect(submitted(fields, input)).toEqual(refused ? "refused" : stored);
  });
});

describe("a question with a condition, on the guest form only", () => {
  it("takes the answer of a yes/no question as a boolean, as the checkbox sends it", () => {
    expect(submitted([parking, plate(true)], { parking: true, plate: "WA 12345" })).toEqual({ parking: "true", plate: "WA 12345" });
    expect(submitted([parking, plate(true)], { parking: false, plate: "WA 12345" })).toEqual({ parking: "false" });
    expect(submitted([parking, plate(true)], { parking: true })).toBe("refused");
    expect(submitted([parking, plate(true)], { parking: false })).toEqual({ parking: "false" });
  });

  it("refuses a controller answered with a type it cannot have, even when the question is not asked", () => {
    for (const parkingAnswer of [5, ["true"], { value: true }]) {
      expect(submitted([parking, plate(false)], { parking: parkingAnswer, plate: "WA 12345" }), JSON.stringify(parkingAnswer)).toBe("refused");
    }
    expect(submitted([day, badge(false)], { day: true })).toBe("refused");
  });

  it("does not read a hidden answer at all: text the guest's answers are refused for is no error", () => {
    for (const text of [`WA${cp(0x200b)}1`, `WA${cp(0x202e)}1`, `WA${cp(0x0)}1`, `WA${cp(0xfe0f)}1`, "x".repeat(10_000), "line\nbreak"]) {
      expect(submitted([parking, plate(true)], { parking: false, plate: text })).toEqual({ parking: "false" });
      expect(submitted([parking, plate(true)], { plate: text })).toBeUndefined();
    }
    // The same text is refused when the question is asked.
    for (const text of [`WA${cp(0x200b)}1`, `WA${cp(0x202e)}1`, `WA${cp(0x0)}1`, "x".repeat(10_000)]) {
      expect(submitted([parking, plate(true)], { parking: true, plate: text })).toBe("refused");
    }
  });

  it("judges the condition on the answers as the server reads them, not on a claim of the client", () => {
    // The controller is a yes/no question. A text that only looks like yes is a refusal, not a match.
    for (const claim of ["true;", "truee", "t", "on", "y", "ye", "yes please", "TRUE\u0000", "true ", "\ttrue"]) {
      const result = submitted([parking, plate(false)], { parking: claim, plate: "WA 12345" });
      // "true " and the tab are trimmed to a real yes; every other one is no answer at all.
      expect(result === "refused" || (typeof result === "object" && result.parking === "true"), claim).toBe(true);
      if (typeof result === "object") expect(result.plate === "WA 12345").toBe(claim === "true " || claim === "\ttrue");
    }
  });

  it("ignores a key that is not a question of the form, whatever its name, and leaves the prototype alone", () => {
    const hostile = JSON.parse(
      '{"__proto__": {"polluted": "yes"}, "constructor": "true", "toString": "true", "prototype": "true", "hasOwnProperty": "true", "parking": "true", "plate": "WA 12345"}',
    ) as unknown;
    expect(submitted([parking, plate(true)], hostile)).toEqual({ parking: "true", plate: "WA 12345" });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(buildRegistrantCustomData(onForm([parking, plate(true)]), hostile))).toBe(Object.prototype);
  });

  it("does not take the controller from the prototype of the payload", () => {
    const inherited = Object.create({ parking: "true" }) as Record<string, unknown>;
    inherited.plate = "WA 12345";
    expect(submitted([parking, plate(false)], inherited)).toBe("refused");
  });

  it("never asks a question about a controller named like a prototype key: such a field is not on the form at all", () => {
    for (const key of ["__proto__", "constructor", "prototype"]) {
      const controller: EventItemContent = { label: "Controller", source_field: key, type: "boolean" };
      const dependent: EventItemContent = { label: "Dependent", source_field: "plate", type: "text", required: true, rules: { show_when: { field: key, value: true } } };
      const input = Object.create(null) as Record<string, unknown>;
      Object.defineProperty(input, key, { value: "true", enumerable: true });
      input.plate = "WA 12345";
      expect(buildRegistrantCustomData(onForm([controller, dependent]), input), key).toBeUndefined();
    }
  });

  it("asks only questions that are on the form: a question with a condition that is off the form is dropped", () => {
    const fields: RegistrantFormField[] = [
      { ...parking, show_on_form: true },
      { ...plate(false), show_on_form: false },
    ];
    expect(buildRegistrantCustomData(fields, { parking: "true", plate: "WA 12345" })).toEqual({ parking: "true" });
  });

  it("does not ask a question whose controller is not on the form: it is dropped, never required", () => {
    const fields: RegistrantFormField[] = [
      { ...parking, show_on_form: false },
      { ...plate(true), show_on_form: true },
    ];
    expect(buildRegistrantCustomData(fields, { parking: "true", plate: "WA 12345" })).toBeUndefined();
  });

  it("judges a companion's questions on the companion's answers", () => {
    const fields: RegistrantFormField[] = [
      { ...parking, show_on_form: true, applies_to: "companion" },
      { ...plate(true), show_on_form: true, applies_to: "companion" },
      { ...parking, source_field: "guest_parking", show_on_form: true },
    ];
    expect(buildRegistrantCustomData(fields, { parking: "true", plate: "WA 1", guest_parking: "false" }, "companion")).toEqual({ parking: "true", plate: "WA 1" });
    expect(() => buildRegistrantCustomData(fields, { parking: "true" }, "companion")).toThrow(RegistrantInputError);
  });
});

describe("a question with a condition, in a staff edit", () => {
  const fields = [parking, plate(true)];

  it("keeps an answer that was stored while the question was asked, and does not need it any more", () => {
    // The staff set parking to No: the plate stays where it is, and nothing asks for it again.
    const patch = validateCustomDataPatch(fields, { parking: "true", plate: "WA 12345" }, { parking: "false" });
    expect(patch).toEqual({ parking: "false" });
    expect(() => assertCustomDataMeetsRequirements(fields, { parking: "false", plate: "WA 12345" })).not.toThrow();
    expect(() => assertCustomDataMeetsRequirements(fields, { parking: "false" })).not.toThrow();
  });

  it("does not store an answer to a question that is not asked", () => {
    expect(validateCustomDataPatch(fields, { parking: "false" }, { plate: "NEW" })).toEqual({});
    expect(validateCustomDataPatch(fields, {}, { plate: "NEW" })).toEqual({});
    expect(validateCustomDataPatch(fields, { parking: "false", plate: "OLD" }, { plate: "NEW" })).toEqual({});
  });

  it("stores it when the same edit asks the question", () => {
    expect(validateCustomDataPatch(fields, { parking: "false" }, { parking: "yes", plate: "NEW" })).toEqual({ parking: "true", plate: "NEW" });
    expect(validateCustomDataPatch(fields, { parking: "true" }, { plate: "NEW" })).toEqual({ plate: "NEW" });
  });

  it("does not store it when the same edit stops asking the question", () => {
    expect(validateCustomDataPatch(fields, { parking: "true", plate: "OLD" }, { parking: "no", plate: "NEW" })).toEqual({ parking: "false" });
    expect(validateCustomDataPatch(fields, { parking: "true", plate: "OLD" }, { parking: null, plate: "NEW" })).toEqual({ parking: null });
  });

  it("clears an answer to a question that is not asked: nothing is kept against the wish of the staff", () => {
    expect(validateCustomDataPatch(fields, { parking: "false", plate: "OLD" }, { plate: null })).toEqual({ plate: null });
    expect(validateCustomDataPatch(fields, { parking: "false", plate: "OLD" }, { plate: "" })).toEqual({ plate: null });
  });

  it("refuses to clear a required answer to a question that is asked", () => {
    expect(() => validateCustomDataPatch(fields, { parking: "true", plate: "OLD" }, { plate: null })).toThrow(
      "required_custom_data_field_missing:plate",
    );
    expect(() => validateCustomDataPatch(fields, { parking: "false", plate: "OLD" }, { parking: "true", plate: null })).toThrow(
      "required_custom_data_field_missing:plate",
    );
  });

  it("asks for the answer once the question is asked, as for any required field", () => {
    expect(() => validateCustomDataPatch(fields, { parking: "false" }, { parking: "true" })).toThrow("required_custom_data_field_missing:plate");
    expect(() => assertCustomDataMeetsRequirements(fields, { parking: "true" })).toThrow("required_custom_data_field_missing:plate");
    expect(() => assertCustomDataMeetsRequirements(fields, { parking: "true", plate: "  " })).toThrow("required_custom_data_field_missing:plate");
  });

  it("does not read the value of a question that is not asked, valid or not", () => {
    expect(validateCustomDataPatch(fields, { parking: "false" }, { plate: "x".repeat(500) })).toEqual({});
    expect(() => validateCustomDataPatch(fields, { parking: "true" }, { plate: "x".repeat(500) })).toThrow("validation_failed:plate");
  });

  it("refuses a controller value that is no answer, and an unknown key, as before", () => {
    expect(() => validateCustomDataPatch(fields, {}, { parking: "maybe" })).toThrow("invalid_custom_data_value:parking");
    expect(() => validateCustomDataPatch(fields, {}, { unknown: "x" })).toThrow("unknown_custom_data_field:unknown");
    expect(() => validateCustomDataPatch(fields, {}, { parking: "false", unknown: "x" })).toThrow("unknown_custom_data_field:unknown");
  });

  it("still refuses a stored answer that no longer fits its field, asked or not", () => {
    const tight: EventItemContent[] = [parking, { ...plate(false), rules: { show_when: { field: "parking", value: true }, max_length: 3 } }];
    expect(() => assertCustomDataMeetsRequirements(tight, { parking: "false", plate: "WA 12345" })).toThrow("invalid_custom_data_value:plate");
    expect(() => assertCustomDataMeetsRequirements(tight, { parking: "true", plate: "WA 12345" })).toThrow("invalid_custom_data_value:plate");
  });

  it("reads the controller of a stored answer as it was stored: only the text true asks the question", () => {
    for (const stored of ["Yes", "1", "TRUE", "false", ""]) {
      expect(() => assertCustomDataMeetsRequirements(fields, { parking: stored }), stored).not.toThrow();
    }
    expect(() => assertCustomDataMeetsRequirements(fields, { parking: "true" })).toThrow("required_custom_data_field_missing:plate");
    // A stored answer that is no answer of its field is refused first, as it always was.
    expect(() => assertCustomDataMeetsRequirements(fields, { parking: "x" })).toThrow("invalid_custom_data_value:parking");
  });

  it("works with a controller that is named like a prototype key", () => {
    for (const key of ["__proto__", "constructor", "prototype"]) {
      const controller: EventItemContent = { label: "Controller", source_field: key, type: "boolean" };
      const dependent: EventItemContent = { label: "Dependent", source_field: "plate", type: "text", required: true, rules: { show_when: { field: key, value: true } } };
      const withController = (answer: string) => {
        const input = Object.create(null) as Record<string, unknown>;
        Object.defineProperty(input, key, { value: answer, enumerable: true });
        return input;
      };
      const asked = buildCustomDataFromInput([controller, dependent], { ...withController("true"), plate: "WA 12345" });
      expect(Object.getOwnPropertyDescriptor(asked!, key)?.value, key).toBe("true");
      expect(asked?.plate, key).toBe("WA 12345");
      expect(() => buildCustomDataFromInput([controller, dependent], withController("true")), key).toThrow("required_custom_data_field_missing:plate");
      const notAsked = buildCustomDataFromInput([controller, dependent], { ...withController("false"), plate: "WA 12345" });
      expect(Object.getOwnPropertyDescriptor(notAsked!, key)?.value, key).toBe("false");
      expect(notAsked?.plate, key).toBeUndefined();
    }
  });
});

describe("keepShownAnswers", () => {
  const fields = [parking, day, plate(false), badge(false)];

  it("keeps the answers to questions that are asked, and to keys that are no field", () => {
    expect(keepShownAnswers(fields, null, { parking: "true", plate: "WA 1", day: "Both", badge: "Blue", other: "x" })).toEqual({
      parking: "true",
      plate: "WA 1",
      day: "Both",
      badge: "Blue",
      other: "x",
    });
  });

  it("leaves out the answers to questions that are not asked", () => {
    expect(keepShownAnswers(fields, null, { parking: "false", plate: "WA 1", day: "Day 1", badge: "Blue" })).toEqual({ parking: "false", day: "Day 1" });
    expect(keepShownAnswers(fields, null, { plate: "WA 1", badge: "Blue" })).toEqual({});
  });

  it("judges a condition on the answers laid over what the attendee holds", () => {
    // The row has the plate only: the attendee already said yes to parking.
    expect(keepShownAnswers(fields, { parking: "true" }, { plate: "WA 1" })).toEqual({ plate: "WA 1" });
    expect(keepShownAnswers(fields, { parking: "false" }, { plate: "WA 1" })).toEqual({});
    // The row changes the controller too: the row wins over what is held.
    expect(keepShownAnswers(fields, { parking: "false" }, { parking: "true", plate: "WA 1" })).toEqual({ parking: "true", plate: "WA 1" });
    expect(keepShownAnswers(fields, { parking: "true" }, { parking: "false", plate: "WA 1" })).toEqual({ parking: "false" });
  });

  it("is not fooled by the answers in the stored data of an attendee that look like the keys of a prototype", () => {
    const stored = JSON.parse('{"__proto__": {"parking": "true"}, "constructor": "true"}') as unknown;
    expect(keepShownAnswers(fields, stored, { plate: "WA 1" })).toEqual({});
  });

  it("returns the answers as own properties and leaves the input alone", () => {
    const incoming = { parking: "false", plate: "WA 1" };
    const kept = keepShownAnswers(fields, null, incoming);
    expect(incoming).toEqual({ parking: "false", plate: "WA 1" });
    expect(Object.getPrototypeOf(kept)).toBe(Object.prototype);
  });
});
