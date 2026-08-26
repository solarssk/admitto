import {
  normalizeAddressComponents,
  type AddressComponents,
} from "./addressComponents.js";
import { isAllowedMapsUrl } from "./mapsUrlOverride.js";
import type { EventLocationInput } from "./types.js";

export const LOCATION_LIMITS = {
  VENUE_NAME_MAX_LENGTH: 300,
  ADDRESS_MAX_LENGTH: 500,
  TEXT_MAX_LENGTH: 2000,
  /** Venue identifier fields (room, entrance, phone, place ID) - same cap as VENUE_NAME_MAX_LENGTH. */
  SHORT_TEXT_MAX_LENGTH: 300,
  /** Same cap as other long Location text fields (directions / accessibility). */
  MAPS_URL_OVERRIDE_MAX_LENGTH: 2000,
  LATITUDE_MIN: -90,
  LATITUDE_MAX: 90,
  LONGITUDE_MIN: -180,
  LONGITUDE_MAX: 180,
  ZOOM_MIN: 1,
  ZOOM_MAX: 19,
  DEFAULT_ZOOM: 15,
} as const;

export class LocationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocationValidationError";
  }
}

/** Trims a text field; empty (after trim) normalizes to `null` (clears the field). `undefined`
 * passes through unchanged (field omitted - "leave as is"). */
function normalizeText(
  value: string | null | undefined,
  maxLength: number,
  fieldName: string,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > maxLength) {
    throw new LocationValidationError(`${fieldName} must be at most ${maxLength} characters`);
  }
  return trimmed;
}

/** Trims/validates a display-only "HH:MM" 24h wall-clock time field. Same shape as
 * apps/web/src/admin/admin-helpers.ts's `eventHoursField` Zod regex, applied here at the domain
 * layer for EventLocation's 7 access-point timing fields. */
function normalizeTimeField(
  value: string | null | undefined,
  fieldName: string,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(trimmed)) {
    throw new LocationValidationError(`${fieldName} must be a 24h HH:MM time`);
  }
  return trimmed;
}

function normalizeCoordinate(
  value: number | null | undefined,
  min: number,
  max: number,
  fieldName: string,
): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!Number.isFinite(value)) {
    throw new LocationValidationError(`${fieldName} must be a finite number`);
  }
  if (value < min || value > max) {
    throw new LocationValidationError(`${fieldName} must be between ${min} and ${max}`);
  }
  return value;
}

/** Same fields as `EventLocationInput`, except `map_zoom`: normalization always resolves it to a
 * concrete number (or leaves it omitted), never `null` - the column always has a value, so `null`
 * (submitted to reset it) is normalized to the default zoom before this type is ever built. */
export type NormalizedEventLocationInput = Omit<EventLocationInput, "map_zoom"> & {
  map_zoom?: number;
};

function normalizeMapZoom(value: number | null | undefined): number | undefined {
  if (value === undefined) return undefined;
  // `null` resets zoom to the default rather than storing NULL - the column always has a value.
  if (value === null) return LOCATION_LIMITS.DEFAULT_ZOOM;
  if (
    !Number.isInteger(value) ||
    value < LOCATION_LIMITS.ZOOM_MIN ||
    value > LOCATION_LIMITS.ZOOM_MAX
  ) {
    throw new LocationValidationError(
      `map_zoom must be an integer between ${LOCATION_LIMITS.ZOOM_MIN} and ${LOCATION_LIMITS.ZOOM_MAX}`,
    );
  }
  return value;
}

function normalizeAddressComponentsField(
  value: EventLocationInput["address_components"],
): AddressComponents | null | undefined {
  if (value === undefined) return undefined;
  try {
    return normalizeAddressComponents(value) ?? null;
  } catch (err) {
    throw new LocationValidationError(
      err instanceof Error ? err.message : "address_components is invalid",
    );
  }
}

/**
 * Trims / clears a Maps URL override. Empty → null. When set: https only + allowlisted host.
 * `undefined` means omit (leave unchanged).
 */
export function normalizeMapsUrlOverride(
  value: string | null | undefined,
  kind: "google" | "apple",
  fieldName: string,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > LOCATION_LIMITS.MAPS_URL_OVERRIDE_MAX_LENGTH) {
    throw new LocationValidationError(
      `${fieldName} must be at most ${LOCATION_LIMITS.MAPS_URL_OVERRIDE_MAX_LENGTH} characters`,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new LocationValidationError(`${fieldName} must be a valid URL`);
  }
  if (parsed.protocol !== "https:") {
    throw new LocationValidationError(`${fieldName} must use https`);
  }
  if (!isAllowedMapsUrl(parsed, kind)) {
    const expected =
      kind === "google"
        ? "https://www.google.com/maps/..., maps.google.com, or maps.app.goo.gl"
        : "maps.apple.com (or an Apple Maps short link)";
    throw new LocationValidationError(
      `${fieldName} must be a ${kind === "google" ? "Google" : "Apple"} Maps link (${expected})`,
    );
  }
  return trimmed;
}

/** Trims/validates a submitted patch. Keys omitted from `input` stay omitted (meaning "leave
 * unchanged" to the caller); explicit `null`/`""` means "clear". Throws `LocationValidationError`
 * on the first invalid field.
 *
 * Does NOT know about an existing record - the "both coordinates or neither" rule is enforced by
 * `assertCoordinatePairing` against the *merged* result, since a caller may legitimately patch
 * just one axis when the other is already set on the stored record. */
function assignIfDefined<K extends keyof NormalizedEventLocationInput>(
  result: NormalizedEventLocationInput,
  key: K,
  value: NormalizedEventLocationInput[K] | undefined,
): void {
  if (value !== undefined) result[key] = value;
}

/** The 7 venue-identifier fields, extracted out of normalizeEventLocationInput to keep its own
 * cognitive complexity under the SonarCloud threshold (S3776) - each is normalized and assigned
 * the same way as every other short text field on this form. */
function normalizeVenueIdentifierFields(
  input: EventLocationInput,
  result: NormalizedEventLocationInput,
): void {
  assignIfDefined(
    result,
    "venue_room",
    normalizeText(input.venue_room, LOCATION_LIMITS.SHORT_TEXT_MAX_LENGTH, "venue_room"),
  );
  assignIfDefined(
    result,
    "venue_entrance",
    normalizeText(input.venue_entrance, LOCATION_LIMITS.SHORT_TEXT_MAX_LENGTH, "venue_entrance"),
  );
  assignIfDefined(
    result,
    "venue_entrance_door",
    normalizeText(input.venue_entrance_door, LOCATION_LIMITS.SHORT_TEXT_MAX_LENGTH, "venue_entrance_door"),
  );
  assignIfDefined(
    result,
    "venue_entrance_gate",
    normalizeText(input.venue_entrance_gate, LOCATION_LIMITS.SHORT_TEXT_MAX_LENGTH, "venue_entrance_gate"),
  );
  assignIfDefined(
    result,
    "venue_entrance_portal",
    normalizeText(input.venue_entrance_portal, LOCATION_LIMITS.SHORT_TEXT_MAX_LENGTH, "venue_entrance_portal"),
  );
  assignIfDefined(
    result,
    "venue_phone_number",
    normalizeText(input.venue_phone_number, LOCATION_LIMITS.SHORT_TEXT_MAX_LENGTH, "venue_phone_number"),
  );
  assignIfDefined(
    result,
    "venue_place_id",
    normalizeText(input.venue_place_id, LOCATION_LIMITS.SHORT_TEXT_MAX_LENGTH, "venue_place_id"),
  );
}

/** The 7 access-point opening-time fields, extracted for the same reason as
 * normalizeVenueIdentifierFields above. */
function normalizeAccessPointTimingFields(
  input: EventLocationInput,
  result: NormalizedEventLocationInput,
): void {
  assignIfDefined(result, "venue_open_time", normalizeTimeField(input.venue_open_time, "venue_open_time"));
  assignIfDefined(result, "venue_close_time", normalizeTimeField(input.venue_close_time, "venue_close_time"));
  assignIfDefined(result, "doors_open_time", normalizeTimeField(input.doors_open_time, "doors_open_time"));
  assignIfDefined(result, "gates_open_time", normalizeTimeField(input.gates_open_time, "gates_open_time"));
  assignIfDefined(
    result,
    "box_office_open_time",
    normalizeTimeField(input.box_office_open_time, "box_office_open_time"),
  );
  assignIfDefined(
    result,
    "parking_lots_open_time",
    normalizeTimeField(input.parking_lots_open_time, "parking_lots_open_time"),
  );
  assignIfDefined(
    result,
    "fan_zone_open_time",
    normalizeTimeField(input.fan_zone_open_time, "fan_zone_open_time"),
  );
}

export function normalizeEventLocationInput(input: EventLocationInput): NormalizedEventLocationInput {
  const result: NormalizedEventLocationInput = {};
  normalizeVenueIdentifierFields(input, result);
  normalizeAccessPointTimingFields(input, result);

  const venueName = normalizeText(input.venue_name, LOCATION_LIMITS.VENUE_NAME_MAX_LENGTH, "venue_name");
  if (venueName !== undefined) result.venue_name = venueName;

  const address = normalizeText(input.formatted_address, LOCATION_LIMITS.ADDRESS_MAX_LENGTH, "formatted_address");
  if (address !== undefined) result.formatted_address = address;

  const directions = normalizeText(input.directions_text, LOCATION_LIMITS.TEXT_MAX_LENGTH, "directions_text");
  if (directions !== undefined) result.directions_text = directions;

  const accessibility = normalizeText(
    input.accessibility_text,
    LOCATION_LIMITS.TEXT_MAX_LENGTH,
    "accessibility_text",
  );
  if (accessibility !== undefined) result.accessibility_text = accessibility;

  const latitude = normalizeCoordinate(
    input.latitude,
    LOCATION_LIMITS.LATITUDE_MIN,
    LOCATION_LIMITS.LATITUDE_MAX,
    "latitude",
  );
  if (latitude !== undefined) result.latitude = latitude;

  const longitude = normalizeCoordinate(
    input.longitude,
    LOCATION_LIMITS.LONGITUDE_MIN,
    LOCATION_LIMITS.LONGITUDE_MAX,
    "longitude",
  );
  if (longitude !== undefined) result.longitude = longitude;

  const mapZoom = normalizeMapZoom(input.map_zoom);
  if (mapZoom !== undefined) result.map_zoom = mapZoom;

  const components = normalizeAddressComponentsField(input.address_components);
  if (components !== undefined) result.address_components = components;

  const googleOverride = normalizeMapsUrlOverride(
    input.google_maps_url_override,
    "google",
    "google_maps_url_override",
  );
  if (googleOverride !== undefined) result.google_maps_url_override = googleOverride;

  const appleOverride = normalizeMapsUrlOverride(
    input.apple_maps_url_override,
    "apple",
    "apple_maps_url_override",
  );
  if (appleOverride !== undefined) result.apple_maps_url_override = appleOverride;

  return result;
}

/** Enforces "both coordinates set or neither" against the *merged* (existing + patch) state.
 * Call after merging a normalized patch onto the current record, before persisting. */
export function assertCoordinatePairing(latitude: number | null, longitude: number | null): void {
  if ((latitude === null) !== (longitude === null)) {
    throw new LocationValidationError("latitude and longitude must both be set, or both be null");
  }
}
