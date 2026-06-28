import { getPreferredLocale } from "./locale-store.js";

const EVENT_DATE_OPTS: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  year: "numeric",
};

const DATETIME_OPTS: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

/** Event date for cards and lists — event timezone; user preferred locale or browser default. */
export function formatEventDate(iso: string, timezone?: string): string {
  return new Date(iso).toLocaleDateString(getPreferredLocale(), {
    ...EVENT_DATE_OPTS,
    timeZone: timezone ?? "UTC",
  });
}

/**
 * Calendar date for `Event.date` (date-only input stored as UTC noon).
 * Uses the UTC calendar day from storage so negative/positive offsets cannot shift the picked day.
 */
export function formatEventCalendarDate(iso: string): string {
  return formatEventDate(iso, "UTC");
}

/** Category 1 — event operational timestamps in event timezone with TZ abbreviation. */
export function formatEventDateTime(iso: string, timezone?: string): string {
  return new Date(iso).toLocaleString(getPreferredLocale(), {
    ...DATETIME_OPTS,
    timeZone: timezone ?? "UTC",
    timeZoneName: "short",
  });
}

/** Category 2 — admin/system timestamps always in UTC with explicit label. */
export function formatUtcDateTime(iso: string): string {
  return new Date(iso).toLocaleString(getPreferredLocale(), {
    ...DATETIME_OPTS,
    timeZone: "UTC",
    timeZoneName: "short",
  });
}
