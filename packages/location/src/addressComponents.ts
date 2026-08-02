import { formatDirectionsAddress, formatStreetLine, type CompactAddressParts } from "./formatAddress.js";

/** Structured address fields shown in the Location tab's always-visible grid (and persisted
 * on `EventLocation.address_components`). Null means "not set" / show a placeholder dash. */
export interface AddressComponents {
  object_name: string | null;
  street: string | null;
  postcode: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
}

export const EMPTY_ADDRESS_COMPONENTS: AddressComponents = {
  object_name: null,
  street: null,
  postcode: null,
  city: null,
  region: null,
  country: null,
};

const COMPONENT_MAX_LENGTH = 200;

/** PL `00-120`, generic 4–6 digit, UK-ish outward codes — enough for Nominatim labels. */
const POSTCODE_RE = /^(?:\d{2}-\d{3}|\d{4,6}|[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})$/i;
const REGION_RE = /województwo|voivodeship|province|canton|oblast|région|region\b|state of/i;
/** Standalone house-number token: `12`, `12A`, `12/14`, `1-3`. */
const HOUSE_NUMBER_RE = /^\d+[a-zA-Z]?(?:[/-]\d+[a-zA-Z]?)?$/;
/** "Wybrzeże Szczecińskie 1" - number glued to the street name in one Nominatim segment. */
const TRAILING_NUMBER_IN_SEGMENT_RE = /^(.*\S)\s+(\d+[a-zA-Z]?(?:[/-]\d+[a-zA-Z]?)?)$/;

function cleanComponent(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.length > COMPONENT_MAX_LENGTH ? trimmed.slice(0, COMPONENT_MAX_LENGTH) : trimmed;
}

/** Build grid fields from Nominatim GeocodeJSON parts (+ optional postcode/state). */
export function addressComponentsFromParts(
  parts: CompactAddressParts & { postcode?: string | null; state?: string | null },
): AddressComponents {
  return {
    object_name: cleanComponent(parts.name),
    street: cleanComponent(formatStreetLine(parts)),
    postcode: cleanComponent(parts.postcode),
    city: cleanComponent(parts.city),
    region: cleanComponent(parts.state),
    country: cleanComponent(parts.country),
  };
}

/** Pop the last segment when it matches `predicate`; otherwise leave the list unchanged. */
function popMatchingTail(parts: string[], predicate: (segment: string) => boolean): string | null {
  const tail = parts.at(-1);
  if (!tail || !predicate(tail)) return null;
  parts.pop();
  return tail;
}

/** True when a Street & number field already includes a house number. */
export function streetLineLooksNumbered(street: string | null | undefined): boolean {
  const trimmed = street?.trim();
  if (!trimmed) return false;
  // Prefer token split over one complex alternation regex (Sonar S5843).
  return trimmed.split(/\s+/).some((token) => HOUSE_NUMBER_RE.test(token));
}

function streetLineFromSegment(segment: string): string | null {
  const match = TRAILING_NUMBER_IN_SEGMENT_RE.exec(segment);
  if (match) {
    return cleanComponent(formatStreetLine({ street: match[1], housenumber: match[2] }));
  }
  return cleanComponent(segment);
}

function parseStreetFromLeadingSegments(parts: string[]): string | null {
  if (parts.length >= 2 && HOUSE_NUMBER_RE.test(parts[0]!)) {
    return cleanComponent(formatStreetLine({ street: parts[1], housenumber: parts[0] }));
  }
  if (parts.length === 0) return null;

  const numberIdx = parts.findIndex((s) => HOUSE_NUMBER_RE.test(s));
  if (numberIdx >= 0 && parts.length >= 2) {
    const housenumber = parts[numberIdx]!;
    const streetName = parts.find((s, i) => i !== numberIdx && !HOUSE_NUMBER_RE.test(s));
    return cleanComponent(formatStreetLine({ street: streetName, housenumber }));
  }
  if (!HOUSE_NUMBER_RE.test(parts[0]!)) {
    return streetLineFromSegment(parts[0]!);
  }
  return null;
}

/**
 * Prefer a street line that already includes a house number when merging geocode + reverse
 * (or label) results. GeocodeJSON often returns street-only for large POIs.
 */
export function preferNumberedStreet(
  primary: AddressComponents,
  fallback: AddressComponents,
): AddressComponents {
  const merged = mergeAddressComponents(primary, fallback);
  const primaryStreet = primary.street?.trim() ?? "";
  const fallbackStreet = fallback.street?.trim() ?? "";
  // e.g. primary "Route 66" + fallback "Route 66 100" (numeric street name + house number).
  const fallbackExtendsPrimary =
    Boolean(primaryStreet && fallbackStreet) &&
    fallbackStreet.startsWith(`${primaryStreet} `) &&
    HOUSE_NUMBER_RE.test(fallbackStreet.slice(primaryStreet.length + 1));

  if (
    streetLineLooksNumbered(fallback.street) &&
    (!streetLineLooksNumbered(primary.street) || fallbackExtendsPrimary)
  ) {
    return { ...merged, street: fallback.street };
  }
  return merged;
}

/**
 * Best-effort parse of a Nominatim comma-separated `label` when GeocodeJSON omits structured
 * street/city fields (common for amenity POIs that only carry `name` + hierarchical label).
 *
 * Example: "Złote Tarasy, 59, Złota, Śródmieście, Warszawa, województwo mazowieckie, Polska"
 */
export function addressComponentsFromNominatimLabel(
  label: string,
  name?: string | null,
): AddressComponents {
  const segments = label
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0) {
    return { ...EMPTY_ADDRESS_COMPONENTS, object_name: cleanComponent(name) };
  }

  const parts = [...segments];
  const cleanedName = cleanComponent(name);
  if (cleanedName && parts[0]?.toLowerCase() === cleanedName.toLowerCase()) {
    parts.shift();
  }

  const country = popMatchingTail(parts, () => true);
  const postcode = popMatchingTail(parts, (s) => POSTCODE_RE.test(s));
  const region = popMatchingTail(parts, (s) => REGION_RE.test(s));
  const city = popMatchingTail(parts, () => true);
  const street = parseStreetFromLeadingSegments(parts);

  return {
    object_name: cleanedName,
    street,
    postcode: cleanComponent(postcode),
    city: cleanComponent(city),
    region: cleanComponent(region),
    country: cleanComponent(country),
  };
}

/** True when every field is null/empty (used for dirty checks and "clear" patches). */
export function isAddressComponentsEmpty(components: AddressComponents | null | undefined): boolean {
  if (!components) return true;
  return (
    !components.object_name &&
    !components.street &&
    !components.postcode &&
    !components.city &&
    !components.region &&
    !components.country
  );
}

/**
 * True when the grid has nothing useful beyond a POI name — typical for Nominatim GeocodeJSON
 * amenity matches that only set `name` + `label`.
 */
export function isAddressComponentsSparse(components: AddressComponents | null | undefined): boolean {
  if (!components || isAddressComponentsEmpty(components)) return true;
  return !components.street && !components.postcode && !components.city && !components.country;
}

/** Fill null fields in `primary` from `fallback` (e.g. structured parts + label parse). */
export function mergeAddressComponents(
  primary: AddressComponents,
  fallback: AddressComponents,
): AddressComponents {
  return {
    object_name: primary.object_name ?? fallback.object_name,
    street: primary.street ?? fallback.street,
    postcode: primary.postcode ?? fallback.postcode,
    city: primary.city ?? fallback.city,
    region: primary.region ?? fallback.region,
    country: primary.country ?? fallback.country,
  };
}

/** Normalize a submitted JSON blob into AddressComponents, or null to clear. Throws on
 * non-object shapes (caller maps to validation_failed). */
export function normalizeAddressComponents(
  value: unknown,
): AddressComponents | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("address_components must be an object or null");
  }
  const raw = value as Record<string, unknown>;
  const read = (key: keyof AddressComponents): string | null => {
    const v = raw[key];
    if (v === null || v === undefined) return null;
    if (typeof v !== "string") {
      throw new TypeError(`address_components.${key} must be a string or null`);
    }
    return cleanComponent(v);
  };
  return {
    object_name: read("object_name"),
    street: read("street"),
    postcode: read("postcode"),
    city: read("city"),
    region: read("region"),
    country: read("country"),
  };
}

/** Parse a stored Prisma Json value back into AddressComponents (best-effort; corrupt rows
 * become null rather than breaking GET). */
export function parseStoredAddressComponents(value: unknown): AddressComponents | null {
  try {
    const normalized = normalizeAddressComponents(value);
    if (normalized === undefined || normalized === null) return null;
    return isAddressComponentsEmpty(normalized) ? null : normalized;
  } catch {
    return null;
  }
}

/** Attendee-facing directions address from persisted grid fields (+ optional long label fallback). */
export function formatDirectionsAddressFromComponents(
  components: AddressComponents | null | undefined,
  fallbackLabel?: string | null,
): string {
  if (!components || isAddressComponentsEmpty(components)) {
    const label = fallbackLabel?.trim();
    return label || "";
  }
  return formatDirectionsAddress({
    name: components.object_name,
    street: components.street,
    city: components.city,
    country: components.country,
    postcode: components.postcode,
    label: fallbackLabel,
  });
}
