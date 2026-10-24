import { EVENT_CUSTOM_FIELD_TEXT_MAX, eventCustomFieldRulesMaxLength, isQuestionShown } from "@admitto/shared";
import { customDataValue } from "./custom-data.js";
import {
  codePointLength,
  normalizeDateAnswer,
  normalizeDateTimeAnswer,
  normalizeLongTextAnswer,
  normalizePhoneAnswer,
  truncateToCodePoints,
} from "./custom-field-formats.js";
import { breaksFieldRules } from "./custom-field-rules.js";
import type { EventItemContent } from "./types.js";

const BOOLEAN_TRUE = new Set(["true", "yes", "1"]);
const BOOLEAN_FALSE = new Set(["false", "no", "0"]);

function ownCustomDataValue<T>(values: Record<string, T>, key: string): T | undefined {
  return Object.getOwnPropertyDescriptor(values, key)?.value as T | undefined;
}

function setOwnCustomDataValue<T>(values: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(values, key, { value, enumerable: true, configurable: true, writable: true });
}

function normalizeBooleanAnswer(trimmed: string): string | null {
  const lower = trimmed.toLowerCase();
  if (BOOLEAN_TRUE.has(lower)) return "true";
  return BOOLEAN_FALSE.has(lower) ? "false" : null;
}

/** `trimmed` as a field of this type stores it, or null when it is not an answer to such a field.
 * A `text` answer, and one to a type this version does not know, is cut to the short text limit:
 * the staff and import paths have always done that (the guest path refuses the same text, see
 * buildRegistrantCustomData). Every other type refuses what does not fit. */
function normalizeByType(field: EventItemContent, type: string, trimmed: string): string | null {
  switch (type) {
    case "boolean":
      return normalizeBooleanAnswer(trimmed);
    case "select":
      return (field.options ?? []).find((option) => option === trimmed) ?? null;
    case "date":
      return normalizeDateAnswer(trimmed);
    case "datetime":
      return normalizeDateTimeAnswer(trimmed);
    case "phone":
      return normalizePhoneAnswer(trimmed);
    case "long_text":
      return normalizeLongTextAnswer(trimmed);
    default:
      return truncateToCodePoints(trimmed, EVENT_CUSTOM_FIELD_TEXT_MAX);
  }
}

/** Normalize and validate one custom_data value for a configured field: the value as its type
 * stores it, then the field's format rules (`rules`, for `text`, `long_text` and `phone`). Throws
 * `invalid_custom_data_value:<source_field>` for a value that does not fit, with no value in the
 * message. */
export function normalizeCustomDataFieldValue(
  field: EventItemContent,
  raw: string | null | undefined,
): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const type = field.type ?? "text";
  const normalized = normalizeByType(field, type, trimmed);
  const takesRules = eventCustomFieldRulesMaxLength(type) !== null;
  if (normalized === null || (takesRules && breaksFieldRules(normalized, field.rules))) {
    throw new Error(`invalid_custom_data_value:${field.source_field}`);
  }
  return normalized;
}

/** A required field must have an answer, unless it is a question with a condition that the other answers do not
 * meet: `required` then means "required when asked" (isQuestionShown). */
function assertRequiredFieldsPresent(
  fields: EventItemContent[],
  values: Record<string, string | null | undefined>,
): void {
  for (const field of fields) {
    if (!field.required || !isQuestionShown(field, values)) continue;
    const value = ownCustomDataValue(values, field.source_field);
    if (!value) {
      throw new Error(`required_custom_data_field_missing:${field.source_field}`);
    }
  }
}

function assertStoredCustomDataValid(
  fields: EventItemContent[],
  values: Record<string, string | null | undefined>,
): void {
  for (const field of fields) {
    const raw = ownCustomDataValue(values, field.source_field);
    if (raw) {
      const canonical = normalizeCustomDataFieldValue(field, raw);
      // A field retyped to `phone` can still hold "+48 600-100-200". That is a number, but not in the form a phone
      // number is stored in: an edit would keep it as typed, and the list filter, which looks for digits and a +,
      // would not find it. Like an answer that no longer fits the type, it is refused until it is entered again.
      if (field.type === "phone" && canonical !== null && canonical !== raw) {
        throw new Error(`invalid_custom_data_value:${field.source_field}`);
      }
    }
  }
  assertRequiredFieldsPresent(fields, values);
}

/** An answer given through the admin API or the Add attendee form to a field that is not a long text
 * holds at most the short text limit: it is refused, never cut. (The import reads whole files, so it
 * cuts a text answer in normalizeCustomDataFieldValue instead.) */
function assertWithinAnswerLimit(field: EventItemContent, key: string, value: string): void {
  if (field.type !== "long_text" && codePointLength(value.trim()) > EVENT_CUSTOM_FIELD_TEXT_MAX) {
    throw new Error(`validation_failed:${key}`);
  }
}

/** Turns the raw answer to one field into what is then validated, or `undefined` for no answer. Used by the guest
 * form, whose answers are cleaned of hostile text first (see registrant-input.ts). */
export type AnswerReader = (field: EventItemContent, raw: unknown) => unknown;

/** Normalize one raw input entry and assign it into `out`, or throw for invalid input. */
function assignCustomDataEntry(
  field: EventItemContent,
  out: Record<string, string>,
  raw: unknown,
  readAnswer?: AnswerReader,
): void {
  const value = readAnswer ? readAnswer(field, raw) : raw;
  if (value === null || value === undefined || value === "") return;
  if (typeof value !== "string") throw new Error(`validation_failed:${field.source_field}`);
  assertWithinAnswerLimit(field, field.source_field, value);
  const normalized = normalizeCustomDataFieldValue(field, value);
  if (normalized) setOwnCustomDataValue(out, field.source_field, normalized);
}

/** Reads the answers of `input` into `out`: first those to questions without a condition, then those to questions
 * with one that the answers already in `out` meet. An answer to a question whose condition is not met is not read. */
function assignAnswers(
  fieldByKey: Map<string, EventItemContent>,
  out: Record<string, string>,
  input: Record<string, unknown>,
  readAnswer?: AnswerReader,
): void {
  const withCondition: [EventItemContent, unknown][] = [];
  for (const [key, value] of Object.entries(input)) {
    const field = fieldByKey.get(key);
    if (!field) throw new Error(`unknown_custom_data_field:${key}`);
    if (field.rules?.show_when) withCondition.push([field, value]);
    else assignCustomDataEntry(field, out, value, readAnswer);
  }
  for (const [field, value] of withCondition) {
    if (isQuestionShown(field, out)) assignCustomDataEntry(field, out, value, readAnswer);
  }
}

/** Build validated custom_data for attendee create.
 *
 * The answer to a question with a condition (`rules.show_when`) is read after the answers to the others, and
 * only when they meet the condition: for a question that is not asked it is not read, not checked and not stored,
 * so a client that sends one gets no error and no value (see isQuestionShown). `readAnswer` cleans each answer
 * before it is checked, and is not called for such an answer either. */
export function buildCustomDataFromInput(
  fields: EventItemContent[],
  input?: Record<string, unknown>,
  readAnswer?: AnswerReader,
): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  if (input) assignAnswers(new Map(fields.map((field) => [field.source_field, field])), out, input, readAnswer);
  assertRequiredFieldsPresent(fields, out);
  return Object.keys(out).length > 0 ? out : undefined;
}

/** True for a patch entry that sets an answer, false for one that clears it (null or an empty text). */
function isAnswer(value: string | null): value is string {
  return value !== null && value !== "";
}

/** Applies one patch entry to the merged answers and to the patch that is persisted. */
function applyPatchEntry(
  field: EventItemContent,
  value: string | null,
  merged: Record<string, string | null>,
  normalizedPatch: Record<string, string | null>,
): void {
  let normalized: string | null = null;
  if (isAnswer(value)) {
    assertWithinAnswerLimit(field, field.source_field, value);
    normalized = normalizeCustomDataFieldValue(field, value);
  }
  setOwnCustomDataValue(merged, field.source_field, normalized);
  setOwnCustomDataValue(normalizedPatch, field.source_field, normalized);
}

/** Validate merged custom_data after a PATCH to custom_data_fields. Returns normalized patch values for persistence.
 *
 * An answer set for a question with a condition (`rules.show_when`) is applied after the others, and only when the
 * merged answers (the attendee's and the patch's) meet the condition: for a question that is not asked it is not
 * checked and not persisted, with no error (see isQuestionShown). Clearing an answer is always applied, and an
 * answer already stored stays when its question stops being asked: nothing is deleted behind anyone's back. */
export function validateCustomDataPatch(
  fields: EventItemContent[],
  existing: unknown,
  patch: Record<string, string | null>,
): Record<string, string | null> {
  const merged: Record<string, string | null> = {};
  const normalizedPatch: Record<string, string | null> = {};
  const withCondition: [EventItemContent, string][] = [];

  for (const field of fields) {
    setOwnCustomDataValue(merged, field.source_field, customDataValue(existing, field.source_field));
  }

  for (const [key, value] of Object.entries(patch)) {
    const field = fields.find((row) => row.source_field === key);
    if (!field) throw new Error(`unknown_custom_data_field:${key}`);
    if (field.rules?.show_when && isAnswer(value)) withCondition.push([field, value]);
    else applyPatchEntry(field, value, merged, normalizedPatch);
  }
  for (const [field, value] of withCondition) {
    if (isQuestionShown(field, merged)) applyPatchEntry(field, value, merged, normalizedPatch);
  }

  assertStoredCustomDataValid(fields, merged);
  return normalizedPatch;
}

/** Ensure stored custom_data satisfies configured field rules (any PATCH path). */
export function assertCustomDataMeetsRequirements(
  fields: EventItemContent[],
  customData: unknown,
): void {
  const values: Record<string, string | null | undefined> = {};
  for (const field of fields) {
    setOwnCustomDataValue(values, field.source_field, customDataValue(customData, field.source_field));
  }
  assertStoredCustomDataValid(fields, values);
}

/** The answers of `incoming` that an attendee holding `existing` keeps once they are applied: those to questions
 * that are asked and those to keys that are no field of `fields`. An answer to a question with a condition that the
 * answers do not meet is left out, so it is never stored (see isQuestionShown). The condition is judged on `incoming`
 * laid over `existing`, the answers the attendee will have. The import uses it for a new row (`existing` is
 * empty) and for an overwrite. */
export function keepShownAnswers(
  fields: readonly EventItemContent[],
  existing: unknown,
  incoming: Record<string, string>,
): Record<string, string> {
  const state: Record<string, string | null> = {};
  for (const field of fields) {
    const answer = ownCustomDataValue(incoming, field.source_field) ?? customDataValue(existing, field.source_field);
    setOwnCustomDataValue(state, field.source_field, answer);
  }
  const fieldByKey = new Map(fields.map((field) => [field.source_field, field]));
  const kept: Record<string, string> = {};
  for (const [key, value] of Object.entries(incoming)) {
    const field = fieldByKey.get(key);
    if (!field || isQuestionShown(field, state)) setOwnCustomDataValue(kept, key, value);
  }
  return kept;
}
