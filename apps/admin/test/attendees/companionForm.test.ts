import { describe, expect, it } from "vitest";
import { companionAnswerEntries, companionBody, companionFormChanged, companionFormFrom, companionProblem } from "../../src/attendees/companionForm.js";
import { answerField } from "./answerTypeFixtures.js";

/** The form of a guest's companion, apart from the dialog that draws it: what it starts from, what counts as an edit, what is wrong with it
 * before it is sent, and what is sent. */
const diet = answerField("diet", "Diet", "select", { options: ["vegan", "none"], applies_to: "companion" });
const plate = answerField("plate", "Plate", "text", { applies_to: "companion", required: true });
const pet = answerField("pet", "Pet", "boolean", { applies_to: "companion" });
const leash = answerField("leash", "Leash", "text", { applies_to: "companion", rules: { show_when: { field: "pet", value: true } } });
const FIELDS = [diet, plate, pet, leash];

const companion = { slot: 1, name: "Piotr Companion", custom_data: { diet: "vegan", plate: "WA 123" } };

describe("companionAnswerEntries", () => {
  it("lists the answers under the words of their questions, in the order of the event's questions and not of the answers", () => {
    const entries = companionAnswerEntries({ slot: 1, name: "P", custom_data: { leash: "short", plate: "WA 123", diet: "vegan", pet: "true" } }, FIELDS, "Europe/Warsaw");
    expect(entries).toEqual([
      ["diet", "Diet", "vegan"],
      ["plate", "Plate", "WA 123"],
      ["pet", "Pet", "Yes"],
      ["leash", "Leash", "short"],
    ]);
  });

  it("puts an answer whose question is gone last, by its key made readable, and keeps the order of those", () => {
    const entries = companionAnswerEntries({ slot: 1, name: "P", custom_data: { gone_b: "b", diet: "vegan", gone_a: "a" } }, FIELDS, "Europe/Warsaw");
    expect(entries.map(([key, label]) => [key, label])).toEqual([["diet", "Diet"], ["gone_b", "Gone b"], ["gone_a", "Gone a"]]);
  });

  it("leaves out an answer that is empty, and has no entries for a companion with no answers", () => {
    expect(companionAnswerEntries({ slot: 1, name: "P", custom_data: { diet: "  " } }, FIELDS, "Europe/Warsaw")).toEqual([]);
    expect(companionAnswerEntries({ slot: 1, name: "P", custom_data: null }, FIELDS, "Europe/Warsaw")).toEqual([]);
  });
});

describe("companionFormFrom", () => {
  it("holds the name and a box for every question: the answer, or empty", () => {
    expect(companionFormFrom(companion, FIELDS)).toEqual({ name: "Piotr Companion", answers: { diet: "vegan", plate: "WA 123", pet: "", leash: "" } });
  });

  it("holds an empty box for every question of a companion with no answers", () => {
    expect(companionFormFrom({ slot: 1, name: "Piotr Companion", custom_data: null }, [diet])).toEqual({ name: "Piotr Companion", answers: { diet: "" } });
  });

  it("holds no box for an answer whose question is gone: the form has only the questions the event has", () => {
    expect(companionFormFrom({ slot: 1, name: "P", custom_data: { gone: "x" } }, [diet]).answers).toEqual({ diet: "" });
  });
});

describe("companionFormChanged", () => {
  const base = companionFormFrom(companion, FIELDS);

  it("is false for the form it was made from", () => {
    expect(companionFormChanged({ ...base, answers: { ...base.answers } }, base, FIELDS)).toBe(false);
  });

  it("is true for another name, and for another answer to a question that is asked", () => {
    expect(companionFormChanged({ ...base, name: "Anna" }, base, FIELDS)).toBe(true);
    expect(companionFormChanged({ ...base, answers: { ...base.answers, plate: "WA 124" } }, base, FIELDS)).toBe(true);
    expect(companionFormChanged({ ...base, answers: { ...base.answers, diet: "none" } }, base, FIELDS)).toBe(true);
  });

  it("is false for an answer typed to a question that a condition hides: it is not saved", () => {
    expect(companionFormChanged({ ...base, answers: { ...base.answers, leash: "typed while it was shown" } }, base, FIELDS)).toBe(false);
  });

  it("is true for an answer to a question that a condition shows", () => {
    const withPet = { ...base, answers: { ...base.answers, pet: "true" } };
    expect(companionFormChanged(withPet, base, FIELDS)).toBe(true);
    const withLeash = companionFormFrom({ ...companion, custom_data: { ...companion.custom_data, pet: "true" } }, FIELDS);
    expect(companionFormChanged({ ...withLeash, answers: { ...withLeash.answers, leash: "short" } }, withLeash, FIELDS)).toBe(true);
  });
});

describe("companionProblem", () => {
  const form = companionFormFrom(companion, FIELDS);

  it("is nothing for a companion with a name and the required answers", () => {
    expect(companionProblem(form, FIELDS)).toBeNull();
  });

  it.each(["", "   "])("asks for the name when it is %j", (name) => {
    expect(companionProblem({ ...form, name }, FIELDS)).toBe("Enter the companion's name.");
  });

  it("says before the answers that the name is needed", () => {
    expect(companionProblem({ name: "", answers: { ...form.answers, plate: "" } }, FIELDS)).toBe("Enter the companion's name.");
  });

  it("names the required question that is not answered", () => {
    expect(companionProblem({ ...form, answers: { ...form.answers, plate: "   " } }, FIELDS)).toBe("Plate is required.");
  });

  it("names a choice that is not one of the options", () => {
    expect(companionProblem({ ...form, answers: { ...form.answers, diet: "pizza" } }, FIELDS)).toBe("Diet must be one of: vegan, none.");
  });

  it("does not ask a required question that a condition hides", () => {
    const hiddenRequired = answerField("badge", "Badge", "text", { applies_to: "companion", required: true, rules: { show_when: { field: "pet", value: true } } });
    const fields = [pet, hiddenRequired];
    expect(companionProblem({ name: "Anna", answers: { pet: "", badge: "" } }, fields)).toBeNull();
    expect(companionProblem({ name: "Anna", answers: { pet: "true", badge: "" } }, fields)).toBe("Badge is required.");
  });
});

describe("companionBody", () => {
  it("is the trimmed name and the answers that are given, to the questions that are asked", () => {
    const form = { name: "  Anna Companion ", answers: { diet: " vegan ", plate: "WA 123", pet: "true", leash: "short" } };
    expect(companionBody(form, FIELDS)).toEqual({ name: "Anna Companion", custom_data: { diet: "vegan", plate: "WA 123", pet: "true", leash: "short" } });
  });

  it("leaves out an answer that is empty or blank: that is how the server clears it", () => {
    const form = { name: "Anna", answers: { diet: "", plate: "WA 123", pet: "   ", leash: "" } };
    expect(companionBody(form, FIELDS).custom_data).toEqual({ plate: "WA 123" });
  });

  it("leaves out what is typed for a question that a condition hides", () => {
    const form = { name: "Anna", answers: { diet: "vegan", plate: "WA 123", pet: "false", leash: "typed while it was shown" } };
    expect(companionBody(form, FIELDS).custom_data).toEqual({ diet: "vegan", plate: "WA 123", pet: "false" });
  });

  it("is a name and no answers for an event with no questions about a companion", () => {
    expect(companionBody({ name: "Anna", answers: {} }, [])).toEqual({ name: "Anna", custom_data: {} });
  });
});
