import type { EventLocationDto, SaveEventLocationBody } from "../api/types.js";

export interface LocationDraft {
  formatted_address: string;
  latitude: number | null;
  longitude: number | null;
  map_zoom: number;
  directions_text: string;
  accessibility_text: string;
}

export function draftFromLocation(data: EventLocationDto): LocationDraft {
  return {
    formatted_address: data.formatted_address ?? "",
    latitude: data.latitude,
    longitude: data.longitude,
    map_zoom: data.map_zoom,
    directions_text: data.directions_text ?? "",
    accessibility_text: data.accessibility_text ?? "",
  };
}

export function isLocationDirty(draft: LocationDraft, saved: LocationDraft): boolean {
  return (
    draft.formatted_address.trim() !== saved.formatted_address.trim() ||
    draft.latitude !== saved.latitude ||
    draft.longitude !== saved.longitude ||
    draft.map_zoom !== saved.map_zoom ||
    draft.directions_text.trim() !== saved.directions_text.trim() ||
    draft.accessibility_text.trim() !== saved.accessibility_text.trim()
  );
}

/**
 * Builds the partial PATCH body from the diff between `draft` and `saved`. `pendingGeocodingProvider`
 * is only turned into a `geocoding_provider` field when coordinates actually changed in this diff -
 * it must come from the caller (set only right after picking a search result, and cleared on any
 * manual pin move) so a manual drag/click omits it and lets the server clear stale provenance
 * instead of relabeling the new point as freshly geocoded.
 */
export function buildEventLocationPatchBody(
  draft: LocationDraft,
  saved: LocationDraft,
  pendingGeocodingProvider: string | null,
): SaveEventLocationBody {
  const body: SaveEventLocationBody = {};

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

  const coordinatesChanged = body.latitude !== undefined || body.longitude !== undefined;
  if (coordinatesChanged && pendingGeocodingProvider) {
    body.geocoding_provider = pendingGeocodingProvider;
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
