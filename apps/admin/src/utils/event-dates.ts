const EVENT_DATE_OPTS: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
};

const EVENT_DATETIME_OPTS: Intl.DateTimeFormatOptions = {
  dateStyle: "short",
  timeStyle: "short",
};

/** Event date for cards and lists (browser locale, date only). */
export function formatEventDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, EVENT_DATE_OPTS);
}

/** Archived-at timestamp (browser locale, date + time). */
export function formatEventDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, EVENT_DATETIME_OPTS);
}
