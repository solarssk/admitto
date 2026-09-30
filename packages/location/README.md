# @admitto/location

Domain types, validation, and map-link builders for an event's venue (address, coordinates,
directions/accessibility notes). Pure logic - no HTTP, no Prisma (the only environment read is
`LOCATION_MAPS_ENABLED`, in `isLocationMapsEnabled`) - so it can be unit-tested in
isolation and reused by the admin API and the public ticket / event-list surfaces.

**HTTP geocoding, Nominatim, static map tiles, and timezone lookup live in `apps/web`**, not here.
This package only owns the shared shapes and validators those routes and the SPA agree on.

## What lives here

- `types.ts` - `EventLocationDto` (persisted shape), `EventLocationInput` (PUT body shape),
  `GeocodingResult` / `GeocodingProvider` (adapter contract implemented in `apps/web`).
- `validation.ts` - `normalizeEventLocationInput()` trims text, normalizes empty strings to
  `null`, and validates ranges (`LOCATION_LIMITS`: lat -90..90, lng -180..180, integer zoom 1..19
  where `null` resets to the default 15, venue name and venue identifier fields ≤300 chars, address
  ≤500, directions / accessibility text and Maps URL overrides ≤2000 each; access-point times must be
  24h `HH:MM`). Throws `LocationValidationError` with a human-readable message on the first invalid
  field. `normalizeMapsUrlOverride()` accepts https links to the allow-listed Google / Apple hosts only.
  `assertCoordinatePairing()` enforces "both coordinates set, or neither" against the *merged*
  (existing + patch) record.
- `readiness.ts` - `isMapReady()`: true once both coordinates are present; `isLocationMapsEnabled(env)`
  is false only when `LOCATION_MAPS_ENABLED=false` (it gates the static map PNG route and the
  Location-tab map, independent of geocoding).
- `links.ts` - `buildGoogleMapsUrl()` / `buildAppleMapsUrl()` / `buildOsmUrl()`: deep links for
  the three map providers, no API keys required. Google/Apple accept an optional venue label;
  Google uses `Label@lat,lng` so the pin is titled (true Place ID matching needs Google Places).
  `resolveGoogleMapsUrl()` / `resolveAppleMapsUrl()` prefer a saved override and otherwise build from
  the coordinates; `buildEventStaticMapPath()` / `buildEventStaticMapUrl()` build the public
  `/m/{eventId}.png` static map URL (the query string only busts caches).
- `mapsUrlOverride.ts` - the allow-listed hosts (`GOOGLE_MAPS_URL_HOSTS`, `APPLE_MAPS_URL_HOSTS`) and
  `isAllowedMapsUrl()`.
- `addressComponents.ts` / `formatAddress.ts` - the structured address grid (`AddressComponents`) with
  normalize / merge / parse helpers, and the compact, street-line, venue-name and directions address
  formatters.

## Usage

```ts
import { normalizeEventLocationInput, assertCoordinatePairing, isMapReady } from "@admitto/location";

const patch = normalizeEventLocationInput(requestBody);
const merged = { ...existing, ...patch };
assertCoordinatePairing(merged.latitude, merged.longitude);
if (isMapReady(merged)) {
  /* render map */
}
```

## Tests

```bash
npm test -w @admitto/location
```
