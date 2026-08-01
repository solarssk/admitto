import { formatStreetLine, type CompactAddressParts } from "./formatAddress.js";

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

/** Normalize a submitted JSON blob into AddressComponents, or null to clear. Throws on
 * non-object shapes (caller maps to validation_failed). */
export function normalizeAddressComponents(
  value: unknown,
): AddressComponents | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("address_components must be an object or null");
  }
  const raw = value as Record<string, unknown>;
  const read = (key: keyof AddressComponents): string | null => {
    const v = raw[key];
    if (v === null || v === undefined) return null;
    if (typeof v !== "string") {
      throw new Error(`address_components.${key} must be a string or null`);
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
