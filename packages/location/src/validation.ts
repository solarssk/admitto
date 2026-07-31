import type { EventLocationInput } from "./types.js";

export const LOCATION_LIMITS = {
  ADDRESS_MAX_LENGTH: 500,
  TEXT_MAX_LENGTH: 2000,
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

export interface NormalizedEventLocationInput {
  formatted_address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  map_zoom?: number;
  directions_text?: string | null;
  accessibility_text?: string | null;
}

/** Trims/validates a submitted patch. Keys omitted from `input` stay omitted (meaning "leave
 * unchanged" to the caller); explicit `null`/`""` means "clear". Throws `LocationValidationError`
 * on the first invalid field.
 *
 * Does NOT know about an existing record - the "both coordinates or neither" rule is enforced by
 * `assertCoordinatePairing` against the *merged* result, since a caller may legitimately patch
 * just one axis when the other is already set on the stored record. */
export function normalizeEventLocationInput(input: EventLocationInput): NormalizedEventLocationInput {
  const result: NormalizedEventLocationInput = {};

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

  if (input.map_zoom !== undefined) {
    // `null` resets zoom to the default rather than storing NULL - the column always has a value.
    if (input.map_zoom === null) {
      result.map_zoom = LOCATION_LIMITS.DEFAULT_ZOOM;
    } else {
      if (
        !Number.isInteger(input.map_zoom) ||
        input.map_zoom < LOCATION_LIMITS.ZOOM_MIN ||
        input.map_zoom > LOCATION_LIMITS.ZOOM_MAX
      ) {
        throw new LocationValidationError(
          `map_zoom must be an integer between ${LOCATION_LIMITS.ZOOM_MIN} and ${LOCATION_LIMITS.ZOOM_MAX}`,
        );
      }
      result.map_zoom = input.map_zoom;
    }
  }

  return result;
}

/** Enforces "both coordinates set or neither" against the *merged* (existing + patch) state.
 * Call after merging a normalized patch onto the current record, before persisting. */
export function assertCoordinatePairing(latitude: number | null, longitude: number | null): void {
  if ((latitude === null) !== (longitude === null)) {
    throw new LocationValidationError("latitude and longitude must both be set, or both be null");
  }
}
