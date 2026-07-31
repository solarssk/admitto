// GPS-grade precision (~11cm) - enough for any venue, short enough to stay readable in a URL.
const COORDINATE_DECIMALS = 6;

function formatCoordinate(value: number): string {
  return value.toFixed(COORDINATE_DECIMALS);
}

/** Google Maps deep link centered on a pin (no API key required, works on mobile + desktop). */
export function buildGoogleMapsUrl(latitude: number, longitude: number): string {
  const query = `${formatCoordinate(latitude)},${formatCoordinate(longitude)}`;
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
