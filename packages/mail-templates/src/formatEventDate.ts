const DEFAULT_EVENT_TIME_ZONE =
  process.env.ADMITTO_DEFAULT_EVENT_TIMEZONE?.trim() || "UTC";

/**
 * Calendar date for template placeholders (YYYY-MM-DD).
 * Uses the event timezone — not UTC slice — so local midnight stays on the intended day.
 */
export function formatEventDate(
  date: Date,
  timeZone: string = DEFAULT_EVENT_TIME_ZONE,
): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function resolvePreviewEventTimeZone(explicit?: string): string {
  const trimmed = explicit?.trim();
  if (trimmed) return trimmed;
  return DEFAULT_EVENT_TIME_ZONE;
}
