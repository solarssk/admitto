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

/** One raw Nominatim `jsonv2` search result — only the fields this adapter reads. */
interface RawNominatimResult {
  display_name?: unknown;
  lat?: unknown;
  lon?: unknown;
}

function parseResult(raw: unknown, provider: string): GeocodingResult | null {
  if (typeof raw !== "object" || raw === null) return null;
  const rec = raw as RawNominatimResult;
  const displayName = typeof rec.display_name === "string" ? rec.display_name : null;
  const latitude = typeof rec.lat === "string" ? Number.parseFloat(rec.lat) : null;
  const longitude = typeof rec.lon === "string" ? Number.parseFloat(rec.lon) : null;
  if (!displayName || latitude === null || longitude === null) return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { formatted_address: displayName, latitude, longitude, provider };
}

/** Nominatim (OpenStreetMap) geocoding adapter — free-text query to lat/lng candidates. */
export class NominatimProvider implements GeocodingProvider {
  readonly name = "nominatim";

  constructor(private readonly options: NominatimProviderOptions) {}

  async search(query: string): Promise<GeocodingResult[]> {
    const fetchImpl = this.options.fetchFn ?? fetch;
    const userAgent = await this.options.buildUserAgent();

    const url = new URL("/search", this.options.baseUrl);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "jsonv2");
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

    if (!Array.isArray(data)) return [];
    const results: GeocodingResult[] = [];
    for (const raw of data) {
      const parsed = parseResult(raw, this.name);
      if (parsed) results.push(parsed);
      if (results.length >= MAX_RESULTS) break;
    }
    return results;
  }
}
