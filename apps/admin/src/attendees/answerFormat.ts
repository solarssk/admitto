/*
 * The answer formats of the custom field types that take a free answer (text, long text, date, date and time, phone): what the Add
 * attendee form and the attendee page ask for, check before they send, and say in words. The server decides
 * (`normalizeCustomDataFieldValue` in packages/tickets); this mirrors it, so that a form says what is wrong before it asks, in the
 * words of the field. It cannot import that package: its root pulls Prisma into the browser (standards/admin-spa/ui-gotchas.md).
 */
import {
  CONTACT_PHONE_MAX_DIGITS,
  CONTACT_PHONE_MIN_DIGITS,
  EVENT_CUSTOM_FIELD_LONG_TEXT_MAX,
  EVENT_CUSTOM_FIELD_TEXT_MAX,
  isValidContactPhone,
  type EventCustomFieldRules,
} from "@admitto/shared";
import type { EventCustomFieldDto } from "../api/types.js";

/** What this file reads of a field: its name, its type and its format rules. */
export type AnswerField = Pick<EventCustomFieldDto, "label" | "type" | "rules">;

/** The length of `value` in characters as a person counts them: an emoji is one. The server counts the same way, so a counter
 * built on this one agrees with the limit it enforces (`.length` counts an emoji as two). */
export function codePointLength(value: string): number {
  return [...value].length;
}

const PHONE_WORDS = `a phone number with ${CONTACT_PHONE_MIN_DIGITS} to ${CONTACT_PHONE_MAX_DIGITS} digits`;

function characters(count: number): string {
  return `${count} ${count === 1 ? "character" : "characters"}`;
}

/** The length a field asks for, in words, or null when it asks for none. */
function lengthText(min: number | undefined, max: number | undefined): string | null {
  if (min !== undefined && min === max) return `exactly ${characters(min)}`;
  if (min !== undefined && max !== undefined) return `${min} to ${characters(max)}`;
  if (min !== undefined) return `at least ${characters(min)}`;
  return max === undefined ? null : `at most ${characters(max)}`;
}

/** The longest answer a long text field takes: its own rule, or the 1000 characters the type holds. */
export function longTextLimit(field: AnswerField): number {
  return Math.min(field.rules?.max_length ?? EVENT_CUSTOM_FIELD_LONG_TEXT_MAX, EVENT_CUSTOM_FIELD_LONG_TEXT_MAX);
}

/** What the rules of a field ask for, in words ("digits only", "exactly 5 characters"). A long text field always has a longest
 * answer (its own rule, or the type's); `withMax` false leaves it out, for a place that shows it as a counter. */
function ruleParts(field: AnswerField, withMax = true): string[] {
  const rules: EventCustomFieldRules = field.rules ?? {};
  const parts: string[] = [];
  if (rules.digits_only) parts.push("digits only");
  const max = field.type === "long_text" ? longTextLimit(field) : rules.max_length;
  const length = lengthText(rules.min_length, withMax ? max : undefined);
  if (length) parts.push(length);
  return parts;
}

/** What a free answer must be, in words, or null when the field asks for nothing beyond its own limit. Choices (a single choice,
 * yes or no) are described by their own options. */
export function answerExpectation(field: AnswerField): string | null {
  switch (field.type ?? "text") {
    case "date":
      return "a valid date";
    case "datetime":
      return "a valid date and time";
    case "phone":
      return [PHONE_WORDS, ...ruleParts(field)].join(", ");
    case "text":
    case "long_text":
      return ruleParts(field).join(", ") || null;
    default:
      return null;
  }
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The line under an input that says what to type, or undefined when the field asks for nothing special. The example is the
 * organiser's own text; it is shown, never checked. `eventTimeZone` names the zone of a date and time answer. */
export function answerHint(field: AnswerField, eventTimeZone?: string): string | undefined {
  const type = field.type ?? "text";
  if (type === "datetime") return eventTimeZone ? `Time at the event (${eventTimeZone}).` : "Time at the event.";
  if (type === "date" || type === "select" || type === "boolean") return undefined;
  const parts = type === "phone" ? [PHONE_WORDS] : [];
  // The longest answer of a long text field is the counter under its box.
  parts.push(...ruleParts(field, type !== "long_text"));
  if (field.rules?.example) parts.push(`for example ${field.rules.example}`);
  return parts.length > 0 ? `${capitalized(parts.join(", "))}.` : undefined;
}

/** The note after a field's description in the import's "Required CSV columns" table, or null when there is none. A date is
 * written the way the import reads it, whatever the form shows. */
export function answerImportNote(field: AnswerField): string | null {
  const type = field.type ?? "text";
  if (type === "date") return "date as YYYY-MM-DD";
  if (type === "datetime") return "date and time as YYYY-MM-DDTHH:mm, the time at the event";
  const parts = [...ruleParts(field)];
  if (type === "phone") parts.unshift("phone number with 3 to 15 digits");
  if (type === "long_text") parts.unshift("long text");
  if (field.rules?.example) parts.push(`for example ${field.rules.example}`);
  return parts.length > 0 ? parts.join(", ") : null;
}

/** A date and time answer is `YYYY-MM-DDTHH:mm`. The form holds it as typed: either half may still be empty ("2026-11-04T"). */
export function splitDateTime(value: string): { date: string; time: string } {
  const at = value.indexOf("T");
  return at === -1 ? { date: value, time: "" } : { date: value.slice(0, at), time: value.slice(at + 1) };
}

/** The two halves of a date and time answer as one value: empty when both are, otherwise with the `T` between them. */
export function joinDateTime(date: string, time: string): string {
  return date === "" && time === "" ? "" : `${date}T${time}`;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
// One half of a date and time with the other still empty, as the date picker and the time field leave them.
const HALF_DATE_TIME = /^(?:\d{4}-\d{2}-\d{2}T|T\d{2}:\d{2})$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/** True for a day that exists. Worked out here, as the server does, not with `Date`, which rolls 30 February over into March. */
function isCalendarDay(year: number, month: number, day: number): boolean {
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

export function isDateAnswer(value: string): boolean {
  const match = DATE.exec(value);
  return match !== null && isCalendarDay(Number(match[1]), Number(match[2]), Number(match[3]));
}

export function isDateTimeAnswer(value: string): boolean {
  const match = DATE_TIME.exec(value);
  if (match === null || Number(match[4]) > 23 || Number(match[5]) > 59) return false;
  return isCalendarDay(Number(match[1]), Number(match[2]), Number(match[3]));
}

/** A phone number as the server stores it: an optional leading + and the digits ("+48 600-100-200" is "+48600100200"). */
function canonicalPhone(trimmed: string): string {
  const digits = trimmed.replaceAll(/\D/g, "");
  return trimmed.startsWith("+") ? `+${digits}` : digits;
}

const ASCII_DIGITS = /^\d+$/;

/** True when `value`, as the server would keep it, breaks one of the rules: `digits_only` allows 0 to 9 and nothing else, and
 * the lengths count characters as a person does. */
function breaksRules(value: string, rules: EventCustomFieldRules | null | undefined): boolean {
  if (!rules) return false;
  if (rules.digits_only && !ASCII_DIGITS.test(value)) return true;
  const length = codePointLength(value);
  if (rules.min_length !== undefined && length < rules.min_length) return true;
  return rules.max_length !== undefined && length > rules.max_length;
}

function dateTimeProblem(label: string, value: string): string | null {
  if (HALF_DATE_TIME.test(value)) return `${label} needs both a date and a time.`;
  return isDateTimeAnswer(value) ? null : `${label} must be a valid date and time.`;
}

function phoneProblem(field: AnswerField, value: string): string | null {
  if (!isValidContactPhone(value)) return `${field.label} must be ${PHONE_WORDS}.`;
  return breaksRules(canonicalPhone(value), field.rules) ? `${field.label} must be ${answerExpectation(field)}.` : null;
}

function textProblem(field: AnswerField, value: string, limit: number): string | null {
  if (codePointLength(value) > limit) return `${field.label} must be at most ${characters(limit)}.`;
  return breaksRules(value, field.rules) ? `${field.label} must be ${ruleParts(field).join(", ")}.` : null;
}

/** What is wrong with `raw` as an answer to a free-answer field, in a sentence that starts with the field's name, or null when
 * it is fine or empty (whether an empty answer is allowed is the field's `required`, which the caller checks). The same checks
 * as the server's, in the order it makes them. A choice (single choice, yes or no) is checked by its own options. */
export function answerProblem(field: AnswerField, raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  switch (field.type ?? "text") {
    case "date":
      return isDateAnswer(trimmed) ? null : `${field.label} must be a valid date.`;
    case "datetime":
      return dateTimeProblem(field.label, trimmed);
    case "phone":
      return phoneProblem(field, trimmed);
    case "long_text":
      // The server reads every line break as one "\n", and counts what is left after the ends are trimmed.
      return textProblem(field, trimmed.replaceAll(/\r\n?/g, "\n"), EVENT_CUSTOM_FIELD_LONG_TEXT_MAX);
    case "select":
    case "boolean":
      return null;
    default:
      return textProblem(field, trimmed, EVENT_CUSTOM_FIELD_TEXT_MAX);
  }
}
