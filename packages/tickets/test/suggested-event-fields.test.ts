import { describe, expect, it } from "vitest";
import { MAX_CUSTOM_FIELDS_PER_EVENT as SHARED_MAX_CUSTOM_FIELDS_PER_EVENT, SUGGESTED_EVENT_FIELDS, type SuggestedEventField } from "@admitto/shared";
import { isReservedCustomDataSourceField } from "../src/custom-data-reserved.js";
import { eventCustomFieldRulesFitType, eventCustomFieldRulesSchema } from "../src/custom-field-rules.js";
import { MAX_CUSTOM_FIELDS_PER_EVENT, RegistrantInputError, buildRegistrantCustomData, type RegistrantFormField } from "../src/registrant-input.js";

/** The suggested questions as the registration form's reader gets the fields of an event: on the form, optional. */
function formFields(): RegistrantFormField[] {
  return SUGGESTED_EVENT_FIELDS.map((suggested: SuggestedEventField) => ({
    label: suggested.label,
    source_field: suggested.source_field,
    type: suggested.type,
    show_on_form: true,
    ...(suggested.options ? { options: [...suggested.options] } : {}),
    ...(suggested.rules ? { rules: structuredClone(suggested.rules) } : {}),
  }));
}

describe("the suggested questions, held to the checks of a field that is added by hand", () => {
  it("has rules that the strict rules schema reads back as they are", () => {
    for (const suggested of SUGGESTED_EVENT_FIELDS) {
      if (suggested.rules === undefined) continue;
      const parsed = eventCustomFieldRulesSchema.safeParse(suggested.rules);
      expect(parsed.success, suggested.source_field).toBe(true);
      expect(parsed.data, suggested.source_field).toEqual(suggested.rules);
    }
  });

  it("has rules that fit the type of each question", () => {
    for (const suggested of SUGGESTED_EVENT_FIELDS) {
      expect(eventCustomFieldRulesFitType(suggested.type, suggested.rules), suggested.source_field).toBe(true);
    }
  });

  it("does not use a key that an import column or a profile field already owns", () => {
    for (const suggested of SUGGESTED_EVENT_FIELDS) {
      expect(isReservedCustomDataSourceField(suggested.source_field), suggested.source_field).toBe(false);
    }
  });

  it("takes the cap on fields from the same place as the server does", () => {
    expect(MAX_CUSTOM_FIELDS_PER_EVENT).toBe(SHARED_MAX_CUSTOM_FIELDS_PER_EVENT);
  });
});

describe("the suggested questions, as a guest answers them", () => {
  it("accepts a sensible answer to every one of them", () => {
    const answers = { parking: "true", parking_plate: "AB 123 CD", travel: "Plane", arrival: "2026-11-05T14:30", accommodation: "true" };

    expect(buildRegistrantCustomData(formFields(), answers)).toEqual(answers);
  });

  it("asks for the registration number only after a yes to parking, and never stores one given without it", () => {
    expect(buildRegistrantCustomData(formFields(), { parking_plate: "AB 123 CD", travel: "Train" })).toEqual({ travel: "Train" });
    expect(buildRegistrantCustomData(formFields(), { parking: "true", parking_plate: "AB 123 CD" })).toEqual({
      parking: "true",
      parking_plate: "AB 123 CD",
    });
  });

  it("takes an empty form: no question of the set is required", () => {
    expect(buildRegistrantCustomData(formFields(), {})).toBeUndefined();
  });

  it("refuses a travel answer that is not one of the options, and a registration number longer than it should be", () => {
    expect(() => buildRegistrantCustomData(formFields(), { travel: "Rocket" })).toThrow(RegistrantInputError);
    expect(() => buildRegistrantCustomData(formFields(), { parking: "true", parking_plate: "A".repeat(13) })).toThrow(RegistrantInputError);
  });
});
