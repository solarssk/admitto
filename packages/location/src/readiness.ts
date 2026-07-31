import type { EventLocationDto } from "./types.js";

/** True when there's enough data to render a map pin (both coordinates present). */
export function isMapReady(location: Pick<EventLocationDto, "latitude" | "longitude">): boolean {
  return location.latitude !== null && location.longitude !== null;
}
