import { findShowWhenProblem, type ConditionField } from "./customFieldConditions.js";
import { MAX_CUSTOM_FIELDS_PER_EVENT, type EventCustomFieldRules, type EventCustomFieldType } from "./customFieldTypes.js";

/**
 * One question of the set that "Add suggested questions" gives an event (Registration > Fields). It is a field definition as the
 * ordinary "Add field" takes it, and it is created in exactly that way, so the organiser can change or delete it afterwards like
 * any other field. Every suggested question is optional and goes on the registration form (`required: false`, `show_on_form: true`):
 * that is what the action does with all of them, so it is not repeated in each definition.
 */
export type SuggestedEventField = {
  /** The key of the field. Fixed: the action is idempotent by it, so a question the event already has under this key is left alone. */
  readonly source_field: string;
  /** The question a guest reads. */
  readonly label: string;
  readonly description?: string;
  readonly type: EventCustomFieldType;
  /** The options of a single choice. */
  readonly options?: readonly string[];
  readonly rules?: Readonly<EventCustomFieldRules>;
};

/**
 * The questions that "Add suggested questions" offers: parking, travel and accommodation. Plain data, defined once: the admin app lists
 * them before they are added, the server creates the fields from them, and the tests hold them to the schemas and the checks of a field
 * that is added by hand. A question comes after the one it depends on, because that is the order they are created in.
 *
 * Deliberately not in the set: a question about accessibility or mobility needs (health data, GDPR Art. 9: it needs the organiser's own
 * decision and basis, and Admitto adds none by itself), a question about a companion (that is a setting of the event), and company and
 * department (switches of the form). The set is a first version: the wording, the order and the icons are what an organiser changes.
 */
export const SUGGESTED_EVENT_FIELDS: readonly SuggestedEventField[] = [
  {
    source_field: "parking",
    label: "Do you need a parking space?",
    type: "boolean",
    rules: { icon: "parking" },
  },
  {
    source_field: "parking_plate",
    label: "Registration number",
    description: "The registration number of your car, used for parking access.",
    type: "text",
    // Up to 12 characters holds the plates of most countries, with their spaces and dashes.
    rules: { max_length: 12, example: "AB 123 CD", icon: "car", show_when: { field: "parking", value: true } },
  },
  {
    // A single choice draws no icon on the form (guestFormDrawsIcon), so none is saved.
    source_field: "travel",
    label: "How will you get here?",
    type: "select",
    options: ["Car", "Train", "Plane", "Other"],
  },
  {
    source_field: "arrival",
    label: "Arrival (date and time)",
    description: "Your best estimate is fine.",
    type: "datetime",
    rules: { icon: "clock" },
  },
  {
    source_field: "accommodation",
    label: "Do you need accommodation?",
    type: "boolean",
    rules: { icon: "bed" },
  },
];

/** What the action would do with the suggested questions in an event that has these fields. */
export type SuggestedFieldsPlan = {
  /** To be created, in the order to create them in. */
  readonly add: readonly SuggestedEventField[];
  /** The event has a field under this key already. It stays exactly as the organiser has it. */
  readonly present: readonly SuggestedEventField[];
  /** The key is free, but the question depends on a field of the event that cannot be what it depends on (it is not a yes/no or choice
   * question, is not on the form, or has a condition of its own): adding it would break the conditions between fields. Left out. */
  readonly blocked: readonly SuggestedEventField[];
  /** How many fields the event would have above the limit if everything in `add` were created; 0 when it fits, and when there is nothing
   * to add. The action is all or nothing: when this is not 0, it creates none. */
  readonly overLimitBy: number;
};

/** A suggested question as the checks of conditions between fields see it, once it is on the form. */
function asConditionField(suggested: SuggestedEventField): ConditionField {
  return {
    source_field: suggested.source_field,
    type: suggested.type,
    show_on_form: true,
    options: suggested.options ?? null,
    rules: suggested.rules ?? null,
  };
}

/**
 * Sorts the suggested questions into those to add, those the event has already and those that cannot be added, for an event whose
 * fields are `existing`. The one rule of the action: the server decides what it creates with it, and the admin app tells the
 * organiser the same thing before asking. It is the server's own check of conditions (`findShowWhenProblem`), run in the order of the
 * set with the questions added so far counted as fields, so a question that depends on one added in the same go is fine.
 */
export function planSuggestedFields(existing: readonly ConditionField[]): SuggestedFieldsPlan {
  const keys = new Set(existing.map((field) => field.source_field));
  const known: ConditionField[] = [...existing];
  const add: SuggestedEventField[] = [];
  const present: SuggestedEventField[] = [];
  const blocked: SuggestedEventField[] = [];
  for (const suggested of SUGGESTED_EVENT_FIELDS) {
    if (keys.has(suggested.source_field)) {
      present.push(suggested);
      continue;
    }
    const candidate = asConditionField(suggested);
    if (findShowWhenProblem(candidate, known) !== null) {
      blocked.push(suggested);
      continue;
    }
    add.push(suggested);
    known.push(candidate);
  }
  const overLimitBy = add.length === 0 ? 0 : Math.max(0, existing.length + add.length - MAX_CUSTOM_FIELDS_PER_EVENT);
  return { add, present, blocked, overLimitBy };
}
