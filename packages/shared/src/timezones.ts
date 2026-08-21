import { rawTimeZones } from "@vvo/tzdb";
import tzdata from "tzdata" with { type: "json" };

export type TimeZoneDefinition = {
  /** Preferred IANA identifier used for new values and UI display. */
  iana: string;
  /** Accepted legacy identifiers for the same time zone, including `iana`. */
  aliases: readonly string[];
  countryName: string;
  continentName: string;
  alternativeName: string;
  mainCities: readonly string[];
  /** Short display label, e.g. "IST", "CET" - the zone's standard-time abbreviation, not
   * DST-adjusted. Fine for a zone picker (any one representative label); for a specific date use
   * {@link getTimeZoneAbbreviationForDate} instead, which is correct even when that date falls in
   * daylight saving time. */
  abbreviation: string;
  /** The zone's standard (non-DST) UTC offset in minutes, or `null` when unknown (e.g. UTC has no
   * tzdb entry to source this from). Used to detect whether a given date is in DST for this zone. */
  standardOffsetMinutes: number | null;
};

const metadataByIana = new Map(
  rawTimeZones.flatMap((zone) => zone.group.map((iana) => [iana, zone] as const)),
);

function getIanaZoneData(iana: string): readonly unknown[] | string | undefined {
  // `iana` comes from the immutable bundled tzdata keys, not a request or form value.
  // eslint-disable-next-line security/detect-object-injection
  return tzdata.zones[iana];
}

function resolveIanaLink(iana: string): string {
  const visited = new Set<string>();
  let target = iana;

  let linked = getIanaZoneData(target);
  while (typeof linked === "string" && !visited.has(target)) {
    visited.add(target);
    target = linked;
    linked = getIanaZoneData(target);
  }

  return target;
}

const aliasesByPrimaryIana = new Map<string, string[]>();
for (const [iana, rules] of Object.entries(tzdata.zones)) {
  if (Array.isArray(rules) && iana !== "Factory") aliasesByPrimaryIana.set(iana, [iana]);
}
for (const iana of Object.keys(tzdata.zones)) {
  const primary = resolveIanaLink(iana);
  if (primary !== iana) aliasesByPrimaryIana.get(primary)?.push(iana);
}

const TIME_ZONES: readonly TimeZoneDefinition[] = [...aliasesByPrimaryIana].map(
  ([primaryIana, aliases]) => {
    const metadata = metadataByIana.get(primaryIana);
    const iana = primaryIana === "Etc/UTC" ? "UTC" : primaryIana;
    return {
      iana,
      aliases: primaryIana === "Etc/UTC" ? ["UTC", ...aliases] : aliases,
      countryName: metadata?.countryName ?? "",
      continentName: metadata?.continentName ?? "",
      alternativeName: metadata?.alternativeName ?? "",
      mainCities: metadata?.mainCities.filter(Boolean) ?? [],
      abbreviation: iana === "UTC" ? "UTC" : (metadata?.abbreviation ?? ""),
      standardOffsetMinutes: iana === "UTC" ? 0 : (metadata?.rawOffsetInMinutes ?? null),
    };
  },
);

const timeZoneByAlias = new Map<string, TimeZoneDefinition>();
for (const zone of TIME_ZONES) {
  for (const alias of zone.aliases) {
    timeZoneByAlias.set(alias, zone);
  }
}

/** One option per IANA Zone, with IANA Link aliases folded into its aliases. */
export function getTimeZones(): readonly TimeZoneDefinition[] {
  return TIME_ZONES;
}

/** Resolve a current or legacy IANA identifier to its product-preferred identifier. */
export function normalizeTimeZone(timeZone: string): string | null {
  return timeZoneByAlias.get(timeZone.trim())?.iana ?? null;
}

/** Return the one display definition for a current or legacy IANA identifier. */
export function getTimeZone(timeZone: string): TimeZoneDefinition | null {
  return timeZoneByAlias.get(timeZone.trim()) ?? null;
}

const NICE_ABBREVIATION_RE = /^[A-Za-z]{2,5}$/;
const GMT_OFFSET_RE = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/;

function icuTimeZoneNamePart(iana: string, date: Date, style: "short" | "shortOffset"): string | undefined {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: iana, timeZoneName: style })
      .formatToParts(date)
      .find((part) => part.type === "timeZoneName")?.value;
  } catch {
    return undefined;
  }
}

/** Short timezone label correct for a specific date - e.g. "EDT" for a July `America/New_York`
 * date vs "EST" in January - unlike the `abbreviation` field on {@link TimeZoneDefinition}, which
 * is always the zone's standard-time label and would be wrong for roughly half the year in any
 * zone that observes daylight saving.
 *
 * ICU's own `timeZoneName: "short"` is correct for both DST and standard time, but only renders as
 * a real letter abbreviation for a handful of zones (mostly North America) - everywhere else (most
 * of Europe, Asia, Australia) it falls back to a numeric "GMT+2". For those, this compares the
 * date's actual UTC offset to the zone's known standard offset: if they match, the date isn't in
 * DST and the static tzdb abbreviation (e.g. "CET", "IST") is safe to show; if they differ, the
 * date IS in DST and that static label would be wrong, so this falls back to a plain numeric UTC
 * offset instead - never a letter abbreviation for the wrong half of the year. */
export function getTimeZoneAbbreviationForDate(timeZone: string, date: Date): string | null {
  const zone = getTimeZone(timeZone);
  if (!zone) return null;
  if (zone.iana === "UTC") return "UTC";

  const icuShort = icuTimeZoneNamePart(zone.iana, date, "short");
  if (icuShort && NICE_ABBREVIATION_RE.test(icuShort)) return icuShort;

  const offsetRaw = icuTimeZoneNamePart(zone.iana, date, "shortOffset");
  const match = offsetRaw && GMT_OFFSET_RE.exec(offsetRaw);
  let actualOffsetMinutes: number | null = null;
  if (match) {
    const sign = match[1] === "-" ? -1 : 1;
    actualOffsetMinutes = sign * (Number(match[2]) * 60 + Number(match[3] ?? 0));
  }

  if (actualOffsetMinutes != null && actualOffsetMinutes === zone.standardOffsetMinutes && zone.abbreviation) {
    return zone.abbreviation;
  }
  // zone.abbreviation is always a string (never nullish), so it's a safe final fallback here.
  return offsetRaw ?? icuShort ?? zone.abbreviation;
}
