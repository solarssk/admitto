const EVENT_DATE_OPTS: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
};

const EVENT_DATETIME_OPTS: Intl.DateTimeFormatOptions = {
  dateStyle: "short",
  timeStyle: "short",
};

/** Event date for cards and lists — always in event timezone; falls back to UTC. */
export function formatEventDate(iso: string, timezone?: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    ...EVENT_DATE_OPTS,
    timeZone: timezone ?? "UTC",
  });
}

/** Archived-at or similar timestamps in event timezone; falls back to UTC. */
export function formatEventDateTime(iso: string, timezone?: string): string {
  return new Date(iso).toLocaleString(undefined, {
    ...EVENT_DATETIME_OPTS,
    timeZone: timezone ?? "UTC",
  });
}
