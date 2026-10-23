import { findShowWhenProblem, type ConditionField } from "@admitto/shared";
import { describe, expect, it } from "vitest";
import type { EventCustomFieldDto } from "../../src/api/types.js";
import {
  answerLabel,
  conditionCandidates,
  conditionLine,
  deleteBlockedMessage,
  dependencyMessage,
  dependencyProblem,
  dependentsIn,
  fieldNameIn,
  ownConditionBlockedMessage,
} from "../../src/requirements/fieldDependencies.js";
import { answerField } from "../attendees/answerTypeFixtures.js";

const whenParking = { show_when: { field: "parking", value: true as const } };
const whenMeal = (value: string) => ({ show_when: { field: "meal", value } });

const parking = answerField("parking", "Parking", "boolean", { show_on_form: true });
const meal = answerField("meal", "Meal", "select", { options: ["Standard", "Vegetarian", "Vegan"], show_on_form: true });
const plate = answerField("plate", "Plate number", "text", { rules: whenParking, show_on_form: true });
const veganNote = answerField("vegan_note", "Vegan note", "text", { rules: whenMeal("Vegan"), show_on_form: true });
const notes = answerField("notes", "Notes", "long_text");
const EVENT = [parking, meal, plate, veganNote, notes];

const asCondition = (field: EventCustomFieldDto, changes: Partial<ConditionField> = {}): ConditionField => ({
  source_field: field.source_field,
  type: field.type,
  show_on_form: field.show_on_form,
  options: field.options,
  rules: field.rules,
  ...changes,
});

describe("conditionCandidates", () => {
  it("are the yes/no and choice questions of the event that have no condition of their own, in the order of the event", () => {
    expect(conditionCandidates(EVENT, "new_field").map((field) => field.source_field)).toEqual(["parking", "meal"]);
  });

  it("leave the field itself out, whatever it is", () => {
    expect(conditionCandidates(EVENT, "parking").map((field) => field.source_field)).toEqual(["meal"]);
    expect(conditionCandidates(EVENT, "meal").map((field) => field.source_field)).toEqual(["parking"]);
  });

  it("leave out a question that has a condition, so that a condition never makes a chain, and every other type", () => {
    const chained = answerField("chained", "Chained", "boolean", { rules: whenParking });
    const types = ["text", "long_text", "date", "datetime", "phone"].map((type) => answerField(`t_${type}`, type, type as EventCustomFieldDto["type"]));
    expect(conditionCandidates([parking, chained, ...types], "other")).toEqual([parking]);
  });

  it("are none for an event with no such question", () => {
    expect(conditionCandidates([], "x")).toEqual([]);
    expect(conditionCandidates([notes, plate], "x")).toEqual([]);
  });

  it("are the questions the server accepts a condition on, and no other: the list and the server's check agree", () => {
    const events: EventCustomFieldDto[][] = [
      EVENT,
      [parking, meal],
      [notes, plate, answerField("when", "When", "date")],
      [answerField("a", "A", "boolean", { rules: { show_when: { field: "b", value: true } } }), answerField("b", "B", "boolean")],
    ];
    for (const fields of events) {
      for (const subject of ["new_field", ...fields.map((field) => field.source_field)]) {
        const offered = new Set(conditionCandidates(fields, subject).map((field) => field.source_field));
        for (const other of fields.filter((field) => field.source_field !== subject)) {
          const answer = other.type === "select" ? (other.options?.[0] ?? "x") : true;
          const asked: ConditionField = {
            source_field: subject,
            type: "text",
            show_on_form: false,
            options: null,
            rules: { show_when: { field: other.source_field, value: answer } },
          };
          const others = fields.filter((field) => field.source_field !== subject);
          const accepted = findShowWhenProblem(asked, others) === null;
          if (dependentsIn(fields, subject).length > 0) {
            // A field that others depend on cannot have a condition itself, whatever question it names: the editor turns the control
            // off for it (the list is not what decides there).
            expect(accepted, `${subject} depends on ${other.source_field}`).toBe(false);
          } else {
            expect(offered.has(other.source_field), `${subject} depends on ${other.source_field}`).toBe(accepted);
          }
        }
      }
    }
  });
});

describe("dependentsIn", () => {
  it("are the fields shown for an answer to this one, in the order of the event", () => {
    expect(dependentsIn(EVENT, "parking")).toEqual([plate]);
    expect(dependentsIn(EVENT, "meal")).toEqual([veganNote]);
    expect(dependentsIn(EVENT, "notes")).toEqual([]);
    expect(dependentsIn(EVENT, "unknown")).toEqual([]);
    expect(dependentsIn(EVENT, "plate")).toEqual([]);
  });

  it("do not count a field that depends on itself", () => {
    const self = answerField("loop", "Loop", "boolean", { rules: { show_when: { field: "loop", value: true } } });
    expect(dependentsIn([self], "loop")).toEqual([]);
  });
});

describe("fieldNameIn", () => {
  it("is the label, and the label with the key when another field has the same label", () => {
    expect(fieldNameIn(parking, EVENT)).toBe("Parking");
    const twin = answerField("parking_2", "Parking", "boolean");
    expect(fieldNameIn(parking, [parking, twin])).toBe("Parking (parking)");
    expect(fieldNameIn(twin, [parking, twin])).toBe("Parking (parking_2)");
  });
});

describe("answerLabel", () => {
  it("is Yes for a yes/no question and the option, in quotes, for a choice", () => {
    expect(answerLabel(true)).toBe("Yes");
    expect(answerLabel("Vegan")).toBe("“Vegan”");
  });
});

describe("dependencyProblem: the fields that depend on this one", () => {
  it("is nothing for a field that is saved as it is, and for a field that nothing depends on", () => {
    expect(dependencyProblem(asCondition(parking), EVENT)).toBeNull();
    expect(dependencyProblem(asCondition(meal), EVENT)).toBeNull();
    expect(dependencyProblem(asCondition(notes, { type: "text" }), EVENT)).toBeNull();
    expect(dependencyProblem(asCondition(plate), EVENT)).toBeNull();
  });

  it("holds back a new type for a field that others are shown for, and names every one of them", () => {
    for (const type of ["text", "long_text", "date", "datetime", "phone", "select"]) {
      expect(dependencyProblem(asCondition(parking, { type, options: type === "select" ? ["Yes"] : null }), EVENT), type).toEqual({
        kind: "controls_others",
        dependents: [plate],
      });
    }
    expect(dependencyProblem(asCondition(meal, { type: "boolean", options: null }), EVENT)).toEqual({ kind: "controls_others", dependents: [veganNote] });
    expect(dependencyProblem(asCondition(meal, { type: "text", options: null }), EVENT)).toEqual({ kind: "controls_others", dependents: [veganNote] });
  });

  it("holds back an option that a field is shown for, whether it is removed or renamed, and names that field only", () => {
    const twoDependents = [...EVENT, answerField("standard_note", "Standard note", "text", { rules: whenMeal("Standard") })];
    expect(dependencyProblem(asCondition(meal, { options: ["Standard", "Vegetarian"] }), twoDependents)).toEqual({
      kind: "controls_others",
      dependents: [veganNote],
    });
    expect(dependencyProblem(asCondition(meal, { options: ["Standard", "Vegetarian", "Vegan food"] }), twoDependents)).toEqual({
      kind: "controls_others",
      dependents: [veganNote],
    });
    expect(dependencyProblem(asCondition(meal, { options: ["Vegetarian"] }), twoDependents)).toMatchObject({
      dependents: [veganNote, twoDependents.at(-1)],
    });
  });

  it("lets an option go that no field is shown for, and an option be added", () => {
    expect(dependencyProblem(asCondition(meal, { options: ["Vegetarian", "Vegan"] }), EVENT)).toBeNull();
    expect(dependencyProblem(asCondition(meal, { options: ["Standard", "Vegetarian", "Vegan", "Halal"] }), EVENT)).toBeNull();
    expect(dependencyProblem(asCondition(meal, { options: ["Vegan"] }), EVENT)).toBeNull();
  });
});

describe("dependencyProblem: the condition of the field itself", () => {
  const candidate = (changes: Partial<ConditionField>) => asCondition(answerField("badge", "Badge", "text"), changes);

  it("is nothing for a condition on a question that is on the form, or for a field that is not", () => {
    expect(dependencyProblem(candidate({ show_on_form: true, rules: whenParking }), EVENT)).toBeNull();
    expect(dependencyProblem(candidate({ show_on_form: false, rules: whenParking }), [{ ...parking, show_on_form: false }, meal])).toBeNull();
  });

  it("holds back a field that is on the form when the question it depends on is not, and names that question", () => {
    const offForm = { ...parking, show_on_form: false };
    expect(dependencyProblem(candidate({ show_on_form: true, rules: whenParking }), [offForm, meal])).toEqual({
      kind: "controller_not_on_form",
      controller: offForm,
    });
  });

  it("says that a condition cannot be kept before it says that the question is off the form, as the server judges the answer first", () => {
    const offForm = { ...meal, show_on_form: false };
    expect(dependencyProblem(candidate({ show_on_form: true, rules: whenMeal("Halal") }), [parking, offForm])).toEqual({ kind: "condition_cannot_be_kept" });
    expect(dependencyProblem(candidate({ show_on_form: true, rules: whenMeal("Vegan") }), [parking, offForm])).toEqual({
      kind: "controller_not_on_form",
      controller: offForm,
    });
  });

  it("holds back a condition that cannot be kept, as the server does: no such question, a question with a condition, no such answer", () => {
    expect(dependencyProblem(candidate({ rules: { show_when: { field: "nothing", value: true } } }), EVENT)).toEqual({ kind: "condition_cannot_be_kept" });
    expect(dependencyProblem(candidate({ rules: { show_when: { field: "plate", value: true } } }), EVENT)).toEqual({ kind: "condition_cannot_be_kept" });
    expect(dependencyProblem(candidate({ rules: whenMeal("Halal") }), EVENT)).toEqual({ kind: "condition_cannot_be_kept" });
    expect(dependencyProblem(candidate({ rules: { show_when: { field: "meal", value: true } } }), EVENT)).toEqual({ kind: "condition_cannot_be_kept" });
    expect(dependencyProblem(candidate({ rules: { show_when: { field: "notes", value: true } } }), EVENT)).toEqual({ kind: "condition_cannot_be_kept" });
  });

  it("holds back a condition on a field that others are shown for: a chain of two conditions", () => {
    expect(dependencyProblem(asCondition(parking, { rules: whenMeal("Vegan") }), EVENT)).toEqual({ kind: "condition_cannot_be_kept" });
  });

  it("agrees with the server's check on every case above: a problem is never reported when the server finds none", () => {
    const cases: ConditionField[] = [
      asCondition(parking),
      asCondition(parking, { type: "text" }),
      asCondition(meal, { options: ["Vegetarian"] }),
      candidate({ show_on_form: true, rules: whenParking }),
      candidate({ rules: whenMeal("Halal") }),
      asCondition(parking, { rules: whenMeal("Vegan") }),
    ];
    for (const saved of cases) {
      expect(dependencyProblem(saved, EVENT) === null, JSON.stringify(saved)).toBe(findShowWhenProblem(saved, EVENT) === null);
    }
  });
});

describe("dependencyMessage", () => {
  it("names a field that is shown for an answer, with that answer, and what to do", () => {
    expect(dependencyMessage({ kind: "controls_others", dependents: [plate] }, EVENT)).toBe(
      "“Plate number” (for Yes) is shown only for an answer to this field, so this change can't be saved. Remove its condition first, or undo the change.",
    );
    expect(dependencyMessage({ kind: "controls_others", dependents: [veganNote] }, EVENT)).toBe(
      "“Vegan note” (for “Vegan”) is shown only for an answer to this field, so this change can't be saved. Remove its condition first, or undo the change.",
    );
  });

  it("names two or more fields in a list, in the plural", () => {
    expect(dependencyMessage({ kind: "controls_others", dependents: [plate, veganNote] }, EVENT)).toBe(
      "“Plate number” (for Yes) and “Vegan note” (for “Vegan”) are shown only for an answer to this field, so this change can't be saved. Remove their conditions first, or undo the change.",
    );
    const third = answerField("third", "Third", "text", { rules: whenParking });
    expect(dependencyMessage({ kind: "controls_others", dependents: [plate, veganNote, third] }, [...EVENT, third])).toContain(
      "(for Yes), “Vegan note” (for “Vegan”) and “Third” (for Yes) are shown",
    );
  });

  it("tells two fields with the same label apart by their keys", () => {
    const twin = answerField("plate_2", "Plate number", "text", { rules: whenParking });
    expect(dependencyMessage({ kind: "controls_others", dependents: [plate, twin] }, [parking, plate, twin])).toContain(
      "“Plate number (plate)” (for Yes) and “Plate number (plate_2)” (for Yes)",
    );
  });

  it("says which question is not on the registration form and what to do", () => {
    expect(dependencyMessage({ kind: "controller_not_on_form", controller: parking }, EVENT)).toBe(
      "“Parking” is not on the registration form. A question with a condition can be on the form only when the question it depends on is too. Put “Parking” on the form first, or choose another question.",
    );
  });

  it("says plainly that a condition cannot be kept, and what to do", () => {
    expect(dependencyMessage({ kind: "condition_cannot_be_kept" }, EVENT)).toBe(
      "This condition can't be kept. Choose another question and answer, or remove the condition.",
    );
  });

  it("carries no code and no jargon of the API", () => {
    for (const problem of [
      { kind: "controls_others", dependents: [plate] },
      { kind: "controller_not_on_form", controller: parking },
      { kind: "condition_cannot_be_kept" },
    ] as const) {
      expect(dependencyMessage(problem, EVENT)).not.toMatch(/show_when|invalid_|field_controls|422|409|_/);
    }
  });
});

describe("ownConditionBlockedMessage", () => {
  it("says why a field that others are shown for cannot have a condition itself, naming them", () => {
    expect(ownConditionBlockedMessage([plate], EVENT)).toBe("“Plate number” is shown only for an answer to this field, so it can't have a condition itself.");
    expect(ownConditionBlockedMessage([plate, veganNote], EVENT)).toBe(
      "“Plate number” and “Vegan note” are shown only for an answer to this field, so it can't have a condition itself.",
    );
  });

  it("is empty when nothing depends on the field", () => {
    expect(ownConditionBlockedMessage([], EVENT)).toBe("");
  });
});

describe("deleteBlockedMessage", () => {
  it("says that a field cannot be deleted yet, and which fields are shown for an answer to it", () => {
    expect(deleteBlockedMessage(parking, EVENT)).toBe(
      "“Parking” can't be deleted yet: “Plate number” (for Yes) is shown only for an answer to it. Remove its condition first.",
    );
    const second = answerField("second", "Second", "text", { rules: whenParking });
    expect(deleteBlockedMessage(parking, [...EVENT, second])).toBe(
      "“Parking” can't be deleted yet: “Plate number” (for Yes) and “Second” (for Yes) are shown only for an answer to it. Remove their conditions first.",
    );
  });

  it("is empty for a field that nothing depends on, one that depends on others included", () => {
    expect(deleteBlockedMessage(notes, EVENT)).toBe("");
    expect(deleteBlockedMessage(plate, EVENT)).toBe("");
  });
});

describe("conditionLine", () => {
  it("says which question a field is shown for, and the answer: Yes for yes/no, the option for a choice", () => {
    expect(conditionLine(plate, EVENT)).toBe("Shown only when “Parking” is Yes");
    expect(conditionLine(veganNote, EVENT)).toBe("Shown only when “Meal” is “Vegan”");
  });

  it("is nothing for a field that is always asked", () => {
    expect(conditionLine(parking, EVENT)).toBeNull();
    expect(conditionLine(notes, EVENT)).toBeNull();
    expect(conditionLine({ ...notes, rules: { icon: "car" } }, EVENT)).toBeNull();
  });

  it("names the question by its key when the event no longer has it, and by label and key when two share a label", () => {
    expect(conditionLine(plate, [plate])).toBe("Shown only when “parking” is Yes");
    const twin = answerField("parking_2", "Parking", "boolean");
    expect(conditionLine(plate, [parking, twin, plate])).toBe("Shown only when “Parking (parking)” is Yes");
  });
});
