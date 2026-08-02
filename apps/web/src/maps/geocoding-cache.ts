/**
 * Cache for geocoding search results, keyed by normalized query. Separate from
 * `rate-limit/redis.ts`'s `RateLimitStore` - that store only exposes an increment-only
 * `hit()`, not the generic get/set a result cache needs. Same Redis→in-memory fallback
 * shape as `createRateLimitStore()` (`rate-limit/factory.ts`), fails open to a cache miss
 * (not an error) so a Redis outage degrades to "ask the provider every time", not "search
 * breaks" - the provider call is already protected by the geocoding rate limit.
 */
import type { GeocodingResult } from "@admitto/location";
import {
  InMemoryTtlStringCache,
  RedisTtlStringCache,
  type TtlStringCache,
} from "./ttl-string-cache.js";

type EnvLike = Record<string, string | undefined>;

/** Successful lookups are stable enough to cache for a month; empty results (a typo, an
 * address Nominatim doesn't know) are cached much more briefly so a corrected query isn't
 * stuck behind a long negative-cache window. */
const POSITIVE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000;
const REDIS_KEY_PREFIX = "geocoding:cache:";
const FAIL_OPEN_WARN = "Geocoding cache Redis unavailable; treating as cache miss";

export interface GeocodingCache {
  /** Returns `null` on a cache miss (including "not cached yet" and "Redis unavailable") -
   * callers should then ask the provider directly. */
  get(key: string): Promise<GeocodingResult[] | null>;
  set(key: string, results: GeocodingResult[]): Promise<void>;
}

function ttlForResults(results: GeocodingResult[]): number {
  return results.length === 0 ? NEGATIVE_TTL_MS : POSITIVE_TTL_MS;
}

class GeocodingCacheAdapter implements GeocodingCache {
  constructor(private readonly store: TtlStringCache) {}

  async get(key: string): Promise<GeocodingResult[] | null> {
    const raw = await this.store.get(key);
    if (raw === null) return null;
    return JSON.parse(raw) as GeocodingResult[];
  }

  async set(key: string, results: GeocodingResult[]): Promise<void> {
    await this.store.set(key, JSON.stringify(results), ttlForResults(results));
  }

  /** @internal test helper */
  async disconnect(): Promise<void> {
    await this.store.disconnect?.();
  }
}

/** In-memory fallback - used in tests (`NODE_ENV=test`) and dev/small deployments without
 * `REDIS_URL`. Not shared across processes/replicas; that's fine, the provider call itself
 * is protected by the geocoding rate limit regardless of cache hit rate. */
export class InMemoryGeocodingCache extends GeocodingCacheAdapter {
  constructor() {
    super(new InMemoryTtlStringCache());
  }
}

/** Redis-backed cache, fail-open on any connection/command error (see module doc). */
export class RedisGeocodingCache extends GeocodingCacheAdapter {
  constructor(
    url: string,
    options: { connectTimeoutMs?: number; commandTimeoutMs?: number } = {},
  ) {
    super(
      new RedisTtlStringCache(url, {
        keyPrefix: REDIS_KEY_PREFIX,
        failOpenWarn: FAIL_OPEN_WARN,
        ...options,
      }),
    );
  }
}

/** Build the active geocoding cache from environment - Redis when `REDIS_URL` is set in
 * non-test runtimes, in-memory otherwise (mirrors `createRateLimitStore`). */
export function createGeocodingCache(env: EnvLike = process.env): GeocodingCache {
  if (env["NODE_ENV"] === "test") {
    return new InMemoryGeocodingCache();
  }
  const url = env["REDIS_URL"]?.trim();
  if (url) {
    return new RedisGeocodingCache(url);
  }
  return new InMemoryGeocodingCache();
}
