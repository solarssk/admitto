import { CONTACT_PHONE_MAX_DIGITS } from "./contactPhone.js";

/** The answer types of an event's custom attendee fields (`EventCustomField.type`), in the order an
 * editor lists them. Every layer that reads a field's type (the admin API, the import, the
 * registration form, the admin app) takes the list from here. The column is plain text, so a new
 * type needs no migration. */
export const EVENT_CUSTOM_FIELD_TYPES = [
  "text",
  "long_text",
  "date",
  "datetime",
  "phone",
  "select",
  "boolean",
] as const;

export type EventCustomFieldType = (typeof EVENT_CUSTOM_FIELD_TYPES)[number];

/** Longest `text` answer, in characters. */
export const EVENT_CUSTOM_FIELD_TEXT_MAX = 100;
/** Longest `long_text` answer, in characters. */
export const EVENT_CUSTOM_FIELD_LONG_TEXT_MAX = 1000;
/** Longest `rules.example`, in characters. */
export const EVENT_CUSTOM_FIELD_EXAMPLE_MAX = 100;

/** Format rules of a field (`EventCustomField.rules`, null = none). Plain switches and numbers, read
 * literally by the code: there is no pattern an organiser types, so a rule can never be a
 * backtracking risk. `min_length` and `max_length` count characters of the stored answer (a
 * phone number is stored as an optional + and its digits); `digits_only` allows only 0 to 9;
 * `example` is a hint shown next to the field and never checked against the answer. They apply to
 * `text`, `long_text` and `phone` only (see eventCustomFieldRulesMaxLength). */
export type EventCustomFieldRules = {
  min_length?: number;
  max_length?: number;
  digits_only?: boolean;
  example?: string;
};

/** The longest answer a field of this type can hold, which is also the largest length a rule may
 * name for it, or null when the type takes no rules (every type except `text`, `long_text` and
 * `phone`). A phone number is stored as an optional + and up to 15 digits. */
export function eventCustomFieldRulesMaxLength(type: string): number | null {
  switch (type) {
    case "text":
      return EVENT_CUSTOM_FIELD_TEXT_MAX;
    case "long_text":
      return EVENT_CUSTOM_FIELD_LONG_TEXT_MAX;
    case "phone":
      return CONTACT_PHONE_MAX_DIGITS + 1;
    default:
      return null;
  }
}
