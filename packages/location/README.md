# @admitto/location

Domain types, validation, and map-link builders for an event's location (address, coordinates,
directions/accessibility notes). Pure logic - no HTTP, no Prisma - so it can be unit-tested in
isolation and reused by both the admin API and (later) the public ticket/event-list surfaces.

## What lives here

- `types.ts` — `EventLocationDto` (persisted shape), `EventLocationInput` (PUT body shape),
  `GeocodingResult` / `GeocodingProvider` (adapter contract implemented in `apps/web`).
- `validation.ts` — `normalizeEventLocationInput()` trims text, normalizes empty strings to
  `null`, and validates ranges (`LOCATION_LIMITS`: lat -90..90, lng -180..180, zoom 1..19, address
  ≤500 chars, directions/accessibility text ≤2000 chars each). Throws `LocationValidationError`
  with a human-readable message on the first invalid field. `assertCoordinatePairing()` enforces
  "both coordinates set, or neither" against the *merged* (existing + patch) record.
- `readiness.ts` — `isMapReady()`: true once both coordinates are present.
- `links.ts` — `buildGoogleMapsUrl()` / `buildAppleMapsUrl()` / `buildOsmUrl()`: deep links for
  the three map providers, no API keys required.

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
