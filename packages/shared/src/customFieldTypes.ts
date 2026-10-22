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

/** The types a person types or picks freely (everything except a choice among options and yes/no).
 * A list filter for these is a "contains" text box, not a list of options. */
export function isFreeInputCustomFieldType(type: string): boolean {
  return type === "text" || type === "long_text" || type === "date" || type === "datetime" || type === "phone";
}

/** Longest `text` answer, in characters. */
export const EVENT_CUSTOM_FIELD_TEXT_MAX = 100;
/** Longest `long_text` answer, in characters. */
export const EVENT_CUSTOM_FIELD_LONG_TEXT_MAX = 1000;
/** Longest `rules.example`, in characters. */
export const EVENT_CUSTOM_FIELD_EXAMPLE_MAX = 100;
/** Most entries in `rules.suggestions`. */
export const EVENT_CUSTOM_FIELD_SUGGESTIONS_MAX = 30;
/** Longest entry of `rules.suggestions`, in characters. */
export const EVENT_CUSTOM_FIELD_SUGGESTION_MAX = 100;

/** What a suggestion may not hold. A suggestion is offered to the guest and, when picked, sent back as the answer,
 * so it is held to the rule that answers are held to (normalizeRegistrantText in packages/tickets): no control
 * character, no format character (zero-width and bidi marks, the soft hyphen, the byte order mark), no lone
 * surrogate, nothing Unicode marks default-ignorable (variation selectors among them), no line or paragraph
 * separator and no noncharacter. A test in packages/tickets keeps the two in step. */
const FORBIDDEN_IN_SUGGESTION = /[\p{Cc}\p{Cf}\p{Cs}\p{Default_Ignorable_Code_Point}\u2028\u2029\uFFFE\uFFFF]/u;

/** True when `text` holds a character that a suggestion may not hold (see FORBIDDEN_IN_SUGGESTION). The server's check of
 * `rules.suggestions` and the field editor of the admin app both call it, so they refuse the same text. */
export function hasForbiddenSuggestionCharacter(text: string): boolean {
  return FORBIDDEN_IN_SUGGESTION.test(text);
}

/** The key two suggestions are compared by: the same letters in another case, or written as a base letter and a
 * combining mark instead of one character, are the same suggestion. A list holds each key once. */
export function suggestionKey(suggestion: string): string {
  return suggestion.normalize("NFC").toLowerCase();
}

/** The icons a question can carry on the registration form (`rules.icon`). A fixed list: the form draws a
 * symbol of its own for each name, so a name that is not here has nothing to draw. Add a name at the end,
 * with its symbol in the same change, and in the list of the wiki (Validation Reference). Never rename or remove
 * one: a stored rules object that names an icon this list no longer has cannot be read, and its field would lose
 * every rule in it. At most 20 names. */
export const GUEST_FORM_ICONS = [
  "parking",
  "car",
  "food",
  "accessible",
  "bed",
  "user-plus",
  "users",
  "building",
  "calendar",
  "clock",
  "phone",
  "mail",
  "pin",
  "plane",
  "train",
  "shirt",
] as const;

export type GuestFormIcon = (typeof GUEST_FORM_ICONS)[number];

/** A condition on a question (`rules.show_when`): ask it only when another question of the event, the one
 * whose `source_field` is `field`, has this answer. `value` is `true` when that question is a yes/no field
 * (the answer "true"), and the text of one of its options when it is a select field. */
export type ShowWhen = { field: string; value: true | string };

/** Rules of a field (`EventCustomField.rules`, null = none). Plain switches, numbers and lists, read
 * literally by the code: there is no pattern an organiser types, so a rule can never be a
 * backtracking risk.
 *
 * Format rules: `min_length` and `max_length` count characters of the stored answer (a phone number is
 * stored as an optional + and its digits); `digits_only` allows only 0 to 9; `example` is a hint shown next
 * to the field and never checked against the answer. They apply to `text`, `long_text` and `phone` only (see
 * eventCustomFieldRulesMaxLength).
 *
 * Form rules, for the registration form: `icon` is a symbol drawn with the question, and `show_when` asks the
 * question only under a condition (see isQuestionShown). Both fit every type. `suggestions` are texts the
 * form offers while a guest types; they only suggest, any text is still accepted, and they fit `text` only. */
export type EventCustomFieldRules = {
  min_length?: number;
  max_length?: number;
  digits_only?: boolean;
  example?: string;
  icon?: GuestFormIcon;
  show_when?: ShowWhen;
  suggestions?: string[];
};

/** The longest answer a field of this type can hold, which is also the largest length a rule may
 * name for it, or null when the type takes no format rules (every type except `text`, `long_text` and
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

/** True when the question is asked, given the answers to the others. This is the one place that decides it:
 * the registration form, the staff screens, the import and every check of a required field call it.
 *
 * A question without `rules.show_when` is always asked. One with it is asked only when the answer to the
 * question it names is "true" (for a yes/no field, `value: true`) or is the text `value` (for a select
 * field). No answer at all is not a match. Anything else, a stranger's text included, is not a match either.
 *
 * `answers` holds each answer in the form it is stored in, by `source_field`: "true" or "false" for a yes/no,
 * the option's own text for a select. Only its own properties are read, so a key such as `constructor` is
 * never looked up on the prototype chain. */
export function isQuestionShown(
  field: { rules?: EventCustomFieldRules | null },
  answers: Readonly<Record<string, unknown>>,
): boolean {
  const condition = field.rules?.show_when;
  if (!condition) return true;
  const answer: unknown = Object.getOwnPropertyDescriptor(answers, condition.field)?.value;
  if (condition.value === true) return answer === "true";
  return typeof condition.value === "string" && answer === condition.value;
}
