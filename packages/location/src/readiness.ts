import type { EventLocationDto } from "./types.js";

type EnvLike = Record<string, string | undefined>;

/** True when there's enough data to render a map pin (both coordinates present). */
export function isMapReady(location: Pick<EventLocationDto, "latitude" | "longitude">): boolean {
  return location.latitude !== null && location.longitude !== null;
}

/**
 * Whether the deployment serves static map PNGs (`GET /m/{eventId}.png`) and shows the
 * Location-tab Leaflet map. Independent of geocoding search. Explicit `false` disables;
 * unset / any other value keeps maps on (self-host default).
 */
export function isLocationMapsEnabled(env: EnvLike = process.env): boolean {
  return env["LOCATION_MAPS_ENABLED"]?.trim().toLowerCase() !== "false";
}
