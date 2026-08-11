import { rawTimeZones } from "@vvo/tzdb";

export type TimeZoneDefinition = {
  /** Preferred IANA identifier used for new values and UI display. */
  iana: string;
  /** Accepted legacy identifiers for the same time zone, including `iana`. */
  aliases: readonly string[];
  countryName: string;
  continentName: string;
  alternativeName: string;
  mainCities: readonly string[];
};

const UTC: TimeZoneDefinition = {
  iana: "UTC",
  aliases: ["UTC", "Etc/UTC", "Etc/UCT", "UCT", "Universal", "Zulu"],
  countryName: "",
  continentName: "",
  alternativeName: "Coordinated Universal Time",
  mainCities: [],
};

const TIME_ZONES: readonly TimeZoneDefinition[] = [
  UTC,
  ...rawTimeZones.map((zone) => ({
    iana: zone.name,
    aliases: zone.group,
    countryName: zone.countryName,
    continentName: zone.continentName,
    alternativeName: zone.alternativeName,
    mainCities: zone.mainCities.filter(Boolean),
  })),
];

const timeZoneByAlias = new Map<string, TimeZoneDefinition>();
for (const zone of TIME_ZONES) {
  for (const alias of zone.aliases) {
    timeZoneByAlias.set(alias, zone);
  }
}

/** One option per real-world time zone, with legacy IANA links folded into its aliases. */
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
