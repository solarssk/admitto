/** Hosts allowed for a manually pasted Google Maps deep link. */
export const GOOGLE_MAPS_URL_HOSTS = new Set([
  "www.google.com",
  "maps.google.com",
  "maps.app.goo.gl",
]);

/** Primary Apple Maps web host (share / deep links). */
export const APPLE_MAPS_URL_HOSTS = new Set(["maps.apple.com"]);

/**
 * True when `hostname` (already lowercased) is an allowlisted Maps host for `kind`.
 * Prefer {@link isAllowedMapsUrl} for paste validation — `www.google.com` also needs a `/maps` path.
 */
export function isAllowedMapsUrlHost(hostname: string, kind: "google" | "apple"): boolean {
  if (kind === "google") return GOOGLE_MAPS_URL_HOSTS.has(hostname);
  // maps.apple.com, plus Apple short-share hosts that end in `maps.apple` (no .com) per
  // https://developer.apple.com/documentation/mapkit/unified-map-urls
  return (
    APPLE_MAPS_URL_HOSTS.has(hostname) ||
    hostname === "maps.apple" ||
    hostname.endsWith(".maps.apple")
  );
}

/**
 * True when the parsed https URL is an acceptable Google or Apple Maps deep link.
 *
 * Google (official Maps URLs / share formats):
 * - `www.google.com` only with pathname `/maps` or `/maps/...` (rejects `/search`, etc.)
 * - `maps.google.com` (Maps host; any path)
 * - `maps.app.goo.gl` (mobile/app share short links)
 *
 * Apple:
 * - `maps.apple.com` (web / unified Maps URLs)
 * - hosts ending in `maps.apple` (Apple shortened share links)
 */
export function isAllowedMapsUrl(url: URL, kind: "google" | "apple"): boolean {
  const hostname = url.hostname.toLowerCase();
  if (!isAllowedMapsUrlHost(hostname, kind)) return false;
  if (kind === "apple") return true;
  if (hostname === "www.google.com") {
    const path = url.pathname;
    return path === "/maps" || path.startsWith("/maps/");
  }
  return true;
}
