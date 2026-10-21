import { z } from "zod";
import {
  EVENT_CUSTOM_FIELD_EXAMPLE_MAX,
  EVENT_CUSTOM_FIELD_LONG_TEXT_MAX,
  eventCustomFieldRulesMaxLength,
  type EventCustomFieldRules,
} from "@admitto/shared";
import { codePointLength } from "./custom-field-formats.js";

/** What a rule's example may not hold: a control character (a line break among them), a format
 * character (zero-width, bidi marks) or a lone surrogate. The example is shown next to the field,
 * so it stays one plain line. */
const FORBIDDEN_IN_EXAMPLE = /[\p{Cc}\p{Cf}\p{Cs}]/u;

/** The shape of `EventCustomField.rules`, as the admin API takes it. Strict: a key that is not a
 * rule is refused, so a typo is never stored as a rule that does nothing. A later rule is one more
 * key here, with no migration. The rules are plain switches and numbers that the code reads
 * literally: an organiser never types a pattern. Which field types take rules, and how long a
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
      .max(EVENT_CUSTOM_FIELD_EXAMPLE_MAX)
      .refine((value) => !FORBIDDEN_IN_EXAMPLE.test(value), { message: "invalid example" })
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

/** True when `rules` can be kept on a field of this type: a type that takes no rules (every type
 * but `text`, `long_text` and `phone`) gets none, and no length is longer than the type can hold. */
export function eventCustomFieldRulesFitType(type: string, rules: EventCustomFieldRules | null | undefined): boolean {
  if (!rules || hasNoRules(rules)) return true;
  const cap = eventCustomFieldRulesMaxLength(type);
  if (cap === null) return false;
  return [rules.min_length, rules.max_length].every((length) => length === undefined || length <= cap);
}

/** The rules stored on a field row, or undefined when it has none. A stored value that is not a
 * valid rules object (written by hand, or by code that knows a rule this one does not) is read as
 * no rules: a format hint that cannot be read must not stop guests or staff from saving. */
export function readStoredFieldRules(stored: unknown): EventCustomFieldRules | undefined {
  const parsed = eventCustomFieldRulesSchema.safeParse(stored);
  return parsed.success && !hasNoRules(parsed.data) ? parsed.data : undefined;
}

const ASCII_DIGITS_ONLY = /^[0-9]+$/;

/** True when `value`, as it would be stored, breaks one of the rules. `digits_only` allows 0 to 9
 * and nothing else; the lengths are in code points. */
export function breaksFieldRules(value: string, rules: EventCustomFieldRules | undefined): boolean {
  if (!rules) return false;
  if (rules.digits_only && !ASCII_DIGITS_ONLY.test(value)) return true;
  const length = codePointLength(value);
  if (rules.min_length !== undefined && length < rules.min_length) return true;
  return rules.max_length !== undefined && length > rules.max_length;
}
