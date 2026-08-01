/** Structured address parts from Nominatim GeocodeJSON (`addressdetails=1`). All optional —
 * callers pass whatever the provider returned; missing fields fall through to a shorter
 * label or an empty string rather than inventing placeholders. */
export interface CompactAddressParts {
  /** Localized POI / venue name when the match is a named place (e.g. "Złote Tarasy"). */
  name?: string | null;
  housenumber?: string | null;
  street?: string | null;
  city?: string | null;
  country?: string | null;
  /** Full GeocodeJSON `label` — used only as a last-resort fallback when structured fields
   * aren't enough to build a useful string. */
  label?: string | null;
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed;
}

/** "Marywilska 62" (street before number — common European order) or just the street / number. */
export function formatStreetLine(parts: Pick<CompactAddressParts, "street" | "housenumber">): string | null {
  const street = clean(parts.street);
  const housenumber = clean(parts.housenumber);
  if (street && housenumber) return `${street} ${housenumber}`;
  return street ?? housenumber;
}

/**
 * Compact display address for the Location tab:
 * - Named place: `Country, City - Name` (e.g. "Polska, Warszawa - Złote Tarasy")
 * - Bare street: `Country, City - Street Number` (e.g. "Polska, Warszawa - Marywilska 62")
 * - Fallback: first two comma-separated segments of `label`, or the whole label if short
 *
 * A spaced hyphen separates the place/street from the locality so a hyphen inside a street
 * name isn't ambiguous (and we avoid em-dashes in operator-facing copy).
 */
export function formatCompactAddress(parts: CompactAddressParts): string {
  const name = clean(parts.name);
  const streetLine = formatStreetLine(parts);
  const place = name ?? streetLine;
  const city = clean(parts.city);
  const country = clean(parts.country);

  if (place && country && city) return `${country}, ${city} - ${place}`;
  if (place && country) return `${country} - ${place}`;
  if (place && city) return `${city} - ${place}`;
  if (place) return place;
  if (country && city) return `${country}, ${city}`;
  if (country) return country;
  if (city) return city;

  const label = clean(parts.label);
  if (!label) return "";
  // Nominatim labels are "a, b, c, d, …, Country" - keep the first two segments for a
  // shorter fallback rather than dumping the whole hierarchy into the UI.
  const segments = label.split(",").map((s) => s.trim()).filter(Boolean);
  if (segments.length <= 2) return label;
  return segments.slice(0, 2).join(", ");
}

/**
 * Value for the Venue name field when picking a geocoding result: prefer the POI name,
 * otherwise the street+number line, otherwise the compact address (never the raw long label).
 */
export function formatVenueName(parts: CompactAddressParts): string {
  return clean(parts.name) ?? formatStreetLine(parts) ?? formatCompactAddress(parts);
}
