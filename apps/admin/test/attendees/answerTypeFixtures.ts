import type { EventCustomFieldDto } from "../../src/api/types.js";

/** A custom field of the given type, as the API lists it: plain, with the differences of the test in `extra`. */
export function answerField(
  source_field: string,
  label: string,
  type: EventCustomFieldDto["type"],
  extra: Partial<EventCustomFieldDto> = {},
): EventCustomFieldDto {
  return {
    id: `fld-${source_field}`,
    source_field,
    label,
    description: null,
    type,
    required: false,
    show_on_form: false,
    display_order: null,
    options: null,
    rules: null,
    created_at: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

/** One field of each answer type that takes a free answer: a long text, a date, a date and time, a phone number, and a text with
 * the rules of a postcode. The forms of an attendee are tried against these. */
export const ANSWER_TYPE_FIELDS: EventCustomFieldDto[] = [
  answerField("abstract", "Abstract", "long_text"),
  answerField("arrival_day", "Arrival day", "date"),
  answerField("arrival", "Arrival", "datetime"),
  answerField("mobile", "Mobile", "phone"),
  answerField("postcode", "Postcode", "text", { rules: { digits_only: true, min_length: 5, max_length: 5, example: "01234" } }),
];
