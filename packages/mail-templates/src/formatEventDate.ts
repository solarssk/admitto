const DEFAULT_EVENT_TIME_ZONE =
  process.env.ADMITTO_DEFAULT_EVENT_TIMEZONE?.trim() || "UTC";

function isValidIanaTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Fall back to UTC when env or caller passes an invalid IANA timezone. */
function safeTimeZone(timeZone: string): string {
  return isValidIanaTimeZone(timeZone) ? timeZone : "UTC";
}

/**
 * Calendar date for template placeholders (YYYY-MM-DD).
 * Uses the event timezone — not UTC slice — so local midnight stays on the intended day.
 */
export function formatEventDate(
  date: Date,
  timeZone: string = DEFAULT_EVENT_TIME_ZONE,
): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: safeTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function resolvePreviewEventTimeZone(explicit?: string): string {
  const trimmed = explicit?.trim();
  if (trimmed) return safeTimeZone(trimmed);
  return safeTimeZone(DEFAULT_EVENT_TIME_ZONE);
}

/**
 * "HH:MM-HH:MM" for template placeholders, or "" when either bound is unset (independently
 * optional, same as Event.event_hours_start/end - see schema.prisma). Both bounds are already
 * stored as display-only "HH:MM" strings, so no timezone conversion applies here - same
 * fixed-format precedent as formatEventDate's "UTC" default.
 */
export function formatEventHours(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  if (!start || !end) return "";
  return `${start}-${end}`;
}
