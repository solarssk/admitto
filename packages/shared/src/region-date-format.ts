/**
 * Region-aware date/hour formatting for attendee-facing surfaces (public ticket page + wallet
 * pass content) - shared by `apps/web/src/ticket-page.ts` and `wallet-pass-input.ts` (rendered
 * from two different processes, apps/web and the apps/cli worker) so both show the event date
 * and hours identically.
 *
 * Copy stays English throughout (the ticket page and wallet pass are English-only) - only the
 * *regional convention* (day/month order, spelled vs numeric month, 12h AM/PM vs 24h) adapts to
 * the event's own country, derived from `AddressComponents.country`. That field is always a full
 * English country name (Nominatim's `accept-language=en` is fixed in nominatim-provider.ts), so
 * it's resolved to an ISO 3166-1 region code and formatted as `en-<region>` - English words, that
 * region's date/hour convention (verified: `Intl` derives hour-cycle and date order from the
 * region subtag even when the language subtag stays "en", e.g. "en-US" -> 12h + month/day/year,
 * "en-DE"/"en-PL"/"en-GB" -> 24h + day/month/year).
 *
 * No address, no country, or a country name this module doesn't recognize -> {@link DEFAULT_LOCALE}
 * ("en-GB", 24h) - the exact behavior this app has always shown, and also what a single-country
 * self-hosted deployment with Location/geocoding disabled gets by default.
 */

import { zonedWallClockToUtcIso } from "./zonedWallClock.js";
import { getTimeZoneAbbreviationForDate } from "./timezones.js";

/** ISO 3166-1 alpha-2 codes currently assigned. Hardcoded because `Intl.supportedValuesOf` has
 * no "region" key (only calendar/collation/currency/numberingSystem/timeZone/unit are defined by
 * the spec) - there is no built-in way to enumerate regions. */
const ISO_3166_1_ALPHA2 = [
  "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR", "AS", "AT", "AU", "AW", "AX", "AZ",
  "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BL", "BM", "BN", "BO", "BQ", "BR", "BS",
  "BT", "BV", "BW", "BY", "BZ",
  "CA", "CC", "CD", "CF", "CG", "CH", "CI", "CK", "CL", "CM", "CN", "CO", "CR", "CU", "CV", "CW",
  "CX", "CY", "CZ",
  "DE", "DJ", "DK", "DM", "DO", "DZ",
  "EC", "EE", "EG", "EH", "ER", "ES", "ET",
  "FI", "FJ", "FK", "FM", "FO", "FR",
  "GA", "GB", "GD", "GE", "GF", "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GS", "GT",
  "GU", "GW", "GY",
  "HK", "HM", "HN", "HR", "HT", "HU",
  "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IR", "IS", "IT",
  "JE", "JM", "JO", "JP",
  "KE", "KG", "KH", "KI", "KM", "KN", "KP", "KR", "KW", "KY", "KZ",
  "LA", "LB", "LC", "LI", "LK", "LR", "LS", "LT", "LU", "LV", "LY",
  "MA", "MC", "MD", "ME", "MF", "MG", "MH", "MK", "ML", "MM", "MN", "MO", "MP", "MQ", "MR", "MS",
  "MT", "MU", "MV", "MW", "MX", "MY", "MZ",
  "NA", "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP", "NR", "NU", "NZ",
  "OM",
  "PA", "PE", "PF", "PG", "PH", "PK", "PL", "PM", "PN", "PR", "PS", "PT", "PW", "PY",
  "QA",
  "RE", "RO", "RS", "RU", "RW",
  "SA", "SB", "SC", "SD", "SE", "SG", "SH", "SI", "SJ", "SK", "SL", "SM", "SN", "SO", "SR", "SS",
  "ST", "SV", "SX", "SY", "SZ",
  "TC", "TD", "TF", "TG", "TH", "TJ", "TK", "TL", "TM", "TN", "TO", "TR", "TT", "TV", "TW", "TZ",
  "UA", "UG", "UM", "US", "UY", "UZ",
  "VA", "VC", "VE", "VG", "VI", "VN", "VU",
  "WF", "WS",
  "YE", "YT",
  "ZA", "ZM", "ZW",
] as const;

const DEFAULT_LOCALE = "en-GB";

/** Fixed 3-letter month abbreviations for {@link formatDateShort} - deliberately not CLDR's own
 * short-month text (`Intl`'s en-GB data spells September "Sept", 4 letters, not "Sep") since the
 * whole point of the short form is a predictable, always-3-letter month across every region. */
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A handful of well-known English country names where OpenStreetMap/Nominatim's `name:en` tag
 * diverges from CLDR's `Intl.DisplayNames` output (the source of the main lookup table below,
 * built from {@link ISO_3166_1_ALPHA2}). Not exhaustive by design - anything not covered here (or
 * not an assigned ISO code at all) safely falls back to {@link DEFAULT_LOCALE} rather than
 * guessing at a mapping. */
const COUNTRY_NAME_ALIASES: Record<string, string> = {
  "united states of america": "US",
  "turkey": "TR",
  "czech republic": "CZ",
  "swaziland": "SZ",
  "myanmar": "MM",
  "burma": "MM",
  "vatican": "VA",
  "holy see": "VA",
  "palestine": "PS",
  "hong kong": "HK",
  "macau": "MO",
  "ivory coast": "CI",
  "democratic republic of the congo": "CD",
  "republic of the congo": "CG",
  "east timor": "TL",
};

let countryNameToRegion: Map<string, string> | null = null;

/** Case/diacritic/punctuation-insensitive lookup key - flattens spelling differences like
 * curly vs straight apostrophes ("Côte d’Ivoire" vs "Cote d'Ivoire") or an em-dash vs a space
 * ("Congo-Kinshasa" vs "Congo Kinshasa") without needing an alias entry for each variant. */
function normalizeCountryKey(value: string): string {
  return value
    .normalize("NFD")
    .replaceAll(/[̀-ͯ]/g, "")
    .replaceAll(/[‘’'`]/g, "'")
    .replaceAll(/[-–—]/g, " ")
    .replaceAll("&", "and")
    .toLowerCase()
    .replaceAll(/\s+/g, " ")
    .trim();
}

function getCountryNameToRegionMap(): Map<string, string> {
  if (countryNameToRegion) return countryNameToRegion;
  const map = new Map<string, string>();
  const displayNames = new Intl.DisplayNames(["en"], { type: "region" });
  for (const code of ISO_3166_1_ALPHA2) {
    const name = displayNames.of(code);
    if (name) map.set(normalizeCountryKey(name), code);
  }
  for (const [alias, code] of Object.entries(COUNTRY_NAME_ALIASES)) {
    map.set(normalizeCountryKey(alias), code);
  }
  countryNameToRegion = map;
  return map;
}

/** Resolves a free-text country name (as stored in `AddressComponents.country`) to a
 * region-aware locale tag. Falls back to {@link DEFAULT_LOCALE} for null/missing/unrecognized
 * input. */
function resolveEventLocale(country: string | null | undefined): string {
  const trimmed = country?.trim();
  if (!trimmed) return DEFAULT_LOCALE;
  const region = getCountryNameToRegionMap().get(normalizeCountryKey(trimmed));
  return region ? `en-${region}` : DEFAULT_LOCALE;
}

/** "long month" date, e.g. "24 September 2026" (en-GB/most-of-world default) or "September 24,
 * 2026" (US-style regions). Explicit UTC (bot review) rather than relying on the two processes
 * sharing a host TZ - parseEventDateInput already anchors a date-only input at noon UTC
 * specifically so this never crosses a day boundary for any real deployment, but pinning it here
 * too means that stays true even if that anchoring ever changes. */
export function formatDate(d: Date, country?: string | null): string {
  const locale = resolveEventLocale(country);
  return d.toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/** "short month" date, e.g. "24 Sep 2026" (en-GB/most-of-world default) or "Sep 24, 2026"
 * (US-style regions) - same day/month order and region resolution as {@link formatDate}, only the
 * month is a fixed 3-letter abbreviation ({@link MONTH_SHORT}) instead of the full name. For
 * wallet pass template fields too narrow for the long form (Apple Wallet's secondary/auxiliary
 * fields are effectively one line) - a separate placeholder an admin opts into per field, not a
 * replacement for the long one. Built from the long formatter's own part order/punctuation with
 * only the "month" part substituted, so day/month order and comma placement still follow the
 * event's region exactly like {@link formatDate}. */
export function formatDateShort(d: Date, country?: string | null): string {
  const locale = resolveEventLocale(country);
  const month = MONTH_SHORT[d.getUTCMonth()];
  const parts = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .formatToParts(d);
  return parts.map((p) => (p.type === "month" ? month : p.value)).join("");
}

/** Single "HH:MM" wall-clock time in the event's own regional convention: zero-padded 24h
 * ("09:00") for 24h-style regions - byte-identical to the raw stored value - or "9:00 am" for
 * 12h-style ones. `hhmm` is validated input from a plain `<input type="time">` on the event
 * form; malformed input is returned unchanged rather than guessed. */
export function formatEventHour(hhmm: string, country?: string | null): string {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!match) return hhmm;
  const [, hh, mm] = match;
  const locale = resolveEventLocale(country);
  const hourCycle = new Intl.DateTimeFormat(locale, { hour: "numeric", timeZone: "UTC" }).resolvedOptions()
    .hourCycle;
  const isH12 = hourCycle === "h11" || hourCycle === "h12";
  const probe = new Date(Date.UTC(2000, 0, 1, Number(hh), Number(mm)));
  const formatted = new Intl.DateTimeFormat(locale, {
    hour: isH12 ? "numeric" : "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    hourCycle,
  }).format(probe);
  // ICU's am/pm casing varies by locale (en-US: "AM", en-GB/en-IN: "am") - force lowercase so
  // every region reads the same on the ticket regardless of the event's country.
  return isH12 ? formatted.replace(/\s?(AM|PM)\b/i, (m) => m.toLowerCase()) : formatted;
}

/** The real instant `hhmm` on `eventDate`'s calendar day resolves to in `timezone` - the correct,
 * DST-aware instant (via {@link zonedWallClockToUtcIso}), not `eventDate` itself (a display-only
 * sentinel anchored at noon UTC, see {@link formatDate}). Needed because a same-day DST
 * transition can put noon UTC on the opposite side of the transition from the actually-configured
 * hour - e.g. an America/New_York event at 00:30 on the US spring-forward date is still EST, even
 * though noon UTC that same day is already EDT. */
function resolveHourInstant(eventDate: Date, hhmm: string, timezone: string): Date {
  const y = eventDate.getUTCFullYear();
  const m = eventDate.getUTCMonth();
  const d = eventDate.getUTCDate();
  const dayStr = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return new Date(zonedWallClockToUtcIso(dayStr, `${hhmm}:00.000`, timezone));
}

/** Event-hours range with the two times joined by a spaced hyphen, or an open-ended "from"/"until"
 * when only one side is set - each bound in the event's regional convention (see
 * {@link formatEventHour}). The timezone abbreviation (e.g. "IST", "EDT") is returned separately
 * so a caller with a styled layout (the ticket page) can de-emphasize it rather than baking it
 * into the same string - resolved at the actually-configured start (or end, if there's no start)
 * hour via {@link resolveHourInstant}, not `eventDate`'s own noon-UTC sentinel, so a summer event
 * in a DST-observing zone shows "EDT", not a stale "EST" (the zone's standard-time label would be
 * wrong for roughly half the year there), and an hour near a same-day DST transition shows the
 * abbreviation that actually applies to it rather than whatever noon UTC happens to resolve to
 * that day (bot review: a 00:30 America/New_York event on the US spring-forward date is still
 * EST, even though noon UTC that day is already EDT). Falls back to `eventDate` itself only for a
 * malformed hour string, matching {@link formatEventHour}'s own "return unchanged rather than
 * guessing" behavior. Shared by the public ticket page and the wallet pass (`event_hours`
 * placeholder) so both show the identical range, spacing, and zone suffix. */
export function formatEventHoursRange(
  start: string | null,
  end: string | null,
  country: string | null | undefined,
  timezone: string,
  eventDate: Date,
): { hours: string; tzAbbr: string | null } | null {
  const anchor = start ?? end;
  let anchorInstant = eventDate;
  if (anchor && /^\d{2}:\d{2}$/.test(anchor)) {
    try {
      anchorInstant = resolveHourInstant(eventDate, anchor, timezone);
    } catch {
      // `timezone` isn't a real IANA zone `Intl` recognizes - getTimeZoneAbbreviationForDate
      // below already validates against the app's own tzdb before touching `Intl` and returns
      // null for exactly this case, so this just needs to not crash the caller.
    }
  }
  const tzAbbr = getTimeZoneAbbreviationForDate(timezone, anchorInstant);
  if (start && end) return { hours: `${formatEventHour(start, country)} - ${formatEventHour(end, country)}`, tzAbbr };
  if (start) return { hours: `from ${formatEventHour(start, country)}`, tzAbbr };
  if (end) return { hours: `until ${formatEventHour(end, country)}`, tzAbbr };
  return null;
}
