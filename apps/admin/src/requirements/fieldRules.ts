import {
  CONTACT_PHONE_MIN_DIGITS,
  EVENT_CUSTOM_FIELD_EXAMPLE_MAX,
  EVENT_CUSTOM_FIELD_SUGGESTION_MAX,
  EVENT_CUSTOM_FIELD_SUGGESTIONS_MAX,
  eventCustomFieldRulesMaxLength,
  hasForbiddenSuggestionCharacter,
  suggestionKey,
  type EventCustomFieldRules,
  type GuestFormIcon,
  type ShowWhen,
} from "@admitto/shared";
import { codePointLength } from "../attendees/answerFormat.js";
import type { OptionRow } from "./OptionsEditor.js";

/** The rules of a field as the editor holds them: the text of each box, as typed. The format rules are plain settings (two lengths,
 * digits only, an example), never a pattern, and only text, long text and phone fields take them. The form rules are the icon of
 * the question, the condition that shows it and, for a text field, the suggestions it offers. The server decides what it keeps
 * (`eventCustomFieldRulesSchema` and `eventCustomFieldRulesFitType` in packages/tickets, whose root the admin cannot import, see
 * standards/admin-spa/ui-gotchas.md, and the checks of `@admitto/shared` that it shares with them): the checks here say what is wrong
 * before the editor asks, with the same limits. */
export interface RulesDraft {
  minLength: string;
  maxLength: string;
  digitsOnly: boolean;
  example: string;
  /** The icon the question carries on the registration form; null for none. */
  icon: GuestFormIcon | null;
  /** The condition that shows the question, null for none. The answer is "" while it is not chosen yet (a choice question has to
   * name its option). */
  showWhen: ShowWhen | null;
  /** The suggestions of a text field, a row for each, as typed. */
  suggestions: OptionRow[];
}

export const EMPTY_RULES_DRAFT: RulesDraft = {
  minLength: "",
  maxLength: "",
  digitsOnly: false,
  example: "",
  icon: null,
  showWhen: null,
  suggestions: [],
};

/** The longest answer a field of this type holds, which is also the largest length a rule may name for it; null when the type
 * takes no rules at all. */
export function rulesLengthCap(type: string): number | null {
  return eventCustomFieldRulesMaxLength(type);
}

/** True for a type that takes format rules (lengths, digits only, an example). The icon and the condition fit every type. */
export function typeTakesRules(type: string): boolean {
  return rulesLengthCap(type) !== null;
}

/** True for a type that takes suggestions: a text field only. */
export function typeTakesSuggestions(type: string): boolean {
  return type === "text";
}

export function rulesDraftFromRules(rules: EventCustomFieldRules | null | undefined): RulesDraft {
  return {
    minLength: rules?.min_length === undefined ? "" : String(rules.min_length),
    maxLength: rules?.max_length === undefined ? "" : String(rules.max_length),
    digitsOnly: rules?.digits_only === true,
    example: rules?.example ?? "",
    icon: rules?.icon ?? null,
    showWhen: rules?.show_when ?? null,
    suggestions: (rules?.suggestions ?? []).map((text, index) => ({ key: `suggestion-${index}`, text, originalText: "" })),
  };
}

const WHOLE_NUMBER = /^\d+$/;

/** A length box as a number, or undefined when it is empty or is not a whole number. */
function lengthOf(text: string): number | undefined {
  const trimmed = text.trim();
  return WHOLE_NUMBER.test(trimmed) ? Number(trimmed) : undefined;
}

/** The format rules a draft names, or null for none: a rule that is not set is left out, never sent as 0 or false (a rule that is a
 * key is a rule, so `digits_only: false` would count as one). Only what the checks below accept is worth sending. */
export function formatRulesFromDraft(draft: RulesDraft): EventCustomFieldRules | null {
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

/** The texts of the suggestion rows as they are saved: trimmed, and a row left empty is no suggestion. */
export function suggestionTexts(rows: readonly OptionRow[]): string[] {
  return rows.map((row) => row.text.trim()).filter(Boolean);
}

/** The keys of a rules object that the editor has a control for. Every other key of the stored rules is a rule that a newer server knows. */
const EDITED_RULE_KEYS: ReadonlySet<string> = new Set([
  "min_length",
  "max_length",
  "digits_only",
  "example",
  "icon",
  "show_when",
  "suggestions",
]);

/** The draft as it counts for a type: the format rules only for a type that takes them, and the suggestions for a text field only.
 * What was typed for another type stays in the form (going back to that type gives it back), but is neither saved nor an edit. */
export function draftForType(draft: RulesDraft, type: string): RulesDraft {
  return {
    ...draft,
    ...(typeTakesRules(type) ? {} : { minLength: "", maxLength: "", digitsOnly: false, example: "" }),
    ...(typeTakesSuggestions(type) ? {} : { suggestions: [] }),
  };
}

/** The rules a save leaves on a field of this type: what the form says, and every rule of the stored ones that the editor has no
 * control for (a rule that a newer server knows), which the server would otherwise lose, since a save with rules replaces all the
 * rules of the field. Null for none. */
export function rulesToSave(
  draft: RulesDraft,
  type: string,
  stored: EventCustomFieldRules | null | undefined,
): EventCustomFieldRules | null {
  const counted = draftForType(draft, type);
  const kept = Object.fromEntries(Object.entries(stored ?? {}).filter(([key]) => !EDITED_RULE_KEYS.has(key)));
  const suggestions = suggestionTexts(counted.suggestions);
  const rules: EventCustomFieldRules = {
    ...kept,
    ...formatRulesFromDraft(counted),
    ...(counted.icon ? { icon: counted.icon } : {}),
    // A condition that names no answer yet is not saved: the form says so, and does not let it go.
    ...(counted.showWhen && counted.showWhen.value !== "" ? { show_when: counted.showWhen } : {}),
    ...(suggestions.length > 0 ? { suggestions } : {}),
  };
  return Object.keys(rules).length > 0 ? rules : null;
}

/** True when two sets of rules are the same format rules (none is none, whether it is null or empty). The other rules are not looked at:
 * this is the question of whether answers that are saved are judged differently. */
export function sameRules(a: EventCustomFieldRules | null | undefined, b: EventCustomFieldRules | null | undefined): boolean {
  return (
    a?.min_length === b?.min_length &&
    a?.max_length === b?.max_length &&
    (a?.digits_only ?? false) === (b?.digits_only ?? false) &&
    (a?.example ?? "") === (b?.example ?? "")
  );
}

/** The rules as one string that is the same for the same rules: keys in order, and `digits_only: false` is no rule. */
function canonicalRules(rules: EventCustomFieldRules | null | undefined): string {
  return JSON.stringify(rules ?? {}, (key, value: unknown) => {
    if (key === "digits_only" && value === false) return undefined;
    if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
    const entries = Object.entries(value);
    entries.sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(entries);
  });
}

/** True when two sets of rules are the same rules of every kind. Equal for none, whether it is null or empty. */
export function sameAllRules(a: EventCustomFieldRules | null | undefined, b: EventCustomFieldRules | null | undefined): boolean {
  return canonicalRules(a) === canonicalRules(b);
}

/** What is wrong with the two length boxes, in a sentence, and which of the two it is about; the first thing wrong, in the order
 * a person reads them. */
export interface LengthsProblem {
  message: string;
  min: boolean;
  max: boolean;
}

/** What is wrong with the suggestions, in a sentence, and which rows it is about (their `key`): the first kind of thing wrong. */
export interface SuggestionsProblem {
  message: string;
  keys: ReadonlySet<string>;
}

export interface RulesProblems {
  lengths?: LengthsProblem;
  example?: string;
  suggestions?: SuggestionsProblem;
  /** The condition names a question and not yet the answer that shows this one. */
  showWhen?: string;
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

function countOf(rows: readonly unknown[], one: string, many: string): string {
  return rows.length === 1 ? one : `${rows.length} ${many}`;
}

/** The rows of the same suggestion, by the key two suggestions are compared by, for the first suggestion that is listed twice. */
function firstDuplicate(rows: readonly { key: string; text: string }[]): { key: string; text: string }[] {
  const byKey = new Map<string, { key: string; text: string }[]>();
  for (const row of rows) {
    const same = byKey.get(suggestionKey(row.text)) ?? [];
    same.push(row);
    byKey.set(suggestionKey(row.text), same);
  }
  return [...byKey.values()].find((same) => same.length > 1) ?? [];
}

/** What the server would refuse in the suggestions, in the order a person fixes it: a character a suggestion may not hold, a
 * suggestion that is too long, one that is there twice (whatever its capital letters), more than the list takes. A row left empty is
 * no suggestion. */
function suggestionsProblem(rows: readonly OptionRow[]): SuggestionsProblem | undefined {
  const filled = rows.map((row) => ({ key: row.key, text: row.text.trim() })).filter((row) => row.text !== "");
  const forbidden = filled.filter((row) => hasForbiddenSuggestionCharacter(row.text));
  if (forbidden.length > 0) {
    return {
      message: `${countOf(forbidden, "A suggestion has", "suggestions have")} an invisible or control character. Use plain text on one line.`,
      keys: new Set(forbidden.map((row) => row.key)),
    };
  }
  const tooLong = filled.filter((row) => codePointLength(row.text) > EVENT_CUSTOM_FIELD_SUGGESTION_MAX);
  if (tooLong.length > 0) {
    return {
      message: `${countOf(tooLong, "A suggestion is", "suggestions are")} longer than ${EVENT_CUSTOM_FIELD_SUGGESTION_MAX} characters.`,
      keys: new Set(tooLong.map((row) => row.key)),
    };
  }
  const twice = firstDuplicate(filled);
  if (twice.length > 0) {
    return {
      message: `“${twice[0]!.text}” is there more than once. Capital letters do not make a suggestion different.`,
      keys: new Set(twice.map((row) => row.key)),
    };
  }
  if (filled.length > EVENT_CUSTOM_FIELD_SUGGESTIONS_MAX) {
    return { message: `Use at most ${EVENT_CUSTOM_FIELD_SUGGESTIONS_MAX} suggestions.`, keys: new Set() };
  }
  return undefined;
}

/** What the server would refuse in these rules for a field of this type. The format rules and the suggestions are judged for a type that
 * takes them only (the others are not sent). */
export function rulesProblems(type: string, draft: RulesDraft): RulesProblems {
  const cap = rulesLengthCap(type);
  return {
    ...(cap === null ? {} : { lengths: lengthsProblem(type, draft, cap), example: exampleProblem(draft.example) }),
    ...(typeTakesSuggestions(type) ? { suggestions: suggestionsProblem(draft.suggestions) } : {}),
    ...(draft.showWhen?.value === "" ? { showWhen: "Choose the answer that shows this question." } : {}),
  };
}

export function hasRulesProblem(problems: RulesProblems): boolean {
  return (
    problems.lengths !== undefined ||
    problems.example !== undefined ||
    problems.suggestions !== undefined ||
    problems.showWhen !== undefined
  );
}
