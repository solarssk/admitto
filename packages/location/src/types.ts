import type { AddressComponents } from "./addressComponents.js";

/** Persisted/returned shape of an event's location (mirrors the `EventLocation` Prisma model,
 * minus `event_id`/timestamps which are DB-layer concerns, not domain concerns). */
export interface EventLocationDto {
  venue_name: string | null;
  formatted_address: string | null;
  latitude: number | null;
  longitude: number | null;
  map_zoom: number;
  directions_text: string | null;
  accessibility_text: string | null;
  geocoding_provider: string | null;
  geocoded_at: string | null;
  /** Structured grid fields from the last geocode/reverse; null when never set or cleared. */
  address_components: AddressComponents | null;
}

/** Fields an admin can submit via `PUT .../location`. All optional/nullable — omit a key to
 * leave it unchanged, send `null` (or an empty string for text fields) to clear it. */
export interface EventLocationInput {
  venue_name?: string | null;
  formatted_address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  map_zoom?: number | null;
  directions_text?: string | null;
  accessibility_text?: string | null;
  address_components?: AddressComponents | null;
}

/** One geocoding candidate returned by a provider search. `name` is the localized place/POI name
 * (e.g. "ICE Kraków Congress Centre") when the match is a named venue rather than a bare address —
 * absent for plain street-address matches. Powers venue-name search/autocomplete. */
export interface GeocodingResult {
  name?: string;
  formatted_address: string;
  latitude: number;
  longitude: number;
  provider: string;
  /** Structured parts for the Location tab address grid (when the provider returned them). */
  components?: AddressComponents;
}

/** Backend adapter contract for a geocoding provider (e.g. Nominatim). Implementations live in
 * `apps/web` — this package stays free of HTTP/fetch so it can be unit-tested in isolation. */
export interface GeocodingProvider {
  readonly name: string;
  search(query: string): Promise<GeocodingResult[]>;
  /** Resolve a single address for a map pin click/drag. Returns null when the coordinate has
   * no OSM coverage (Nominatim reverse returns an error / empty feature set). */
  reverse(latitude: number, longitude: number): Promise<GeocodingResult | null>;
}
