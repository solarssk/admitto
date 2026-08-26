import {
  EMPTY_ADDRESS_COMPONENTS,
  isAddressComponentsEmpty,
  type AddressComponents,
} from "@admitto/location";
import type { EventLocationDto, SaveEventLocationBody } from "../api/types.js";

export interface LocationDraft {
  venue_name: string;
  formatted_address: string;
  latitude: number | null;
  longitude: number | null;
  map_zoom: number;
  directions_text: string;
  accessibility_text: string;
  address_components: AddressComponents;
  google_maps_url_override: string;
  apple_maps_url_override: string;
  venue_room: string;
  venue_entrance: string;
  venue_entrance_door: string;
  venue_entrance_gate: string;
  venue_entrance_portal: string;
  venue_phone_number: string;
  venue_place_id: string;
  venue_open_time: string;
  venue_close_time: string;
  doors_open_time: string;
  gates_open_time: string;
  box_office_open_time: string;
  parking_lots_open_time: string;
  fan_zone_open_time: string;
}

function componentsEqual(a: AddressComponents, b: AddressComponents): boolean {
  return (
    (a.object_name ?? null) === (b.object_name ?? null) &&
    (a.street ?? null) === (b.street ?? null) &&
    (a.postcode ?? null) === (b.postcode ?? null) &&
    (a.city ?? null) === (b.city ?? null) &&
    (a.region ?? null) === (b.region ?? null) &&
    (a.country ?? null) === (b.country ?? null)
  );
}

export function draftFromLocation(data: EventLocationDto): LocationDraft {
  return {
    venue_name: data.venue_name ?? "",
    formatted_address: data.formatted_address ?? "",
    latitude: data.latitude,
    longitude: data.longitude,
    map_zoom: data.map_zoom,
    directions_text: data.directions_text ?? "",
    accessibility_text: data.accessibility_text ?? "",
    address_components: data.address_components ?? { ...EMPTY_ADDRESS_COMPONENTS },
    google_maps_url_override: data.google_maps_url_override ?? "",
    apple_maps_url_override: data.apple_maps_url_override ?? "",
    venue_room: data.venue_room ?? "",
    venue_entrance: data.venue_entrance ?? "",
    venue_entrance_door: data.venue_entrance_door ?? "",
    venue_entrance_gate: data.venue_entrance_gate ?? "",
    venue_entrance_portal: data.venue_entrance_portal ?? "",
    venue_phone_number: data.venue_phone_number ?? "",
    venue_place_id: data.venue_place_id ?? "",
    venue_open_time: data.venue_open_time ?? "",
    venue_close_time: data.venue_close_time ?? "",
    doors_open_time: data.doors_open_time ?? "",
    gates_open_time: data.gates_open_time ?? "",
    box_office_open_time: data.box_office_open_time ?? "",
    parking_lots_open_time: data.parking_lots_open_time ?? "",
    fan_zone_open_time: data.fan_zone_open_time ?? "",
  };
}

export function isLocationDirty(draft: LocationDraft, saved: LocationDraft): boolean {
  return (
    draft.venue_name.trim() !== saved.venue_name.trim() ||
    draft.formatted_address.trim() !== saved.formatted_address.trim() ||
    draft.latitude !== saved.latitude ||
    draft.longitude !== saved.longitude ||
    draft.map_zoom !== saved.map_zoom ||
    draft.directions_text.trim() !== saved.directions_text.trim() ||
    draft.accessibility_text.trim() !== saved.accessibility_text.trim() ||
    !componentsEqual(draft.address_components, saved.address_components) ||
    draft.google_maps_url_override.trim() !== saved.google_maps_url_override.trim() ||
    draft.apple_maps_url_override.trim() !== saved.apple_maps_url_override.trim() ||
    draft.venue_room.trim() !== saved.venue_room.trim() ||
    draft.venue_entrance.trim() !== saved.venue_entrance.trim() ||
    draft.venue_entrance_door.trim() !== saved.venue_entrance_door.trim() ||
    draft.venue_entrance_gate.trim() !== saved.venue_entrance_gate.trim() ||
    draft.venue_entrance_portal.trim() !== saved.venue_entrance_portal.trim() ||
    draft.venue_phone_number.trim() !== saved.venue_phone_number.trim() ||
    draft.venue_place_id.trim() !== saved.venue_place_id.trim() ||
    draft.venue_open_time.trim() !== saved.venue_open_time.trim() ||
    draft.venue_close_time.trim() !== saved.venue_close_time.trim() ||
    draft.doors_open_time.trim() !== saved.doors_open_time.trim() ||
    draft.gates_open_time.trim() !== saved.gates_open_time.trim() ||
    draft.box_office_open_time.trim() !== saved.box_office_open_time.trim() ||
    draft.parking_lots_open_time.trim() !== saved.parking_lots_open_time.trim() ||
    draft.fan_zone_open_time.trim() !== saved.fan_zone_open_time.trim()
  );
}

/** Trim-and-diff a single optional text field: unchanged (after trim) is omitted, cleared (empty
 * after trim) becomes `null`. Shared by every plain string field in `SaveEventLocationBody` -
 * extracted so `buildEventLocationPatchBody` doesn't repeat this same three-line shape per field
 * (SonarCloud S3776 cognitive-complexity budget). */
function diffTextField(
  patch: Record<string, string | null>,
  key: string,
  draftValue: string,
  savedValue: string,
): void {
  const trimmed = draftValue.trim();
  if (trimmed !== savedValue.trim()) {
    patch[key] = trimmed || null;
  }
}

const VENUE_IDENTIFIER_FIELDS = [
  "venue_room",
  "venue_entrance",
  "venue_entrance_door",
  "venue_entrance_gate",
  "venue_entrance_portal",
  "venue_phone_number",
  "venue_place_id",
] as const;

const ACCESS_POINT_TIMING_FIELDS = [
  "venue_open_time",
  "venue_close_time",
  "doors_open_time",
  "gates_open_time",
  "box_office_open_time",
  "parking_lots_open_time",
  "fan_zone_open_time",
] as const;

/** Extracted out of buildEventLocationPatchBody (SonarCloud S3776) - the 7 venue-identifier and 7
 * access-point-timing fields are both flat lists of same-shaped optional text fields, diffed the
 * same way as every other field on this form. */
function diffFieldList(
  fields: readonly string[],
  draft: LocationDraft,
  saved: LocationDraft,
): Partial<SaveEventLocationBody> {
  const patch: Record<string, string | null> = {};
  for (const field of fields) {
    diffTextField(patch, field, draft[field as keyof LocationDraft] as string, saved[field as keyof LocationDraft] as string);
  }
  return patch;
}

/**
 * Builds the partial PATCH body from the diff between `draft` and `saved`.
 *
 * `pendingGeocodingProvider` comes from the caller only right after a search pick or a successful
 * reverse geocode (cleared on free-text venue rename, clear-map, and before a manual pin move).
 * When set, it is always stamped onto the body for this save — including re-selecting the same
 * coordinates — so "From OpenStreetMap" persists after reload. A bare coordinate change
 * with no pending provider omits the field and lets the server clear stale provenance.
 *
 * A venue-name-only edit (free-text rename while keeping the pin, no pending provider) sends
 * `geocoding_provider: null` so the Verified badge does not return after save from a stale
 * server provider.
 */
export function buildEventLocationPatchBody(
  draft: LocationDraft,
  saved: LocationDraft,
  pendingGeocodingProvider: string | null,
): SaveEventLocationBody {
  const body: SaveEventLocationBody = {
    ...diffFieldList(VENUE_IDENTIFIER_FIELDS, draft, saved),
    ...diffFieldList(ACCESS_POINT_TIMING_FIELDS, draft, saved),
  };

  const venueName = draft.venue_name.trim();
  if (venueName !== saved.venue_name.trim()) {
    body.venue_name = venueName || null;
  }

  const address = draft.formatted_address.trim();
  if (address !== saved.formatted_address.trim()) {
    body.formatted_address = address || null;
  }
  if (draft.latitude !== saved.latitude) body.latitude = draft.latitude;
  if (draft.longitude !== saved.longitude) body.longitude = draft.longitude;
  if (draft.map_zoom !== saved.map_zoom) body.map_zoom = draft.map_zoom;

  const directions = draft.directions_text.trim();
  if (directions !== saved.directions_text.trim()) {
    body.directions_text = directions || null;
  }
  const accessibility = draft.accessibility_text.trim();
  if (accessibility !== saved.accessibility_text.trim()) {
    body.accessibility_text = accessibility || null;
  }

  if (!componentsEqual(draft.address_components, saved.address_components)) {
    body.address_components = isAddressComponentsEmpty(draft.address_components)
      ? null
      : draft.address_components;
  }

  const googleOverride = draft.google_maps_url_override.trim();
  if (googleOverride !== saved.google_maps_url_override.trim()) {
    body.google_maps_url_override = googleOverride || null;
  }
  const appleOverride = draft.apple_maps_url_override.trim();
  if (appleOverride !== saved.apple_maps_url_override.trim()) {
    body.apple_maps_url_override = appleOverride || null;
  }

  const coordinatesChanged = body.latitude !== undefined || body.longitude !== undefined;
  if (pendingGeocodingProvider) {
    body.geocoding_provider = pendingGeocodingProvider;
  } else if (body.venue_name !== undefined && !coordinatesChanged) {
    body.geocoding_provider = null;
  }

  return body;
}

const PROVIDER_LABELS: Record<string, string> = {
  nominatim: "Nominatim",
};

/** Human-readable label for a `geocoding_provider` machine code (e.g. "nominatim" -> "Nominatim"). */
export function geocodingProviderLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1);
}
