/** Ties query normalization, cache lookup, and the provider search/reverse together so the
 * route handler doesn't juggle all three itself. */
import type { GeocodingProvider, GeocodingResult } from "@admitto/location";
import type { GeocodingCache } from "./geocoding-cache.js";

/** Collapse whitespace and case so trivially-equivalent queries ("Warsaw", " warsaw ",
 * "Warsaw  ") share one cache entry instead of each burning a separate provider call. */
function normalizeQuery(rawQuery: string): string {
  return rawQuery.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Round to ~0.1 m so nearby pin nudges don't each miss the cache while still keeping
 * building-level reverse distinct. */
function roundCoord(value: number): string {
  return value.toFixed(6);
}

export class GeocodingService {
  constructor(
    private readonly provider: GeocodingProvider,
    private readonly cache: GeocodingCache,
    /** Include endpoint (or other scope) so changing Nominatim base URL cannot reuse stale hits. */
    private readonly cacheScope: () => string = () => "",
  ) {}

  private scopedKey(rest: string): string {
    const scope = this.cacheScope().trim() || "_";
    // v2: results include structured `components` (+ label enrichment). Bump when the
    // cached payload shape changes so a 30-day positive TTL cannot serve stale rows.
    return `${this.provider.name}:v2:${scope}:${rest}`;
  }

  async search(rawQuery: string): Promise<GeocodingResult[]> {
    const query = normalizeQuery(rawQuery);
    const cacheKey = this.scopedKey(query);

    const cached = await this.cache.get(cacheKey);
    if (cached !== null) return cached;

    const results = await this.provider.search(query);
    await this.cache.set(cacheKey, results);
    return results;
  }

  async reverse(latitude: number, longitude: number): Promise<GeocodingResult | null> {
    const cacheKey = this.scopedKey(`rev:${roundCoord(latitude)},${roundCoord(longitude)}`);

    const cached = await this.cache.get(cacheKey);
    if (cached !== null) return cached[0] ?? null;

    const result = await this.provider.reverse(latitude, longitude);
    // Negative-cache a miss as [] so repeated clicks on uncovered ocean don't re-hit Nominatim.
    await this.cache.set(cacheKey, result ? [result] : []);
    return result;
  }
}
