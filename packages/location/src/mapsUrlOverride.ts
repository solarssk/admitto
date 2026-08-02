/** Hosts allowed for a manually pasted Google Maps deep link. */
export const GOOGLE_MAPS_URL_HOSTS = new Set([
  "www.google.com",
  "maps.google.com",
  "maps.app.goo.gl",
]);

/** Hosts allowed for a manually pasted Apple Maps deep link. */
export const APPLE_MAPS_URL_HOSTS = new Set(["maps.apple.com"]);

/** True when `hostname` (already lowercased) is an exact allowlisted Maps host. */
export function isAllowedMapsUrlHost(hostname: string, kind: "google" | "apple"): boolean {
  return (kind === "google" ? GOOGLE_MAPS_URL_HOSTS : APPLE_MAPS_URL_HOSTS).has(hostname);
}
