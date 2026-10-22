import { EVENT_CUSTOM_FIELD_LONG_TEXT_MAX, isValidContactPhone } from "@admitto/shared";

/** The length of `value` in code points, the unit every text limit and length rule counts in: an
 * emoji is one character, as the person who typed it sees it. */
export function codePointLength(value: string): number {
  let length = 0;
  for (let i = 0; i < value.length; i += 1) {
    if ((value.codePointAt(i) ?? 0) > 0xffff) i += 1;
    length += 1;
  }
  return length;
}

/** `value` cut to its first `max` code points, never through the middle of a surrogate pair. */
export function truncateToCodePoints(value: string, max: number): string {
  let end = 0;
  for (let length = 0; end < value.length && length < max; length += 1) {
    end += (value.codePointAt(end) ?? 0) > 0xffff ? 2 : 1;
  }
  return value.slice(0, end);
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/** True for a day that exists in the calendar. Worked out here and not with `Date`, which reads the
 * years 0 to 99 as 1900 to 1999 and rolls 30 February over into March instead of refusing it. */
function isCalendarDay(year: number, month: number, day: number): boolean {
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

/** A `date` answer: `YYYY-MM-DD`, a day that exists. Returned as it came; null when it is not one. */
export function normalizeDateAnswer(value: string): string | null {
  const match = DATE.exec(value);
  if (!match) return null;
  return isCalendarDay(Number(match[1]), Number(match[2]), Number(match[3])) ? value : null;
}

/** A `datetime` answer: `YYYY-MM-DDTHH:mm`, a wall-clock time with no zone (read in the time zone of
 * the event) on a day that exists. A zone, seconds or another separator make it null. */
export function normalizeDateTimeAnswer(value: string): string | null {
  const match = DATE_TIME.exec(value);
  if (!match) return null;
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (hour > 23 || minute > 59) return null;
  return isCalendarDay(Number(match[1]), Number(match[2]), Number(match[3])) ? value : null;
}

/** A `phone` answer in its canonical form, an optional leading + and the digits and nothing else
 * ("+48 600-100-200" is "+48600100200"), or null when it is not a phone number by
 * isValidContactPhone: 3 to 15 digits, written with digits, spaces, dashes, dots and parentheses. */
export function normalizePhoneAnswer(value: string): string | null {
  const trimmed = value.trim();
  if (!isValidContactPhone(trimmed)) return null;
  const digits = trimmed.replaceAll(/\D/g, "");
  return trimmed.startsWith("+") ? `+${digits}` : digits;
}

/** A `long_text` answer: line breaks of any kind written as one `\n`, and at most 1000 characters.
 * Longer text is refused, never cut. `trimmed` has no space at either end. */
export function normalizeLongTextAnswer(trimmed: string): string | null {
  // A code point takes at most two UTF-16 units, so a longer string is over the limit without counting.
  if (trimmed.length > EVENT_CUSTOM_FIELD_LONG_TEXT_MAX * 2) return null;
  const text = trimmed.replaceAll(/\r\n?/g, "\n");
  return codePointLength(text) > EVENT_CUSTOM_FIELD_LONG_TEXT_MAX ? null : text;
}
