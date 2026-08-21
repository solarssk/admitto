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
   * DST-adjusted (matches this codebase's existing wall-clock-only time display). */
  abbreviation: string;
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
