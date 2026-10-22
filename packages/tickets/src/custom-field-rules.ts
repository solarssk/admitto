import { z } from "zod";
import {
  CONTACT_PHONE_MIN_DIGITS,
  EVENT_CUSTOM_FIELD_EXAMPLE_MAX,
  EVENT_CUSTOM_FIELD_LONG_TEXT_MAX,
  EVENT_CUSTOM_FIELD_SUGGESTION_MAX,
  EVENT_CUSTOM_FIELD_SUGGESTIONS_MAX,
  GUEST_FORM_ICONS,
  eventCustomFieldRulesMaxLength,
  type EventCustomFieldRules,
} from "@admitto/shared";
import { codePointLength } from "./custom-field-formats.js";

/** What a rule's example may not hold: a control character (a line break among them), a format
 * character (zero-width, bidi marks) or a lone surrogate. The example is shown next to the field,
 * so it stays one plain line. */
const FORBIDDEN_IN_EXAMPLE = /[\p{Cc}\p{Cf}\p{Cs}]/u;

/** What a suggestion may not hold. A suggestion is offered to the guest and, when picked, sent back as the answer,
 * so it is held to the rule that answers are held to (normalizeRegistrantText in registrant-input.ts): no control
 * character, no format character (zero-width and bidi marks, the soft hyphen, the byte order mark), no lone
 * surrogate, nothing Unicode marks default-ignorable (variation selectors among them), no line or paragraph
 * separator and no noncharacter. A test keeps the two in step. */
const FORBIDDEN_IN_SUGGESTION = /[\p{Cc}\p{Cf}\p{Cs}\p{Default_Ignorable_Code_Point}\u2028\u2029\uFFFE\uFFFF]/u;

/** The longest `field` and `value` of a condition: the longest `source_field` and the longest select option. */
const SHOW_WHEN_NAME_MAX = 60;
const SOURCE_FIELD_SLUG = /^[a-z0-9_]+$/;

/** `rules.show_when`: the key of the question it depends on and the answer that shows the field, `true` for a
 * yes/no question or the text of an option of a select question. Whether such a question exists in the event, and
 * has that option, is judged where the whole event is known (findShowWhenProblem). */
const showWhenSchema = z
  .object({
    field: z.string().min(1).max(SHOW_WHEN_NAME_MAX).regex(SOURCE_FIELD_SLUG),
    value: z.union([z.literal(true), z.string().trim().min(1).max(SHOW_WHEN_NAME_MAX)]),
  })
  .strict();

/** One suggestion: 1 to 100 characters (code points), trimmed, one plain line. */
const suggestionSchema = z
  .string()
  .trim()
  .min(1)
  // A code point takes at most two UTF-16 units, so a longer string is over the limit without counting.
  .max(EVENT_CUSTOM_FIELD_SUGGESTION_MAX * 2)
  .refine((value) => codePointLength(value) <= EVENT_CUSTOM_FIELD_SUGGESTION_MAX, { message: "suggestion is too long" })
  .refine((value) => !FORBIDDEN_IN_SUGGESTION.test(value), { message: "invalid suggestion" });

/** The key two suggestions are compared by: the same letters in another case, or written as a base letter and a
 * combining mark instead of one character, are the same suggestion. */
function suggestionKey(suggestion: string): string {
  return suggestion.normalize("NFC").toLowerCase();
}

/** The shape of `EventCustomField.rules`, as the admin API takes it. Strict: a key that is not a
 * rule is refused, so a typo is never stored as a rule that does nothing. A later rule is one more
 * key here, with no migration. The rules are plain switches, numbers and lists that the code reads
 * literally: an organiser never types a pattern. Which field types take which rule, and how long a
 * length may be for each, is eventCustomFieldRulesFitType. */
export const eventCustomFieldRulesSchema = z
  .object({
    min_length: z.number().int().min(1).max(EVENT_CUSTOM_FIELD_LONG_TEXT_MAX).optional(),
    max_length: z.number().int().min(1).max(EVENT_CUSTOM_FIELD_LONG_TEXT_MAX).optional(),
    digits_only: z.boolean().optional(),
    example: z
      .string()
      .trim()
      .min(1)
      // A code point takes at most two UTF-16 units, so a longer string is over the limit without counting.
      .max(EVENT_CUSTOM_FIELD_EXAMPLE_MAX * 2)
      .refine((value) => codePointLength(value) <= EVENT_CUSTOM_FIELD_EXAMPLE_MAX, { message: "example is too long" })
      .refine((value) => !FORBIDDEN_IN_EXAMPLE.test(value), { message: "invalid example" })
      .optional(),
    icon: z.enum(GUEST_FORM_ICONS).optional(),
    show_when: showWhenSchema.optional(),
    suggestions: z
      .array(suggestionSchema)
      .min(1)
      .max(EVENT_CUSTOM_FIELD_SUGGESTIONS_MAX)
      .refine((list) => new Set(list.map((suggestion) => suggestionKey(suggestion))).size === list.length, { message: "duplicate suggestion" })
      .optional(),
  })
  .strict()
  .refine((rules) => rules.min_length === undefined || rules.max_length === undefined || rules.min_length <= rules.max_length, {
    message: "min_length is above max_length",
  });

/** True when `rules` names no rule at all: stored as no rules (NULL), the same as a field without. */
export function hasNoRules(rules: EventCustomFieldRules | null | undefined): boolean {
  return !rules || Object.keys(rules).length === 0;
}

/** True when some phone number can meet the length rules. A phone number is stored as an optional + and
 * 3 to 15 digits, so it has 3 to 16 characters (`cap`), and `digits_only` refuses the +, which leaves 3 to 15.
 * Rules no number can meet would refuse every answer to a field, and every save while it is required. */
function somePhoneMeetsLengthRules(rules: EventCustomFieldRules, cap: number): boolean {
  const longest = rules.digits_only ? cap - 1 : cap;
  const shortest = Math.max(rules.min_length ?? 1, CONTACT_PHONE_MIN_DIGITS);
  return shortest <= Math.min(rules.max_length ?? longest, longest);
}

/** True when the rule is one of the four that shape an answer: a length, `digits_only` or `example`. */
function hasFormatRules(rules: EventCustomFieldRules): boolean {
  return (
    rules.min_length !== undefined ||
    rules.max_length !== undefined ||
    rules.digits_only !== undefined ||
    rules.example !== undefined
  );
}

/** True when `rules` can be kept on a field of this type. `icon` and `show_when` fit every type. `suggestions`
 * fit `text` only. The format rules need a type that takes them (`text`, `long_text` and `phone`; every other
 * type gets none), no length longer than the type can hold, and, for a phone field, rules that leave some
 * number that meets them. */
export function eventCustomFieldRulesFitType(type: string, rules: EventCustomFieldRules | null | undefined): boolean {
  if (!rules || hasNoRules(rules)) return true;
  if (rules.suggestions !== undefined && type !== "text") return false;
  if (!hasFormatRules(rules)) return true;
  const cap = eventCustomFieldRulesMaxLength(type);
  if (cap === null) return false;
  const withinCap = [rules.min_length, rules.max_length].every((length) => length === undefined || length <= cap);
  return withinCap && (type !== "phone" || somePhoneMeetsLengthRules(rules, cap));
}

/** The rules stored on a field row, or undefined when it has none. A stored value that is not a
 * valid rules object (written by hand, or by code that knows a rule this one does not) is read as
 * no rules: a format hint that cannot be read must not stop guests or staff from saving. For a
 * question with a condition that means it is asked always, and answered as any other. */
export function readStoredFieldRules(stored: unknown): EventCustomFieldRules | undefined {
  const parsed = eventCustomFieldRulesSchema.safeParse(stored);
  return parsed.success && !hasNoRules(parsed.data) ? parsed.data : undefined;
}

const ASCII_DIGITS_ONLY = /^\d+$/;

/** True when `value`, as it would be stored, breaks one of the rules. `digits_only` allows 0 to 9
 * and nothing else; the lengths are in code points. */
export function breaksFieldRules(value: string, rules: EventCustomFieldRules | undefined): boolean {
  if (!rules) return false;
  if (rules.digits_only && !ASCII_DIGITS_ONLY.test(value)) return true;
  const length = codePointLength(value);
  if (rules.min_length !== undefined && length < rules.min_length) return true;
  return rules.max_length !== undefined && length > rules.max_length;
}
