import {
  CONTACT_PHONE_MIN_DIGITS,
  EVENT_CUSTOM_FIELD_EXAMPLE_MAX,
  eventCustomFieldRulesMaxLength,
  type EventCustomFieldRules,
} from "@admitto/shared";
import { codePointLength } from "../attendees/answerFormat.js";

/** The format rules of a field as the editor holds them: the text of each box, as typed. The rules are plain settings (two lengths,
 * digits only, an example), never a pattern, and only text, long text and phone fields take them. The server decides what it
 * keeps (`eventCustomFieldRulesSchema` and `eventCustomFieldRulesFitType` in packages/tickets, whose root the admin cannot
 * import, see standards/admin-spa/ui-gotchas.md): the checks here say what is wrong before the editor asks, with the same limits. */
export interface RulesDraft {
  minLength: string;
  maxLength: string;
  digitsOnly: boolean;
  example: string;
}

export const EMPTY_RULES_DRAFT: RulesDraft = { minLength: "", maxLength: "", digitsOnly: false, example: "" };

/** The longest answer a field of this type holds, which is also the largest length a rule may name for it; null when the type
 * takes no rules at all. */
export function rulesLengthCap(type: string): number | null {
  return eventCustomFieldRulesMaxLength(type);
}

export function typeTakesRules(type: string): boolean {
  return rulesLengthCap(type) !== null;
}

export function rulesDraftFromRules(rules: EventCustomFieldRules | null | undefined): RulesDraft {
  return {
    minLength: rules?.min_length === undefined ? "" : String(rules.min_length),
    maxLength: rules?.max_length === undefined ? "" : String(rules.max_length),
    digitsOnly: rules?.digits_only === true,
    example: rules?.example ?? "",
  };
}

const WHOLE_NUMBER = /^\d+$/;

/** A length box as a number, or undefined when it is empty or is not a whole number. */
function lengthOf(text: string): number | undefined {
  const trimmed = text.trim();
  return WHOLE_NUMBER.test(trimmed) ? Number(trimmed) : undefined;
}

/** The rules a draft names, or null for none: a rule that is not set is left out, never sent as 0 or false (a rule that is a
 * key is a rule, so `digits_only: false` would count as one). Only what the checks below accept is worth sending. */
export function rulesFromDraft(draft: RulesDraft): EventCustomFieldRules | null {
  const rules: EventCustomFieldRules = {};
  const min = lengthOf(draft.minLength);
  const max = lengthOf(draft.maxLength);
  const example = draft.example.trim();
  if (min !== undefined) rules.min_length = min;
  if (max !== undefined) rules.max_length = max;
  if (draft.digitsOnly) rules.digits_only = true;
  if (example) rules.example = example;
  return Object.keys(rules).length > 0 ? rules : null;
}

/** True when two sets of rules are the same rules (none is none, whether it is null or empty). */
export function sameRules(a: EventCustomFieldRules | null | undefined, b: EventCustomFieldRules | null | undefined): boolean {
  return (
    a?.min_length === b?.min_length &&
    a?.max_length === b?.max_length &&
    (a?.digits_only ?? false) === (b?.digits_only ?? false) &&
    (a?.example ?? "") === (b?.example ?? "")
  );
}

/** The rules of a question on the registration form that the editor has no boxes for yet: its icon, its condition and its suggestions. */
function otherRulesOf(rules: EventCustomFieldRules | null | undefined): EventCustomFieldRules {
  const other: EventCustomFieldRules = {};
  if (rules?.icon !== undefined) other.icon = rules.icon;
  if (rules?.show_when !== undefined) other.show_when = rules.show_when;
  if (rules?.suggestions !== undefined) other.suggestions = rules.suggestions;
  return other;
}

/** The rules a save leaves on a field: the ones of the form, and the ones the editor has no boxes for. It does not change those, but a
 * save with rules replaces all the rules of the field on the server, so it sends the stored ones again. Suggestions fit a text field
 * only, so they are left out when the field becomes another type. Null for none. */
export function rulesAfterSave(
  formRules: EventCustomFieldRules | null,
  stored: EventCustomFieldRules | null | undefined,
  type: string,
): EventCustomFieldRules | null {
  const { suggestions, ...kept } = otherRulesOf(stored);
  const rules: EventCustomFieldRules = { ...kept, ...(type === "text" && suggestions ? { suggestions } : {}), ...formRules };
  return Object.keys(rules).length > 0 ? rules : null;
}

/** True when two sets of rules are the same, the ones the editor has no boxes for included. */
export function sameAllRules(a: EventCustomFieldRules | null | undefined, b: EventCustomFieldRules | null | undefined): boolean {
  return sameRules(a, b) && JSON.stringify(otherRulesOf(a)) === JSON.stringify(otherRulesOf(b));
}

/** What is wrong with the two length boxes, in a sentence, and which of the two it is about; the first thing wrong, in the order
 * a person reads them. */
export interface LengthsProblem {
  message: string;
  min: boolean;
  max: boolean;
}

export interface RulesProblems {
  lengths?: LengthsProblem;
  example?: string;
}

/** What a length box takes: a whole number from 1 to what the type holds, or nothing. */
function lengthBoxProblem(text: string, cap: number): string | undefined {
  if (text.trim() === "") return undefined;
  const length = lengthOf(text);
  return length !== undefined && length >= 1 && length <= cap ? undefined : `Enter a whole number from 1 to ${cap}.`;
}

/** True when some phone number can meet the lengths. A number is saved as an optional + and 3 to 15 digits, so it has 3 to 16
 * characters (`cap`), and digits only refuses the +, which leaves 3 to 15. Lengths no number can meet would refuse every answer. */
function somePhoneMeetsLengths(min: number | undefined, max: number | undefined, digitsOnly: boolean, cap: number): boolean {
  const longest = digitsOnly ? cap - 1 : cap;
  const shortest = Math.max(min ?? 1, CONTACT_PHONE_MIN_DIGITS);
  return shortest <= Math.min(max ?? longest, longest);
}

function lengthsProblem(type: string, draft: RulesDraft, cap: number): LengthsProblem | undefined {
  const minMessage = lengthBoxProblem(draft.minLength, cap);
  if (minMessage) return { message: minMessage, min: true, max: false };
  const maxMessage = lengthBoxProblem(draft.maxLength, cap);
  if (maxMessage) return { message: maxMessage, min: false, max: true };
  const min = lengthOf(draft.minLength);
  const max = lengthOf(draft.maxLength);
  if (min !== undefined && max !== undefined && min > max) {
    return { message: "The longest answer can't be shorter than the shortest.", min: true, max: true };
  }
  if (type === "phone" && !somePhoneMeetsLengths(min, max, draft.digitsOnly, cap)) {
    const longest = draft.digitsOnly ? cap - 1 : cap;
    return {
      message: `No phone number fits these rules: a saved number has ${CONTACT_PHONE_MIN_DIGITS} to ${longest} characters.`,
      min: true,
      max: true,
    };
  }
  return undefined;
}

/** A control character (a line break among them), a format character (zero-width, direction marks) or a lone surrogate. The example
 * is shown next to the field, so it stays one plain line. */
const FORBIDDEN_IN_EXAMPLE = /[\p{Cc}\p{Cf}\p{Cs}]/u;

function exampleProblem(example: string): string | undefined {
  const trimmed = example.trim();
  if (trimmed === "") return undefined;
  if (codePointLength(trimmed) > EVENT_CUSTOM_FIELD_EXAMPLE_MAX) {
    return `Use at most ${EVENT_CUSTOM_FIELD_EXAMPLE_MAX} characters.`;
  }
  return FORBIDDEN_IN_EXAMPLE.test(trimmed) ? "Use plain text on one line, with no invisible characters." : undefined;
}

/** What the server would refuse in these rules for a field of this type. None for a type that takes no rules (they are not sent). */
export function rulesProblems(type: string, draft: RulesDraft): RulesProblems {
  const cap = rulesLengthCap(type);
  if (cap === null) return {};
  return { lengths: lengthsProblem(type, draft, cap), example: exampleProblem(draft.example) };
}

export function hasRulesProblem(problems: RulesProblems): boolean {
  return problems.lengths !== undefined || problems.example !== undefined;
}
