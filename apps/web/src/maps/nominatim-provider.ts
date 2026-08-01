/**
 * Nominatim `/search` + `/reverse` adapter (`implements GeocodingProvider` from `@admitto/location`).
 * No SSRF DNS-pinning here (contrast `packages/auth/src/oidc/safe-oidc-fetch.ts` and
 * `packages/mailer/src/adapters/powerAutomate.ts`): those guard admin-controlled URLs
 * entered per-organization through the UI. `GEOCODING_BASE_URL` is deployment-level env
 * config set only by the operator self-hosting the instance, same trust level as
 * BASE_URL/DATABASE_URL/REDIS_URL, none of which get SSRF protection either.
 */
import {
  addressComponentsFromNominatimLabel,
  addressComponentsFromParts,
  formatCompactAddress,
  formatVenueName,
  isAddressComponentsSparse,
  mergeAddressComponents,
  type GeocodingProvider,
  type GeocodingResult,
} from "@admitto/location";

/** Distinguishes a timed-out request (503, "try again shortly") from any other failure —
 * bad status, network error, malformed body — mapped to 502 by the route handler. */
export class GeocodingProviderError extends Error {
  readonly kind: "timeout" | "unavailable";

  constructor(kind: "timeout" | "unavailable", options?: ErrorOptions) {
    super(`geocoding provider error: ${kind}`, options);
    this.name = "GeocodingProviderError";
    this.kind = kind;
  }
}

export interface NominatimProviderOptions {
  baseUrl: string;
  timeoutMs: number;
  /** Resolved per-call (not cached in the constructor) so a Support contact change in
   * Instance Settings takes effect on the next search without a server restart. */
  buildUserAgent: () => Promise<string>;
  /** Test-only injection point (see `packages/mailer/src/adapters/powerAutomate.ts` for the
   * same `fetchFn` DI pattern) — avoids stubbing the global `fetch`. */
  fetchFn?: typeof fetch;
}

const MAX_RESULTS = 5;
/** Safety cap on the response body; Nominatim replies are small, a much larger one signals
 * something is wrong (misconfigured baseUrl, proxy serving unrelated content, etc). */
const MAX_RESPONSE_BYTES = 1_000_000;
/** Building-level reverse detail — Nominatim's zoom table maps 18 → building
 * (https://nominatim.org/release-docs/latest/api/Reverse/). */
const REVERSE_ZOOM = 18;

function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && err.name === "TimeoutError";
}

/** One raw GeocodeJSON feature — only the fields this adapter reads. Nesting is
 * `properties.geocoding.*` (not directly under `properties` as in plain GeoJSON) per the
 * GeocodeJSON spec (https://github.com/geocoders/geocodejson-spec). With `addressdetails=1`
 * the structured fields (`housenumber`, `street`, `city`, `country`, `name`, `postcode`,
 * `state`) are stable — prefer those over the raw `label` hierarchy for UI display. */
interface RawGeocodeJsonFeature {
  properties?: {
    geocoding?: {
      name?: unknown;
      label?: unknown;
      housenumber?: unknown;
      street?: unknown;
      city?: unknown;
      /** GeocodeJSON often puts the settlement here when `city` is absent. */
      locality?: unknown;
      town?: unknown;
      village?: unknown;
      country?: unknown;
      postcode?: unknown;
      state?: unknown;
      county?: unknown;
      district?: unknown;
    };
  };
  geometry?: {
    // GeoJSON order: [longitude, latitude].
    coordinates?: unknown;
    type?: unknown;
  };
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function firstOptionalString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const parsed = asOptionalString(value);
    if (parsed) return parsed;
  }
  return undefined;
}

function parseFeature(raw: unknown, provider: string): GeocodingResult | null {
  if (typeof raw !== "object" || raw === null) return null;
  const feature = raw as RawGeocodeJsonFeature;
  const geocoding = feature.properties?.geocoding;
  const label = asOptionalString(geocoding?.label) ?? null;
  const parts = {
    name: asOptionalString(geocoding?.name) ?? null,
    housenumber: asOptionalString(geocoding?.housenumber) ?? null,
    street: asOptionalString(geocoding?.street) ?? null,
    city:
      firstOptionalString(geocoding?.city, geocoding?.locality, geocoding?.town, geocoding?.village) ??
      null,
    country: asOptionalString(geocoding?.country) ?? null,
    postcode: asOptionalString(geocoding?.postcode) ?? null,
    state:
      firstOptionalString(geocoding?.state, geocoding?.county, geocoding?.district) ?? null,
    label,
  };

  const coordinates = feature.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const [longitude, latitude] = coordinates as [unknown, unknown];
  if (typeof longitude !== "number" || typeof latitude !== "number") return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const formatted_address = formatCompactAddress(parts);
  if (!formatted_address) return null;

  // Venue field: POI name, else street+number. Omit when that would just duplicate the
  // compact address (e.g. city-only matches) so callers fall back to formatted_address.
  const streetLine = formatVenueName({ ...parts, name: null });
  const finalName =
    parts.name ?? (streetLine && streetLine !== formatted_address ? streetLine : undefined);

  const componentsFromParts = addressComponentsFromParts(parts);
  const components =
    isAddressComponentsSparse(componentsFromParts) && label
      ? mergeAddressComponents(
          componentsFromParts,
          addressComponentsFromNominatimLabel(label, parts.name),
        )
      : componentsFromParts;

  return {
    ...(finalName ? { name: finalName } : {}),
    formatted_address,
    latitude,
    longitude,
    provider,
    components,
  };
}

async function fetchJson(
  fetchImpl: typeof fetch,
  url: URL,
  userAgent: string,
  timeoutMs: number,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: { "User-Agent": userAgent, Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new GeocodingProviderError(isTimeoutError(err) ? "timeout" : "unavailable", {
      cause: err,
    });
  }

  if (!res.ok) {
    throw new GeocodingProviderError("unavailable");
  }

  const contentLength = res.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_RESPONSE_BYTES) {
    throw new GeocodingProviderError("unavailable");
  }

  try {
    return await res.json();
  } catch (err) {
    throw new GeocodingProviderError("unavailable", { cause: err });
  }
}

function featuresFromBody(data: unknown): unknown[] {
  if (typeof data !== "object" || data === null) return [];
  const features = (data as { features?: unknown }).features;
  // Reverse returns a FeatureCollection with 0–1 features; search returns many.
  // Some Nominatim builds also return a bare Feature for reverse — accept both.
  if (Array.isArray(features)) return features;
  if ((data as { type?: unknown }).type === "Feature") return [data];
  return [];
}

/** Nominatim (OpenStreetMap) geocoding adapter — free-text query and reverse lookup.
 * Uses `format=geocodejson` + `addressdetails=1` so structured fields drive compact UI
 * strings via `formatCompactAddress` / `formatVenueName`. */
export class NominatimProvider implements GeocodingProvider {
  readonly name = "nominatim";

  constructor(private readonly options: NominatimProviderOptions) {}

  async search(query: string): Promise<GeocodingResult[]> {
    const fetchImpl = this.options.fetchFn ?? fetch;
    const userAgent = await this.options.buildUserAgent();

    const url = new URL("/search", this.options.baseUrl);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "geocodejson");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("limit", String(MAX_RESULTS));

    const data = await fetchJson(fetchImpl, url, userAgent, this.options.timeoutMs);
    const results: GeocodingResult[] = [];
    for (const raw of featuresFromBody(data)) {
      const parsed = parseFeature(raw, this.name);
      if (parsed) results.push(parsed);
      if (results.length >= MAX_RESULTS) break;
    }
    return results;
  }

  async reverse(latitude: number, longitude: number): Promise<GeocodingResult | null> {
    const fetchImpl = this.options.fetchFn ?? fetch;
    const userAgent = await this.options.buildUserAgent();

    const url = new URL("/reverse", this.options.baseUrl);
    url.searchParams.set("lat", String(latitude));
    url.searchParams.set("lon", String(longitude));
    url.searchParams.set("format", "geocodejson");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("zoom", String(REVERSE_ZOOM));

    const data = await fetchJson(fetchImpl, url, userAgent, this.options.timeoutMs);
    for (const raw of featuresFromBody(data)) {
      const parsed = parseFeature(raw, this.name);
      if (parsed) {
        // Prefer the clicked coordinates over the feature centroid — the pin is what the
        // admin placed; the OSM object's centroid can sit a block away in dense cities.
        return { ...parsed, latitude, longitude };
      }
    }
    return null;
  }
}
