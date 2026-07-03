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

type DatePart = "day" | "month" | "year";

/** Locale order for numeric date input (e.g. dd/mm vs mm/dd). */
export function getLocaleDateInputOrder(): DatePart[] {
  const parts = new Intl.DateTimeFormat(getPreferredLocale()).formatToParts(
    new Date(Date.UTC(2023, 10, 25)),
  );
  return parts
    .filter((p): p is Intl.DateTimeFormatPart & { type: DatePart } =>
      p.type === "day" || p.type === "month" || p.type === "year",
    )
    .map((p) => p.type);
}

/** Example pattern for typed dates, e.g. `dd.mm.yyyy` or `mm/dd/yyyy`. */
export function localeDateInputPattern(): string {
  const sample: Record<DatePart, string> = { day: "dd", month: "mm", year: "yyyy" };
  const parts = new Intl.DateTimeFormat(getPreferredLocale()).formatToParts(
    new Date(Date.UTC(2026, 6, 15)),
  );
  return parts
    .map((p) => {
      if (p.type === "day" || p.type === "month" || p.type === "year") return sample[p.type];
      return p.value.trim();
    })
    .join("")
    .replace(/\s+/g, "");
}

function isValidCalendarDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  const max = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= max;
}

function toIsoDateParts(y: number, m: number, d: number): string | null {
  if (!isValidCalendarDate(y, m, d)) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function resolveDayMonth(a: number, b: number): { d: number; m: number } | null {
  if (a > 31 || b > 31) return null;
  if (a > 12 && b <= 12) return { d: a, m: b };
  if (b > 12 && a <= 12) return { d: b, m: a };
  if (a > 12 && b > 12) return null;
  const order = getLocaleDateInputOrder();
  const monthFirst = order[0] === "month";
  return monthFirst ? { d: b, m: a } : { d: a, m: b };
}

/**
 * Parse a typed calendar date into `YYYY-MM-DD`.
 * Accepts ISO (`yyyy-mm-dd`) and locale-oriented `dd/mm/yyyy` vs `mm/dd/yyyy`.
 */
export function parseFlexibleCalendarDate(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(trimmed)) {
    const [y, m, d] = trimmed.split("-").map((part) => Number.parseInt(part, 10));
    return toIsoDateParts(y, m, d);
  }

  const chunks = trimmed.split(/[./\s-]+/).filter(Boolean);
  if (chunks.length !== 3) return null;

  const nums = chunks.map((part) => Number.parseInt(part, 10));
  if (nums.some((n) => !Number.isFinite(n))) return null;

  const yearIdx = chunks.findIndex((part, i) => part.length === 4 && nums[i]! >= 1000);
  if (yearIdx === 0) {
    const y = nums[0]!;
    const order = getLocaleDateInputOrder().filter((part) => part !== "year");
    if (order[0] === "month") {
      return toIsoDateParts(y, nums[1]!, nums[2]!);
    }
    if (order[0] === "day") {
      return toIsoDateParts(y, nums[2]!, nums[1]!);
    }
    const dm = resolveDayMonth(nums[1]!, nums[2]!);
    return dm ? toIsoDateParts(y, dm.m, dm.d) : null;
  }
  if (yearIdx === 2) {
    const [a, b, y] = nums;
    const dm = resolveDayMonth(a!, b!);
    return dm ? toIsoDateParts(y!, dm.m, dm.d) : null;
  }
  if (yearIdx === 1) {
    return null;
  }

  return null;
}

/** Category 2 — admin/system timestamps always in UTC with explicit label. */
export function formatUtcDateTime(iso: string): string {
  return new Date(iso).toLocaleString(getPreferredLocale(), {
    ...DATETIME_OPTS,
    timeZone: "UTC",
    timeZoneName: "short",
  });
}
