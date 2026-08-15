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

/**
 * Preview of the {{event_date}} wallet placeholder - mirrors apps/web/src/ticket-page.ts's own
 * formatDate default (en-GB, day/long month/year). The real pass is now region-aware (it adapts
 * to the event's own country via @admitto/tickets' region-date-format.ts), so this preview is
 * only exact for events with no country set / an unrecognized country - it does not thread the
 * event's address_components.country through, so a US-style event's actual pass date can differ
 * from what's shown here. Deliberately NOT `getPreferredLocale()` like `formatEventDate` above:
 * the fallback the pass renders is fixed regardless of the admin's own locale, so this previews
 * that fixed output, not the viewer's own preference. Pinned to UTC since `Event.date` is stored
 * as a UTC calendar day (see `formatEventCalendarDate` above) - avoids an off-by-one-day flip
 * from the admin's own timezone.
 */
export function formatWalletDatePreview(isoDate: string): string | null {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Numeric UTC offset for `timezone` at the instant `iso`, e.g. "UTC+2" or "UTC+5:30" ("UTC"
 * with no offset for the UTC zone itself, which has none). Resolved for the given instant
 * (not the zone's year-round standard offset) so DST is reflected correctly — a Warsaw event
 * in July reads "UTC+2", the same event in January reads "UTC+1".
 *
 * Deliberately locale-independent (always "en-US" internally, regardless of the viewer's own
 * `getPreferredLocale()`): `timeZoneName: "short"` used to render this same offset as a letter
 * abbreviation ("CEST", "IST") or a numeric one ("GMT+2") depending on the *viewer's* locale,
 * not the event's zone — two admins looking at the same event time could see different formats.
 * A fixed numeric offset removes that ambiguity for every locale and every zone (e.g. India's
 * GMT+5:30 has no short letter abbreviation at all).
 *
 * Returns "" for an invalid/unparseable `iso` rather than throwing, so callers that build a
 * "base + offset" string (e.g. formatEventDateTime) degrade to the base's own "Invalid Date"
 * text instead of crashing - `Intl.DateTimeFormat.formatToParts` throws on an invalid Date,
 * unlike `Date.prototype.toLocaleString`, which silently renders "Invalid Date".
 */
export function utcOffsetLabel(iso: string, timezone = "UTC"): string {
  if (timezone === "UTC") return "UTC";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "shortOffset",
  }).formatToParts(date);
  const gmtOffset = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+0";
  return gmtOffset.replace("GMT", "UTC");
}

/**
 * Full zone label for contexts where the IANA zone name itself must also be shown next to the
 * offset — audit trails and attendee-facing mail, where the event's zone isn't otherwise visible
 * on the page/screen — e.g. "(Europe/Warsaw, UTC+2)", or bare "(UTC)" for the UTC zone.
 */
export function zonedTimeLabel(iso: string, timezone = "UTC"): string {
  if (timezone === "UTC") return "(UTC)";
  const offset = utcOffsetLabel(iso, timezone);
  return offset ? `(${timezone}, ${offset})` : `(${timezone})`;
}

/** Plain "9:41 AM"-style clock time in the viewer's own locale/zone, no date or offset — for
 * decorative sample chrome (Communication's mail-client preview "received at" stamp) that isn't
 * a real operational timestamp and so doesn't need Category 1/2's zone-disambiguation suffix. */
export function browserClockTime(date: Date): string {
  return date.toLocaleTimeString(getPreferredLocale(), { hour: "numeric", minute: "2-digit" });
}

/** Browser IANA zone for Category-1 stamps in staff UI (Send test, Health check Generated). */
export function getBrowserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** Cached per locale+zone - shared by every "viewer's local time" secondary line (Active
 * sessions, Role assignments) that ticks on every render of a live-updating table, so a
 * per-render `new Intl.DateTimeFormat()` here would be needless. */
const hourMinuteFormatCache = new Map<string, Intl.DateTimeFormat>();

function hourMinuteFormat(timeZone: string): Intl.DateTimeFormat {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale;
  const key = `${locale}\0${timeZone}`;
  let format = hourMinuteFormatCache.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone });
    hourMinuteFormatCache.set(key, format);
  }
  return format;
}

/** An instant, converted to whoever is currently viewing the table's own browser timezone - for
 * rows with no captured actor/device timezone (unlike Audit log entries, which do), matching
 * that panel's own "no known actor zone" convention rather than fabricating one. */
export function viewerLocalTime(iso: string): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const hhmm = hourMinuteFormat(timeZone).format(new Date(iso));
  return `${hhmm} ${zonedTimeLabel(iso, timeZone)}`;
}

/** Category 2 companion — "HH:MM (IANA, UTC±offset)", the secondary line under a Category 2 UTC
 * primary time showing the same instant in a specific known zone (an actor's or a delivery's
 * client_timezone) - not a full date, since this always sits directly under a line that already
 * carries one. Same composition as Audit/Security log's own userLocalTimeText. */
export function formatZonedClockTime(iso: string, timezone: string): string {
  const hhmm = new Date(iso).toLocaleString(getPreferredLocale(), {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  });
  return `${hhmm} ${zonedTimeLabel(iso, timezone)}`;
}

/** Category 1 — event operational timestamps in event timezone with a numeric UTC offset. */
export function formatEventDateTime(iso: string, timezone?: string): string {
  const base = new Date(iso).toLocaleString(getPreferredLocale(), {
    ...DATETIME_OPTS,
    timeZone: timezone ?? "UTC",
  });
  const offset = utcOffsetLabel(iso, timezone);
  return offset ? `${base} ${offset}` : base;
}

/** Category 1 — time-only with a numeric UTC offset (e.g. admitted_at in tables). */
export function formatEventTime(iso: string, timezone?: string): string {
  const base = new Date(iso).toLocaleString(getPreferredLocale(), {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone ?? "UTC",
  });
  const offset = utcOffsetLabel(iso, timezone);
  return offset ? `${base} ${offset}` : base;
}

/** Start of a calendar day in UTC as ISO string (for audit log date filters). */
export function utcDayStartIso(yyyyMmDd: string): string {
  return `${yyyyMmDd}T00:00:00.000Z`;
}

/** End of a calendar day in UTC as ISO string (inclusive upper bound). */
export function utcDayEndIso(yyyyMmDd: string): string {
  return `${yyyyMmDd}T23:59:59.999Z`;
}

/** What a UTC instant's wall clock reads as in `timeZone`, expressed as if those same digits
 * were UTC millis - the building block of the "double conversion" trick: comparing this against
 * the originally requested wall clock tells you how far off a guessed instant is. */
function readZonedWallClockAsUtcMillis(instantMillis: number, timeZone: string, ms: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(instantMillis));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const hour = get("hour");
  return Date.UTC(get("year"), get("month") - 1, get("day"), hour === 24 ? 0 : hour, get("minute"), get("second"), ms);
}

/** UTC instant for a given wall-clock time (`HH:mm:ss.SSS`) of `yyyyMmDd` as observed in
 * `timeZone` - the "double conversion" trick: a naive guess treating the wall-clock time as
 * UTC, corrected by however far that guess's own reading (via Intl) in `timeZone` drifted from
 * what was actually asked for (the zone's UTC offset at that moment, DST included).
 *
 * A single correction pass is only exact when the offset doesn't change between the naive
 * guess and the corrected instant - false right across a DST transition, most visibly when the
 * transition itself falls at local midnight (bot review: `zonedDayStartIso("2023-04-28",
 * "Africa/Cairo")` landed on 2023-04-27T21:00Z, 23:00 the previous day locally, instead of the
 * first valid moment of April 28). Re-validating the corrected instant and correcting again
 * converges within a couple of passes for a real offset change. */
function zonedWallClockToUtcIso(yyyyMmDd: string, hhMmSsMs: string, timeZone: string): string {
  const target = new Date(`${yyyyMmDd}T${hhMmSsMs}Z`).getTime();
  const ms = new Date(target).getUTCMilliseconds();

  let candidate = target;
  let readBack = readZonedWallClockAsUtcMillis(candidate, timeZone, ms);
  for (let i = 0; i < 3 && readBack !== target; i++) {
    candidate += target - readBack;
    readBack = readZonedWallClockAsUtcMillis(candidate, timeZone, ms);
  }

  if (readBack !== target) {
    // The requested wall-clock time doesn't exist in `timeZone` - a spring-forward transition
    // skipped straight over it (e.g. local midnight itself). Re-correcting from here just
    // oscillates between the last valid instant before the gap and the first one after it;
    // resolve to the earliest instant that reads back on or after what was actually asked for,
    // so a "day start" bound can't slip back into the previous day.
    const other = candidate + (target - readBack);
    const otherReadBack = readZonedWallClockAsUtcMillis(other, timeZone, ms);
    const options = [
      { instant: candidate, readBack },
      { instant: other, readBack: otherReadBack },
    ].sort((a, b) => a.readBack - b.readBack);
    candidate = (options.find((o) => o.readBack >= target) ?? options.at(-1)!).instant;
  }

  return new Date(candidate).toISOString();
}

/** Start of a calendar day in `timeZone` as a UTC ISO instant (for a timezone-aware date filter). */
export function zonedDayStartIso(yyyyMmDd: string, timeZone: string): string {
  return zonedWallClockToUtcIso(yyyyMmDd, "00:00:00.000", timeZone);
}

/** End of a calendar day in `timeZone` as a UTC ISO instant (inclusive upper bound). */
export function zonedDayEndIso(yyyyMmDd: string, timeZone: string): string {
  return zonedWallClockToUtcIso(yyyyMmDd, "23:59:59.999", timeZone);
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
  const pattern = parts
    .map((p) => {
      if (p.type === "day" || p.type === "month" || p.type === "year") return sample[p.type];
      return p.value.trim();
    })
    .join("")
    .replace(/\s+/g, "");
  // Drop trailing locale punctuation (e.g. ko-KR `yyyy.mm.dd.`).
  return pattern.replace(/[./\s-]+$/u, ""); // NOSONAR — single anchored character class, one quantifier, no nesting/overlap
}

/** User-facing validation hint aligned with `localeDateInputPattern()`. */
export function calendarDateValidationHint(pattern: string): string {
  if (pattern.startsWith("yyyy")) {
    return pattern;
  }
  return `${pattern} or yyyy-mm-dd`;
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
 * When the year is typed first, parts are always read as year-month-day (ISO order)
 * regardless of locale or separator.
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
  if (chunks.some((part) => !/^\d+$/.test(part))) return null;

  const nums = chunks.map((part) => Number.parseInt(part, 10));
  if (nums.some((n) => !Number.isFinite(n))) return null;

  const yearIdx = chunks.findIndex((part, i) => part.length === 4 && nums[i]! >= 1000);
  if (yearIdx === 0) {
    const y = nums[0]!;
    return toIsoDateParts(y, nums[1]!, nums[2]!);
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

/** Calendar day (`YYYY-MM-DD`) of a timestamp in the given timezone. */
export function calendarDateInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/**
 * Compact admission timestamp for tables and feeds (#359): time-only when the
 * admission happened on the event's calendar day, date + time otherwise (test
 * scans, early/late edge cases). `eventDateIso` is the date-only `Event.date`
 * stored as UTC noon, so its calendar day is read in UTC; the admission day is
 * read in the event timezone. Unknown event date falls back to date + time.
 */
export function formatAdmissionDisplay(
  admittedAtIso: string,
  eventDateIso: string | null | undefined,
  timezone?: string,
): string {
  if (eventDateIso) {
    const eventDay = calendarDateInZone(eventDateIso, "UTC");
    const admissionDay = calendarDateInZone(admittedAtIso, timezone ?? "UTC");
    if (admissionDay === eventDay) return formatEventTime(admittedAtIso, timezone);
  }
  return formatEventDateTime(admittedAtIso, timezone);
}

/**
 * Calendar day immediately before `isoDate` (`YYYY-MM-DD`). Pure date-part
 * arithmetic anchored to UTC noon (never a real elapsed-time subtraction) —
 * a fixed 24h/86_400_000ms subtraction lands on the wrong calendar day
 * whenever the zone's local day being subtracted from is a 23-hour
 * spring-forward day (review finding).
 */
function previousIsoDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const prev = new Date(Date.UTC(y!, m! - 1, d!));
  prev.setUTCDate(prev.getUTCDate() - 1);
  return prev.toISOString().slice(0, 10);
}

/** Shared by formatRelativeAdmissionDisplay and formatAdmissionDisplayParts — classifies an
 * admission timestamp as today/yesterday (relative to now, in the given zone) or neither. */
function classifyAdmissionDay(admittedAtIso: string, timezone?: string): "today" | "yesterday" | null {
  const admissionDay = calendarDateInZone(admittedAtIso, timezone ?? "UTC");
  const today = calendarDateInZone(new Date().toISOString(), timezone ?? "UTC");
  if (admissionDay === today) return "today";
  if (admissionDay === previousIsoDate(today)) return "yesterday";
  return null;
}

/**
 * Live-feed variant of formatAdmissionDisplay (Recent scans, Overview
 * "recent check-ins"): "Today HH:MM" / "Yesterday HH:MM" when the admission
 * happened today or yesterday relative to now — more useful for an operator
 * watching a feed in real time than a bare date, especially when the
 * event's own calendar day (formatAdmissionDisplay's rule) is far in the
 * future or past relative to when staff are actually scanning (setup day,
 * test scans). Anything older falls back to formatAdmissionDisplay.
 */
export function formatRelativeAdmissionDisplay(
  admittedAtIso: string,
  eventDateIso: string | null | undefined,
  timezone?: string,
): string {
  const dayClass = classifyAdmissionDay(admittedAtIso, timezone);
  if (dayClass === "today") return `Today ${formatEventTime(admittedAtIso, timezone)}`;
  if (dayClass === "yesterday") return `Yesterday ${formatEventTime(admittedAtIso, timezone)}`;
  return formatAdmissionDisplay(admittedAtIso, eventDateIso, timezone);
}

export interface AdmissionDisplayParts {
  /** "Today" / "Yesterday" / a full date, for a cell that stacks day above time. */
  day: string;
  time: string;
}

/**
 * Structured two-line variant of {@link formatRelativeAdmissionDisplay}, for cells that
 * already stack two lines (e.g. the Attendees list, next to the name/email cell) instead
 * of a single "Today HH:MM" string.
 */
export function formatAdmissionDisplayParts(
  admittedAtIso: string,
  timezone?: string,
): AdmissionDisplayParts {
  const dayClass = classifyAdmissionDay(admittedAtIso, timezone);
  const time = formatEventTime(admittedAtIso, timezone);
  if (dayClass === "today") return { day: "Today", time };
  if (dayClass === "yesterday") return { day: "Yesterday", time };
  return { day: formatEventDate(admittedAtIso, timezone), time };
}

/** Category 2 — admin/system timestamps always in UTC with explicit label. */
export function formatUtcDateTime(iso: string): string {
  const base = new Date(iso).toLocaleString(getPreferredLocale(), {
    ...DATETIME_OPTS,
    timeZone: "UTC",
  });
  return `${base} UTC`;
}

/**
 * Compact "N min/hours/days ago" for recency-focused UI (session/staff activity, live feeds) -
 * an alternative to formatUtcDateTime's absolute timestamp for contexts where how recent
 * something was matters more than the exact instant. Canonical version: previously duplicated
 * with slightly different hour/day thresholds in StaffUserListItem.tsx (hours < 48, days < 60)
 * and EventOverviewPage.tsx (hours < 24, days < 30) - both now delegate here. The hours < 24 /
 * days < 30 thresholds are the more common convention (avoids ever showing e.g. "47 hours ago").
 * Callers decide their own fallback text for a missing/null timestamp; this only formats a
 * known instant.
 */
export function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 60_000) return "Just now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}
