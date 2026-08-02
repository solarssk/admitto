// GPS-grade precision (~11cm) - enough for any venue, short enough to stay readable in a URL.
const COORDINATE_DECIMALS = 6;

function formatCoordinate(value: number): string {
  return value.toFixed(COORDINATE_DECIMALS);
}

/**
 * Google Maps deep link centered on a pin (no API key required).
 *
 * When `label` is set (venue name / address), the query is `Label@lat,lng` so Maps can show
 * a titled pin and often snap to a nearby POI. Coords alone never show a place name. True
 * Google Place matching still needs a `query_place_id` from the Places API — we do not have
 * that without a commercial Google integration.
 */
export function buildGoogleMapsUrl(
  latitude: number,
  longitude: number,
  label?: string | null,
): string {
  const coords = `${formatCoordinate(latitude)},${formatCoordinate(longitude)}`;
  const trimmedLabel = label?.trim();
  const query = trimmedLabel ? `${trimmedLabel}@${coords}` : coords;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** Apple Maps deep link; `label` (e.g. the venue name) is shown as the pin title when set. */
export function buildAppleMapsUrl(latitude: number, longitude: number, label?: string | null): string {
  const params = new URLSearchParams({ ll: `${formatCoordinate(latitude)},${formatCoordinate(longitude)}` });
  const trimmedLabel = label?.trim();
  if (trimmedLabel) params.set("q", trimmedLabel);
  return `https://maps.apple.com/?${params.toString()}`;
}

/** openstreetmap.org deep link centered and zoomed on a pin. */
export function buildOsmUrl(latitude: number, longitude: number, zoom: number): string {
  const lat = formatCoordinate(latitude);
  const lng = formatCoordinate(longitude);
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=${zoom}/${lat}/${lng}`;
}

/** Same-origin path for the public static map PNG (`GET /m/:eventId.png`).
 * `v` is a cache-busting query only — the route ignores it; bump when the compositor
 * output changes so ticket/mail clients don't keep a stale PNG for `max-age=86400`. */
export function buildEventStaticMapPath(eventId: string): string {
  return `/m/${encodeURIComponent(eventId)}.png?v=2`;
}

/** Absolute URL for `{{event_map_url}}` / ticket `<img src>` when an absolute base is required. */
export function buildEventStaticMapUrl(baseUrl: string, eventId: string): string {
  return `${baseUrl.replace(/\/$/, "")}${buildEventStaticMapPath(eventId)}`;
}
