/**
 * Nominatim `/search` adapter (`implements GeocodingProvider` from `@admitto/location`).
 * No SSRF DNS-pinning here (contrast `packages/auth/src/oidc/safe-oidc-fetch.ts` and
 * `packages/mailer/src/adapters/powerAutomate.ts`): those guard admin-controlled URLs
 * entered per-organization through the UI. `GEOCODING_BASE_URL` is deployment-level env
 * config set only by the operator self-hosting the instance, same trust level as
 * BASE_URL/DATABASE_URL/REDIS_URL, none of which get SSRF protection either.
 */
import type { GeocodingProvider, GeocodingResult } from "@admitto/location";

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

function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && err.name === "TimeoutError";
}

/** One raw GeocodeJSON feature — only the fields this adapter reads. Nesting is
 * `properties.geocoding.*` (not directly under `properties` as in plain GeoJSON) per the
 * GeocodeJSON spec (https://github.com/geocoders/geocodejson-spec). `name` is the localized
 * POI/venue name and is absent for plain street/city matches with no named entity; `label` is
 * the full formatted address and is always present on a match. */
interface RawGeocodeJsonFeature {
  properties?: {
    geocoding?: {
      name?: unknown;
      label?: unknown;
    };
  };
  geometry?: {
    // GeoJSON order: [longitude, latitude].
    coordinates?: unknown;
  };
}

function parseFeature(raw: unknown, provider: string): GeocodingResult | null {
  if (typeof raw !== "object" || raw === null) return null;
  const feature = raw as RawGeocodeJsonFeature;
  const geocoding = feature.properties?.geocoding;
  const label = typeof geocoding?.label === "string" ? geocoding.label : null;
  const name = typeof geocoding?.name === "string" ? geocoding.name : undefined;

  const coordinates = feature.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const [longitude, latitude] = coordinates as [unknown, unknown];
  if (typeof longitude !== "number" || typeof latitude !== "number") return null;

  if (!label || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { name, formatted_address: label, latitude, longitude, provider };
}

/** Nominatim (OpenStreetMap) geocoding adapter — free-text query (address or venue name) to
 * lat/lng candidates. Uses `format=geocodejson` (rather than `jsonv2`) specifically because it
 * exposes the matched place/venue *name* (`properties.geocoding.name`) separately from the full
 * address (`.label`) — `jsonv2`'s `display_name` only ever has the full address, which is why
 * venue-name search wasn't previously possible. */
export class NominatimProvider implements GeocodingProvider {
  readonly name = "nominatim";

  constructor(private readonly options: NominatimProviderOptions) {}

  async search(query: string): Promise<GeocodingResult[]> {
    const fetchImpl = this.options.fetchFn ?? fetch;
    const userAgent = await this.options.buildUserAgent();

    const url = new URL("/search", this.options.baseUrl);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "geocodejson");
    url.searchParams.set("limit", String(MAX_RESULTS));

    let res: Response;
    try {
      res = await fetchImpl(url, {
        headers: { "User-Agent": userAgent, Accept: "application/json" },
        signal: AbortSignal.timeout(this.options.timeoutMs),
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

    let data: unknown;
    try {
      data = await res.json();
    } catch (err) {
      throw new GeocodingProviderError("unavailable", { cause: err });
    }

    const features =
      typeof data === "object" && data !== null && Array.isArray((data as { features?: unknown }).features)
        ? (data as { features: unknown[] }).features
        : [];
    const results: GeocodingResult[] = [];
    for (const raw of features) {
      const parsed = parseFeature(raw, this.name);
      if (parsed) results.push(parsed);
      if (results.length >= MAX_RESULTS) break;
    }
    return results;
  }
}
