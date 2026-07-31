/** Ties query normalization, cache lookup, and the provider search together so the route
 * handler doesn't juggle all three itself. */
import type { GeocodingProvider, GeocodingResult } from "@admitto/location";
import type { GeocodingCache } from "./geocoding-cache.js";

/** Collapse whitespace and case so trivially-equivalent queries ("Warsaw", " warsaw ",
 * "Warsaw  ") share one cache entry instead of each burning a separate provider call. */
function normalizeQuery(rawQuery: string): string {
  return rawQuery.trim().replace(/\s+/g, " ").toLowerCase();
}

export class GeocodingService {
  constructor(
    private readonly provider: GeocodingProvider,
    private readonly cache: GeocodingCache,
  ) {}

  async search(rawQuery: string): Promise<GeocodingResult[]> {
    const query = normalizeQuery(rawQuery);
    const cacheKey = `${this.provider.name}:${query}`;

    const cached = await this.cache.get(cacheKey);
    if (cached !== null) return cached;

    const results = await this.provider.search(query);
    await this.cache.set(cacheKey, results);
    return results;
  }
}
