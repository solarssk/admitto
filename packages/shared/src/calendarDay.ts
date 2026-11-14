/** The date and the date and time of an attendee field answer, as the server keeps them and the forms of the staff check them: `YYYY-MM-DD`
 * and `YYYY-MM-DDTHH:mm`, a time on the wall clock with no zone. A day is worked out here and not with `Date`, which reads the years 0 to 99
 * as 1900 to 1999 and rolls 30 February over into March instead of refusing it. */
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function isCalendarDay(year: number, month: number, day: number): boolean {
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

/** True for `YYYY-MM-DD` on a day that exists in the calendar. */
export function isDateAnswer(value: string): boolean {
  const match = DATE.exec(value);
  return match !== null && isCalendarDay(Number(match[1]), Number(match[2]), Number(match[3]));
}

/** True for `YYYY-MM-DDTHH:mm`: a time of day that exists, on a day that exists. A zone, seconds or another separator make it false. */
export function isDateTimeAnswer(value: string): boolean {
  const match = DATE_TIME.exec(value);
  if (match === null || Number(match[4]) > 23 || Number(match[5]) > 59) return false;
  return isCalendarDay(Number(match[1]), Number(match[2]), Number(match[3]));
}
