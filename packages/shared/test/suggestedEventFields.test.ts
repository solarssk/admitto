import { describe, expect, it } from "vitest";
import { findShowWhenProblem, type ConditionField } from "../src/customFieldConditions.js";
import { MAX_CUSTOM_FIELDS_PER_EVENT, guestFormDrawsIcon } from "../src/customFieldTypes.js";
import { SUGGESTED_EVENT_FIELDS, planSuggestedFields, type SuggestedEventField } from "../src/suggestedEventFields.js";

/** A field of the event as the checks of conditions read it, on the form unless said otherwise. */
function field(source_field: string, type: string, extra: Partial<ConditionField> = {}): ConditionField {
  return { source_field, type, show_on_form: true, options: null, rules: null, ...extra };
}

/** What the event holds once the action has created a suggested question. */
function created(suggested: SuggestedEventField): ConditionField {
  return field(suggested.source_field, suggested.type, { options: suggested.options ?? null, rules: suggested.rules ?? null });
}

/** `count` fields of the organiser's own, none of them a suggested key. */
function others(count: number): ConditionField[] {
  return Array.from({ length: count }, (_, index) => field(`own_${index}`, "text"));
}

const keys = (list: readonly SuggestedEventField[]) => list.map((suggested) => suggested.source_field);
const ALL_KEYS = ["parking", "parking_plate", "travel", "arrival", "accommodation"];

describe("SUGGESTED_EVENT_FIELDS", () => {
  it("is parking, the registration number, travel, arrival and accommodation, in that order", () => {
    expect(keys(SUGGESTED_EVENT_FIELDS)).toEqual(ALL_KEYS);
  });

  it("asks yes/no for parking and accommodation, a choice of four for travel, and a date and time for the arrival", () => {
    const byKey = new Map(SUGGESTED_EVENT_FIELDS.map((suggested) => [suggested.source_field, suggested]));
    expect(byKey.get("parking")?.type).toBe("boolean");
    expect(byKey.get("accommodation")?.type).toBe("boolean");
    expect(byKey.get("travel")?.type).toBe("select");
    expect(byKey.get("travel")?.options).toEqual(["Car", "Train", "Plane", "Other"]);
    expect(byKey.get("arrival")?.type).toBe("datetime");
  });

  it("asks for the registration number only of a guest who needs parking, in a short text", () => {
    const plate = SUGGESTED_EVENT_FIELDS.find((suggested) => suggested.source_field === "parking_plate");
    expect(plate?.type).toBe("text");
    expect(plate?.rules?.show_when).toEqual({ field: "parking", value: true });
    expect(plate?.rules?.max_length).toBeLessThanOrEqual(12);
    expect(plate?.rules?.example).toBeTruthy();
  });

  it("names each field by a plain key, once, and words each question for a guest", () => {
    expect(new Set(keys(SUGGESTED_EVENT_FIELDS)).size).toBe(SUGGESTED_EVENT_FIELDS.length);
    for (const suggested of SUGGESTED_EVENT_FIELDS) {
      expect(suggested.source_field, suggested.source_field).toMatch(/^[a-z0-9_]{1,60}$/);
      expect(suggested.label.trim().length, suggested.source_field).toBeGreaterThan(0);
      expect(suggested.label.length, suggested.source_field).toBeLessThanOrEqual(60);
      expect(suggested.description?.length ?? 0, suggested.source_field).toBeLessThanOrEqual(500);
      // A select needs options, and nothing else has them.
      expect(suggested.options !== undefined, suggested.source_field).toBe(suggested.type === "select");
    }
  });

  it("asks no question about health, disability or accessibility, and none about a companion", () => {
    const text = JSON.stringify(SUGGESTED_EVENT_FIELDS).toLowerCase();
    for (const word of ["accessib", "mobility", "disab", "health", "medical", "companion", "guest name", "plus one", "+1"]) {
      expect(text, word).not.toContain(word);
    }
  });

  it("promises an icon only where the registration form draws one", () => {
    for (const suggested of SUGGESTED_EVENT_FIELDS) {
      if (suggested.rules?.icon === undefined) continue;
      expect(guestFormDrawsIcon({ type: suggested.type, required: false }), suggested.source_field).toBe(true);
    }
  });

  it("puts a question after the one it depends on, and every condition holds as the fields are created one by one", () => {
    const createdSoFar: ConditionField[] = [];
    for (const suggested of SUGGESTED_EVENT_FIELDS) {
      expect(findShowWhenProblem(created(suggested), createdSoFar), suggested.source_field).toBeNull();
      createdSoFar.push(created(suggested));
    }
  });

  it("leaves room in an event's field limit", () => {
    expect(SUGGESTED_EVENT_FIELDS.length).toBeLessThan(MAX_CUSTOM_FIELDS_PER_EVENT);
  });
});

describe("planSuggestedFields", () => {
  it("adds all five, in the order of the set, to an event with no fields", () => {
    const plan = planSuggestedFields([]);

    expect(keys(plan.add)).toEqual(ALL_KEYS);
    expect(plan.present).toEqual([]);
    expect(plan.blocked).toEqual([]);
    expect(plan.overLimitBy).toBe(0);
  });

  it("adds nothing the second time: every suggested key is there, and none of them is touched", () => {
    const plan = planSuggestedFields(SUGGESTED_EVENT_FIELDS.map((suggested) => created(suggested)));

    expect(plan.add).toEqual([]);
    expect(keys(plan.present)).toEqual(ALL_KEYS);
    expect(plan.blocked).toEqual([]);
    expect(plan.overLimitBy).toBe(0);
  });

  it("leaves a question the organiser has as it is, whatever they changed, and adds the rest", () => {
    // The organiser made "travel" a long text and took "parking" off the form: the key is what counts.
    const changed = [field("travel", "long_text"), field("parking", "boolean", { show_on_form: false })];

    const plan = planSuggestedFields(changed);

    expect(keys(plan.present)).toEqual(["parking", "travel"]);
    // The plate would be on the form while the question it depends on is not, so it is left out as well.
    expect(keys(plan.add)).toEqual(["arrival", "accommodation"]);
    expect(keys(plan.blocked)).toEqual(["parking_plate"]);
  });

  it("adds a question that depends on one it adds in the same go, and one that depends on a yes/no question the event has", () => {
    expect(keys(planSuggestedFields([]).add)).toContain("parking_plate");
    const own = planSuggestedFields([field("parking", "boolean")]);
    expect(keys(own.add)).toEqual(["parking_plate", "travel", "arrival", "accommodation"]);
    expect(own.blocked).toEqual([]);
  });

  it("leaves out the registration number when the event's own parking field cannot be what it depends on", () => {
    for (const parking of [
      field("parking", "text"),
      field("parking", "boolean", { show_on_form: false }),
      field("parking", "boolean", { rules: { show_when: { field: "other", value: true } } }),
    ]) {
      const plan = planSuggestedFields([parking, field("other", "boolean")]);
      expect(keys(plan.present), JSON.stringify(parking)).toEqual(["parking"]);
      expect(keys(plan.blocked), JSON.stringify(parking)).toEqual(["parking_plate"]);
      expect(keys(plan.add), JSON.stringify(parking)).toEqual(["travel", "arrival", "accommodation"]);
    }
  });

  it("adds the parking question when only the registration number is there, and leaves the number alone", () => {
    const plan = planSuggestedFields([field("parking_plate", "text")]);

    expect(keys(plan.present)).toEqual(["parking_plate"]);
    expect(keys(plan.add)).toEqual(["parking", "travel", "arrival", "accommodation"]);
  });

  it("counts a key that is only a prefix of a suggested one as a different field", () => {
    const plan = planSuggestedFields([field("park", "text"), field("parking_", "text")]);

    expect(keys(plan.add)).toEqual(ALL_KEYS);
  });

  it("reports how far over the limit the questions to add would take the event, and fits them exactly up to it", () => {
    const room = MAX_CUSTOM_FIELDS_PER_EVENT - ALL_KEYS.length;

    expect(planSuggestedFields(others(room)).overLimitBy).toBe(0);
    expect(planSuggestedFields(others(room + 1)).overLimitBy).toBe(1);
    expect(planSuggestedFields(others(MAX_CUSTOM_FIELDS_PER_EVENT)).overLimitBy).toBe(ALL_KEYS.length);
  });

  it("counts only the questions that would be added against the limit", () => {
    // Two suggested keys are there already, so three are to add: 17 fields fit them, 18 do not.
    const withTwo = [field("parking", "boolean"), field("travel", "select", { options: ["Car"] })];

    expect(planSuggestedFields([...withTwo, ...others(MAX_CUSTOM_FIELDS_PER_EVENT - 5)]).overLimitBy).toBe(0);
    expect(planSuggestedFields([...withTwo, ...others(MAX_CUSTOM_FIELDS_PER_EVENT - 4)]).overLimitBy).toBe(1);
  });

  it("is not over the limit when there is nothing to add, even in an event at or above it", () => {
    const everything = SUGGESTED_EVENT_FIELDS.map((suggested) => created(suggested));

    const full = planSuggestedFields([...everything, ...others(MAX_CUSTOM_FIELDS_PER_EVENT - everything.length)]);
    const above = planSuggestedFields([...everything, ...others(MAX_CUSTOM_FIELDS_PER_EVENT)]);

    expect(full.add).toEqual([]);
    expect(full.overLimitBy).toBe(0);
    expect(above.add).toEqual([]);
    expect(above.overLimitBy).toBe(0);
  });

  it("does not change the fields it is given", () => {
    const existing = [field("parking", "text")];
    const snapshot = JSON.stringify(existing);

    planSuggestedFields(existing);

    expect(JSON.stringify(existing)).toBe(snapshot);
  });
});
