/** The fixed-width head of an ISO-8601-style date-time: "YYYY-MM-DD" and "HH:MM", separated by "T"
 * or a space (PassCreator-style payloads use a space elsewhere). Seconds, fraction and offset are
 * read by hand below rather than by one big regex: nested optional groups trip the repo's
 * unsafe-regex lint rule, and a hand-rolled scan of a bounded string is just as clear. */
const DATE_TIME_HEAD_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/;
const TWO_DIGITS_RE = /^\d{2}$/;
/** "+HH" */
const OFFSET_HOURS_RE = /^[+-]\d{2}$/;
/** "+HH:MM" or "+HHMM" */
const OFFSET_HOURS_MINUTES_RE = /^[+-]\d{2}:?\d{2}$/;

/** Largest absolute UTC offset accepted (the real range is -12:00 to +14:00; ISO 8601 allows more,
 * but nothing a wallet provider sends is beyond this). */
const MAX_OFFSET_MINUTES = 18 * 60;

/** No real timestamp is longer; bounds the work a hostile or garbled provider string can cost. */
const MAX_RAW_LENGTH = 64;

/** `char` is a single character from String#charAt, so "" (past the end) is simply not a digit. */
function isDigit(char: string): boolean {
  return char >= "0" && char <= "9";
}

/** Minutes east of UTC for "Z", "+HH", "+HH:MM" or "+HHMM"; null for anything else or out of range. */
function offsetMinutes(offset: string): number | null {
  if (offset === "Z") return 0;
  if (!OFFSET_HOURS_RE.test(offset) && !OFFSET_HOURS_MINUTES_RE.test(offset)) return null;
  const sign = offset.startsWith("-") ? -1 : 1;
  const digits = offset.slice(1).replace(":", "");
  const hours = Number(digits.slice(0, 2));
  const minutes = digits.length > 2 ? Number(digits.slice(2, 4)) : 0;
  if (minutes >= 60) return null;
  const total = hours * 60 + minutes;
  return total > MAX_OFFSET_MINUTES ? null : sign * total;
}

/** Reads the optional ":SS" and ".fraction" that may follow "HH:MM", returning what they held and
 * where the offset starts - or null when the shape is wrong (a fraction without seconds, a bare
 * "." with no digits, one-digit seconds). Milliseconds only: further fractional digits are
 * truncated, not rounded. */
function readSecondsAndFraction(
  rest: string,
): { seconds: number; millis: number; offsetStart: number } | null {
  let index = 0;
  let seconds = 0;
  let millis = 0;
  if (rest.charAt(index) === ":") {
    const digits = rest.slice(index + 1, index + 3);
    if (!TWO_DIGITS_RE.test(digits)) return null;
    seconds = Number(digits);
    index += 3;
    if (rest.charAt(index) === ".") {
      let end = index + 1;
      while (isDigit(rest.charAt(end))) end++;
      if (end === index + 1) return null;
      millis = Number(rest.slice(index + 1, end).slice(0, 3).padEnd(3, "0"));
      index = end;
    }
  }
  return { seconds, millis, offsetStart: index };
}

/**
 * Parses a provider timestamp into an instant ONLY when the string itself says which offset it is
 * in - never a naive "YYYY-MM-DD HH:MM" (PassCreator's own wire format for expirationDate), which
 * is meaningless without knowing the timezone of the account that produced it. That timezone is a
 * per-account setting (PassCreator company settings), so guessing UTC here would silently shift
 * every date for an account configured otherwise; a naive value stays uninterpreted (null) until
 * the domain layer is told the zone.
 *
 * Accepts "YYYY-MM-DD" + "T" or a space + "HH:MM", optionally ":SS" and (only after seconds)
 * ".fraction", then "Z", "+HH", "+HH:MM" or "+HHMM".
 *
 * Strict about the calendar: JavaScript's own Date rolls an impossible date over into the next
 * month (2026-02-30 becomes 2026-03-02) and accepts hour 24, so the fields are round-tripped and
 * anything that doesn't survive is rejected (null) rather than read as a different real date.
 */
export function parseOffsetInstant(raw: string): Date | null {
  const trimmed = raw.trim();
  if (trimmed.length > MAX_RAW_LENGTH) return null;
  const head = DATE_TIME_HEAD_RE.exec(trimmed);
  if (!head) return null;
  const [matched, year, month, day, hour, minute] = head;

  const rest = trimmed.slice(matched.length);
  const parts = readSecondsAndFraction(rest);
  if (!parts) return null;
  const offsetMin = offsetMinutes(rest.slice(parts.offsetStart));
  if (offsetMin === null) return null;

  const wallClock = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    parts.seconds,
    parts.millis,
  );
  const roundTrip = new Date(wallClock);
  if (
    roundTrip.getUTCFullYear() !== Number(year) ||
    roundTrip.getUTCMonth() !== Number(month) - 1 ||
    roundTrip.getUTCDate() !== Number(day) ||
    roundTrip.getUTCHours() !== Number(hour) ||
    roundTrip.getUTCMinutes() !== Number(minute) ||
    roundTrip.getUTCSeconds() !== parts.seconds
  ) {
    return null;
  }
  return new Date(wallClock - offsetMin * 60_000);
}
