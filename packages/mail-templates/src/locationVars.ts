import {
  buildAppleMapsUrl,
  buildEventStaticMapUrl,
  buildGoogleMapsUrl,
  formatDirectionsAddressFromComponents,
  isLocationMapsEnabled,
  isMapReady,
  parseStoredAddressComponents,
} from "@admitto/location";
import type { TemplateVars } from "./types.js";

export type EventLocationForTemplateVars = {
  venue_name: string | null;
  formatted_address: string | null;
  address_components?: unknown;
  latitude: number | null;
  longitude: number | null;
  map_zoom?: number | null;
  directions_text: string | null;
  accessibility_text: string | null;
} | null;

/**
 * Location-related template placeholders shared by preview, test-send, and real sends
 * so `event_map_url` / Maps links cannot drift between call sites.
 *
 * Static map image URL is omitted when `LOCATION_MAPS_ENABLED=false` (PNG route 404s);
 * Google/Apple deep links still use coordinates when present.
 */
export function buildEventLocationTemplateVars(
  eventId: string,
  location: EventLocationForTemplateVars | undefined,
  baseUrl: string,
  env: Record<string, string | undefined> = process.env,
): Pick<
  TemplateVars,
  | "event_location"
  | "event_map_url"
  | "event_address"
  | "directions_text"
  | "accessibility_text"
  | "google_maps_url"
  | "apple_maps_url"
> {
  const mapCoordinates =
    location !== null && location !== undefined && isMapReady(location)
      ? {
          latitude: location.latitude!,
          longitude: location.longitude!,
          zoom: location.map_zoom ?? undefined,
        }
      : undefined;
  const mapLabel = location?.venue_name ?? location?.formatted_address;
  const staticMapsEnabled = isLocationMapsEnabled(env);

  return {
    event_location: location?.venue_name ?? "",
    event_map_url:
      mapCoordinates && staticMapsEnabled
        ? buildEventStaticMapUrl(baseUrl, eventId, mapCoordinates)
        : "",
    event_address:
      formatDirectionsAddressFromComponents(
        parseStoredAddressComponents(location?.address_components),
        location?.formatted_address,
      ) ||
      location?.formatted_address ||
      "",
    directions_text: location?.directions_text ?? "",
    accessibility_text: location?.accessibility_text ?? "",
    google_maps_url: mapCoordinates
      ? buildGoogleMapsUrl(mapCoordinates.latitude, mapCoordinates.longitude, mapLabel)
      : "",
    apple_maps_url: mapCoordinates
      ? buildAppleMapsUrl(mapCoordinates.latitude, mapCoordinates.longitude, mapLabel)
      : "",
  };
}
