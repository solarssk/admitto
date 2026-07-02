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

/** Category 1 — time-only with timezone abbreviation (e.g. admitted_at in tables). */
export function formatEventTime(iso: string, timezone?: string): string {
  return new Date(iso).toLocaleString(getPreferredLocale(), {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone ?? "UTC",
    timeZoneName: "short",
  });
}

/** Start of a calendar day in UTC as ISO string (for audit log date filters). */
export function utcDayStartIso(yyyyMmDd: string): string {
  return `${yyyyMmDd}T00:00:00.000Z`;
}

/** End of a calendar day in UTC as ISO string (inclusive upper bound). */
export function utcDayEndIso(yyyyMmDd: string): string {
  return `${yyyyMmDd}T23:59:59.999Z`;
}

/** Display label for a `YYYY-MM-DD` event date field value. */
export function formatIsoCalendarDate(yyyyMmDd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(yyyyMmDd)) return yyyyMmDd;
  return formatEventCalendarDate(`${yyyyMmDd}T12:00:00.000Z`);
}

/** Month heading for the custom date picker (UTC calendar month). */
export function formatCalendarMonth(year: number, month: number): string {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(getPreferredLocale(), {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

const MONDAY_REF_MS = Date.UTC(2024, 0, 1);

/** Short weekday labels, Monday-first, for calendar grids. */
export function getWeekdayLabelsShort(): string[] {
  return Array.from({ length: 7 }, (_, i) =>
    new Date(MONDAY_REF_MS + i * 86_400_000).toLocaleDateString(getPreferredLocale(), {
      weekday: "short",
      timeZone: "UTC",
    }),
  );
}

/** Today's calendar date as `YYYY-MM-DD` in the user's local timezone. */
export function todayIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Category 2 — admin/system timestamps always in UTC with explicit label. */
export function formatUtcDateTime(iso: string): string {
  return new Date(iso).toLocaleString(getPreferredLocale(), {
    ...DATETIME_OPTS,
    timeZone: "UTC",
    timeZoneName: "short",
  });
}
