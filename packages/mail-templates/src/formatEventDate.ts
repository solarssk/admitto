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
