import { describe, expect, it } from "vitest";
import { EVENT_CUSTOM_FIELD_TYPES, type EventCustomFieldRules } from "../src/customFieldTypes.js";
import {
  acceptsCondition,
  controlsOtherFields,
  dependentsOf,
  findShowWhenProblem,
  type ConditionField,
} from "../src/customFieldConditions.js";

function field(source_field: string, type: string, extra: Partial<ConditionField> = {}): ConditionField {
  return { source_field, type, show_on_form: false, options: null, rules: null, ...extra };
}

const whenParking: EventCustomFieldRules = { show_when: { field: "parking", value: true } };
const whenBoth: EventCustomFieldRules = { show_when: { field: "day", value: "Both" } };

const parking = field("parking", "boolean");
const day = field("day", "select", { options: ["Day 1", "Day 2", "Both"] });

describe("findShowWhenProblem: the condition of the field itself", () => {
  it("accepts a condition on a yes/no field, and on a select field that has the option", () => {
    expect(findShowWhenProblem(field("plate", "text", { rules: whenParking }), [parking, day])).toBeNull();
    expect(findShowWhenProblem(field("badge", "text", { rules: whenBoth }), [parking, day])).toBeNull();
  });

  it("accepts a field of every type as the one with the condition", () => {
    for (const type of EVENT_CUSTOM_FIELD_TYPES) {
      expect(findShowWhenProblem(field("dependent", type, { rules: whenParking }), [parking]), type).toBeNull();
    }
  });

  it("accepts a field without a condition, with or without other fields", () => {
    expect(findShowWhenProblem(field("plate", "text"), [])).toBeNull();
    expect(findShowWhenProblem(field("plate", "text"), [parking, day])).toBeNull();
    expect(findShowWhenProblem(field("plate", "text", { rules: { icon: "car", min_length: 2 } }), [parking])).toBeNull();
  });

  it("refuses a field that the event does not have", () => {
    expect(findShowWhenProblem(field("plate", "text", { rules: whenParking }), [day])).toBe("invalid_show_when");
    expect(findShowWhenProblem(field("plate", "text", { rules: whenParking }), [])).toBe("invalid_show_when");
  });

  it("refuses a field that depends on itself, whether or not its old form is among the fields", () => {
    const self = field("parking", "boolean", { rules: whenParking });
    expect(findShowWhenProblem(self, [day])).toBe("invalid_show_when");
    expect(findShowWhenProblem(self, [self, day])).toBe("invalid_show_when");
    // Its old form has no condition, so only leaving it out makes the field a stranger to itself.
    expect(findShowWhenProblem(self, [parking, day])).toBe("invalid_show_when");
    const picker = field("pick", "select", { options: ["A"], rules: { show_when: { field: "pick", value: "A" } } });
    expect(findShowWhenProblem(picker, [field("pick", "select", { options: ["A"] })])).toBe("invalid_show_when");
  });

  it("leaves out the old form of the field itself: it is judged as it will be, not as it was", () => {
    const plate = field("plate", "text", { rules: whenParking });
    expect(findShowWhenProblem(plate, [parking, field("plate", "text")])).toBeNull();
    expect(findShowWhenProblem(plate, [parking, field("plate", "text", { rules: { show_when: { field: "nothing", value: true } } })])).toBeNull();
    // A controller that is saved as another type is not judged by its old type.
    const retyped = field("parking", "text");
    expect(findShowWhenProblem(retyped, [parking])).toBeNull();
    expect(findShowWhenProblem(retyped, [parking, plate])).toBe("field_controls_others");
  });

  it("refuses a field that is neither yes/no nor select, whatever type it is", () => {
    for (const type of ["text", "long_text", "date", "datetime", "phone", "weird", ""]) {
      const controller = field("parking", type, { options: ["true"] });
      expect(findShowWhenProblem(field("plate", "text", { rules: whenParking }), [controller]), type).toBe("invalid_show_when");
    }
  });

  it("refuses an answer that the field cannot have", () => {
    // A yes/no field is asked about with true, never with a text.
    const withText = { show_when: { field: "parking", value: "true" } };
    expect(findShowWhenProblem(field("plate", "text", { rules: withText }), [parking])).toBe("invalid_show_when");
    // A select field is asked about with one of its options, never with true.
    const withTrue = { show_when: { field: "day", value: true as const } };
    expect(findShowWhenProblem(field("badge", "text", { rules: withTrue }), [day])).toBe("invalid_show_when");
    const unknownOption = { show_when: { field: "day", value: "Day 3" } };
    expect(findShowWhenProblem(field("badge", "text", { rules: unknownOption }), [day])).toBe("invalid_show_when");
    // The option is compared as it is written: case and spaces count.
    for (const value of ["both", "Both ", " Both", "BOTH"]) {
      expect(findShowWhenProblem(field("badge", "text", { rules: { show_when: { field: "day", value } } }), [day]), value).toBe("invalid_show_when");
    }
  });

  it("refuses a select field that has no options", () => {
    for (const options of [null, undefined, []]) {
      const bare = field("day", "select", { options });
      expect(findShowWhenProblem(field("badge", "text", { rules: whenBoth }), [bare]), String(options)).toBe("invalid_show_when");
    }
  });

  it("refuses a field that has a condition of its own: no chain of two conditions", () => {
    const controller = field("parking", "boolean", { rules: { show_when: { field: "day", value: "Both" } } });
    expect(findShowWhenProblem(field("plate", "text", { rules: whenParking }), [controller, day])).toBe("invalid_show_when");
  });

  it("refuses a condition for a field that other fields depend on: no chain in the other direction", () => {
    const dependent = field("plate", "text", { rules: whenParking });
    const asDependent = field("parking", "boolean", { rules: whenBoth });
    expect(findShowWhenProblem(asDependent, [dependent, day])).toBe("invalid_show_when");
  });

  it("refuses a cycle of two fields, whichever of them is saved last", () => {
    const first = field("a", "boolean", { rules: { show_when: { field: "b", value: true } } });
    const second = field("b", "boolean");
    // `a` depends on `b`, which is allowed while `b` has no condition.
    expect(findShowWhenProblem(first, [second])).toBeNull();
    // Saving a condition on `b` that points at `a` would close the cycle.
    const closing = field("b", "boolean", { rules: { show_when: { field: "a", value: true } } });
    expect(findShowWhenProblem(closing, [first])).toBe("invalid_show_when");
    // And the same cycle, saved the other way round.
    const stored = field("b", "boolean", { rules: { show_when: { field: "a", value: true } } });
    expect(findShowWhenProblem(field("a", "boolean", { rules: { show_when: { field: "b", value: true } } }), [stored])).toBe("invalid_show_when");
  });

  it("does not look a prototype key up on the prototype chain: such a field is not found", () => {
    for (const key of ["__proto__", "constructor", "prototype", "toString", "hasOwnProperty"]) {
      const rules = { show_when: { field: key, value: true as const } };
      expect(findShowWhenProblem(field("plate", "text", { rules }), [parking, day]), key).toBe("invalid_show_when");
    }
  });

  it("finds a field that is itself named like a prototype key", () => {
    for (const key of ["__proto__", "constructor"]) {
      const controller = field(key, "boolean");
      const rules = { show_when: { field: key, value: true as const } };
      expect(findShowWhenProblem(field("plate", "text", { rules }), [controller]), key).toBeNull();
    }
  });
});

describe("findShowWhenProblem: whose answer a field asks for", () => {
  const companionParking = field("parking", "boolean", { applies_to: "companion" });
  const companionDay = field("day", "select", { options: ["Day 1", "Both"], applies_to: "companion" });

  it("refuses a question about the guest that waits for a question about their companion", () => {
    expect(findShowWhenProblem(field("plate", "text", { rules: whenParking }), [companionParking])).toBe("invalid_show_when");
    expect(findShowWhenProblem(field("plate", "text", { rules: whenParking, applies_to: "guest" }), [companionParking])).toBe("invalid_show_when");
  });

  it("refuses a question about the companion that waits for a question about the guest, and for one that has no recipient written", () => {
    const plate = field("plate", "text", { rules: whenParking, applies_to: "companion" });
    expect(findShowWhenProblem(plate, [parking])).toBe("invalid_show_when");
    expect(findShowWhenProblem(plate, [field("parking", "boolean", { applies_to: "guest" })])).toBe("invalid_show_when");
    expect(findShowWhenProblem(plate, [field("parking", "boolean", { applies_to: null })])).toBe("invalid_show_when");
  });

  it("refuses to save a question that others wait for when they are about the other recipient, from either side", () => {
    const guestDependent = field("plate", "text", { rules: whenParking });
    const companionDependent = field("plate", "text", { rules: whenParking, applies_to: "companion" });
    // The dependent was written to the database with a recipient other than the controller's: saving the controller refuses it.
    expect(findShowWhenProblem(companionParking, [guestDependent])).toBe("field_controls_others");
    expect(findShowWhenProblem(parking, [companionDependent])).toBe("field_controls_others");
    expect(findShowWhenProblem(companionParking, [companionDependent])).toBeNull();
    expect(findShowWhenProblem(parking, [guestDependent])).toBeNull();
  });

  it("accepts a question about the companion that waits for another question about the companion, by the rules of any other condition", () => {
    const plate = field("plate", "text", { rules: whenParking, applies_to: "companion" });
    expect(findShowWhenProblem(plate, [companionParking])).toBeNull();
    expect(findShowWhenProblem(field("badge", "text", { rules: whenBoth, applies_to: "companion" }), [companionDay])).toBeNull();
    // The rules are the same: the answer must be one the question can have, and a condition has no chain.
    expect(findShowWhenProblem(field("badge", "text", { rules: { show_when: { field: "day", value: "Never" } }, applies_to: "companion" }), [companionDay])).toBe("invalid_show_when");
    expect(findShowWhenProblem(plate, [{ ...companionParking, rules: whenBoth }, companionDay])).toBe("invalid_show_when");
  });

  it("takes a field with no recipient written as the guest's, as the database does", () => {
    expect(findShowWhenProblem(field("plate", "text", { rules: whenParking, applies_to: undefined }), [parking])).toBeNull();
    expect(findShowWhenProblem(field("plate", "text", { rules: whenParking, applies_to: null }), [parking])).toBeNull();
    expect(findShowWhenProblem(field("plate", "text", { rules: whenParking }), [field("parking", "boolean", { applies_to: "guest" })])).toBeNull();
  });
});

describe("findShowWhenProblem: the form", () => {
  const dependent = (on: boolean) => field("plate", "text", { show_on_form: on, rules: whenParking });
  const controller = (on: boolean) => field("parking", "boolean", { show_on_form: on });

  it("lets a question with a condition be on the form only when the question it depends on is", () => {
    expect(findShowWhenProblem(dependent(true), [controller(true)])).toBeNull();
    expect(findShowWhenProblem(dependent(true), [controller(false)])).toBe("show_when_not_on_form");
  });

  it("lets a question with a condition stay off the form, whatever the other one does", () => {
    expect(findShowWhenProblem(dependent(false), [controller(true)])).toBeNull();
    expect(findShowWhenProblem(dependent(false), [controller(false)])).toBeNull();
  });

  it("refuses to take the question that others depend on off the form while one of them is on it", () => {
    expect(findShowWhenProblem(controller(false), [dependent(true)])).toBe("show_when_not_on_form");
    expect(findShowWhenProblem(controller(false), [dependent(false)])).toBeNull();
    expect(findShowWhenProblem(controller(true), [dependent(true)])).toBeNull();
  });

  it("looks at every dependent: one on the form is enough to refuse", () => {
    const quiet = field("quiet", "text", { show_on_form: false, rules: whenParking });
    expect(findShowWhenProblem(controller(false), [quiet, dependent(true)])).toBe("show_when_not_on_form");
    expect(findShowWhenProblem(controller(false), [quiet])).toBeNull();
  });
});

describe("findShowWhenProblem: a field that others depend on", () => {
  const dependent = field("plate", "text", { rules: whenParking });
  const badge = field("badge", "text", { rules: whenBoth });

  it("lets a field that others depend on change what does not matter, and stay the same type", () => {
    expect(findShowWhenProblem(parking, [dependent])).toBeNull();
    expect(findShowWhenProblem(day, [badge])).toBeNull();
    expect(findShowWhenProblem(field("parking", "boolean", { rules: { icon: "car" } }), [dependent])).toBeNull();
  });

  it("refuses to change the type of a field that others depend on", () => {
    for (const type of ["text", "long_text", "date", "datetime", "phone", "weird"]) {
      expect(findShowWhenProblem(field("parking", type), [dependent]), `boolean to ${type}`).toBe("field_controls_others");
      expect(findShowWhenProblem(field("day", type, { options: ["Both"] }), [badge]), `select to ${type}`).toBe("field_controls_others");
    }
  });

  it("refuses to change a yes/no field into a select field, and a select field into a yes/no field", () => {
    expect(findShowWhenProblem(field("parking", "select", { options: ["true", "false"] }), [dependent])).toBe("field_controls_others");
    expect(findShowWhenProblem(field("day", "boolean"), [badge])).toBe("field_controls_others");
  });

  it("refuses to remove the option that another field is shown for, and lets the other options go", () => {
    expect(findShowWhenProblem(field("day", "select", { options: ["Day 1", "Day 2"] }), [badge])).toBe("field_controls_others");
    expect(findShowWhenProblem(field("day", "select", { options: [] }), [badge])).toBe("field_controls_others");
    expect(findShowWhenProblem(field("day", "select", { options: null }), [badge])).toBe("field_controls_others");
    expect(findShowWhenProblem(field("day", "select", { options: ["Both"] }), [badge])).toBeNull();
    expect(findShowWhenProblem(field("day", "select", { options: ["Day 1", "Both", "Day 3"] }), [badge])).toBeNull();
  });

  it("treats a renamed option as a removed one", () => {
    expect(findShowWhenProblem(field("day", "select", { options: ["Day 1", "Day 2", "Both days"] }), [badge])).toBe("field_controls_others");
  });

  it("checks every dependent, each against its own answer", () => {
    const first = field("first", "text", { rules: { show_when: { field: "day", value: "Day 1" } } });
    expect(findShowWhenProblem(field("day", "select", { options: ["Day 1", "Both"] }), [first, badge])).toBeNull();
    expect(findShowWhenProblem(field("day", "select", { options: ["Both"] }), [first, badge])).toBe("field_controls_others");
  });

  it("lets a field that nothing depends on change in any way", () => {
    expect(findShowWhenProblem(field("parking", "text"), [])).toBeNull();
    expect(findShowWhenProblem(field("parking", "text"), [badge])).toBeNull();
    expect(findShowWhenProblem(field("day", "select", { options: ["Day 1"] }), [dependent])).toBeNull();
  });

  it("reports the problem of the field itself first", () => {
    // `parking` is made a text field that depends on a missing field, while `plate` depends on it.
    const both = field("parking", "text", { rules: { show_when: { field: "missing", value: true } } });
    expect(findShowWhenProblem(both, [dependent])).toBe("invalid_show_when");
  });
});

describe("controlsOtherFields", () => {
  it("is true when another field is shown for an answer to this one", () => {
    const dependent = field("plate", "text", { rules: whenParking });
    expect(controlsOtherFields("parking", [dependent, day])).toBe(true);
    expect(controlsOtherFields("day", [dependent])).toBe(false);
    expect(controlsOtherFields("parking", [])).toBe(false);
    expect(controlsOtherFields("parking", [day, field("plate", "text")])).toBe(false);
  });

  it("does not count a field that depends on itself, so such a field can still be deleted", () => {
    const self = field("loop", "boolean", { rules: { show_when: { field: "loop", value: true } } });
    expect(controlsOtherFields("loop", [self])).toBe(false);
    expect(controlsOtherFields("loop", [self, field("plate", "text", { rules: { show_when: { field: "loop", value: true } } })])).toBe(true);
  });

  it("matches the key exactly, and reads no prototype key", () => {
    const dependent = field("plate", "text", { rules: whenParking });
    expect(controlsOtherFields("Parking", [dependent])).toBe(false);
    expect(controlsOtherFields("parkin", [dependent])).toBe(false);
    expect(controlsOtherFields("constructor", [dependent])).toBe(false);
    expect(controlsOtherFields("__proto__", [dependent])).toBe(false);
  });
});

describe("dependentsOf", () => {
  const plate = field("plate", "text", { rules: whenParking });
  const badge = field("badge", "text", { rules: whenBoth });

  it("lists the fields that are shown for an answer to this one, in the order they come", () => {
    const second = field("second", "text", { rules: whenParking });
    expect(dependentsOf("parking", [plate, badge, second, day])).toEqual([plate, second]);
    expect(dependentsOf("day", [plate, badge])).toEqual([badge]);
  });

  it("is empty when nothing depends on the field, and agrees with controlsOtherFields", () => {
    expect(dependentsOf("parking", [])).toEqual([]);
    expect(dependentsOf("lunch", [plate, badge, day])).toEqual([]);
    for (const key of ["parking", "day", "lunch"]) {
      expect(controlsOtherFields(key, [plate, badge]), key).toBe(dependentsOf(key, [plate, badge]).length > 0);
    }
  });

  it("leaves the field that depends on itself out, and hands back the objects it was given", () => {
    const self = field("loop", "boolean", { rules: { show_when: { field: "loop", value: true } } });
    expect(dependentsOf("loop", [self])).toEqual([]);
    const withLabel = { ...plate, label: "Plate number" };
    expect(dependentsOf("parking", [withLabel])[0]).toBe(withLabel);
  });
});

describe("acceptsCondition", () => {
  it("takes true for a yes/no field and an option for a select field, and nothing for any other type", () => {
    expect(acceptsCondition(parking, { field: "parking", value: true })).toBe(true);
    expect(acceptsCondition(parking, { field: "parking", value: "true" })).toBe(false);
    expect(acceptsCondition(day, { field: "day", value: "Both" })).toBe(true);
    expect(acceptsCondition(day, { field: "day", value: "Day 3" })).toBe(false);
    expect(acceptsCondition(day, { field: "day", value: true })).toBe(false);
    for (const type of ["text", "long_text", "date", "datetime", "phone", "weird"]) {
      expect(acceptsCondition(field("x", type), { field: "x", value: true }), type).toBe(false);
    }
  });
});
