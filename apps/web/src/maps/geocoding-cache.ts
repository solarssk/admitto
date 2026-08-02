/**
 * Cache for geocoding search results, keyed by normalized query. Separate from
 * `rate-limit/redis.ts`'s `RateLimitStore` — that store only exposes an increment-only
 * `hit()`, not the generic get/set a result cache needs. Same Redis→in-memory fallback
 * shape as `createRateLimitStore()` (`rate-limit/factory.ts`), fails open to a cache miss
 * (not an error) so a Redis outage degrades to "ask the provider every time", not "search
 * breaks" — the provider call is already protected by the geocoding rate limit.
 */
import { createClient } from "redis";
import type { GeocodingResult } from "@admitto/location";
import { recordSystemLog } from "@admitto/shared/system-log";

type EnvLike = Record<string, string | undefined>;

/** Successful lookups are stable enough to cache for a month; empty results (a typo, an
 * address Nominatim doesn't know) are cached much more briefly so a corrected query isn't
 * stuck behind a long negative-cache window. */
const POSITIVE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000;
const REDIS_KEY_PREFIX = "geocoding:cache:";
const DEFAULT_COMMAND_TIMEOUT_MS = 2_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 2_000;
const FAIL_OPEN_WARN = "Geocoding cache Redis unavailable; treating as cache miss";
const FAIL_OPEN_LOG_INTERVAL_MS = 60_000;

export interface GeocodingCache {
  /** Returns `null` on a cache miss (including "not cached yet" and "Redis unavailable") —
   * callers should then ask the provider directly. */
  get(key: string): Promise<GeocodingResult[] | null>;
  set(key: string, results: GeocodingResult[]): Promise<void>;
}

function ttlForResults(results: GeocodingResult[]): number {
  return results.length === 0 ? NEGATIVE_TTL_MS : POSITIVE_TTL_MS;
}

/** In-memory fallback — used in tests (`NODE_ENV=test`) and dev/small deployments without
 * `REDIS_URL`. Not shared across processes/replicas; that's fine, the provider call itself
 * is protected by the geocoding rate limit regardless of cache hit rate. */
export class InMemoryGeocodingCache implements GeocodingCache {
  private readonly store = new Map<string, { results: GeocodingResult[]; expiresAt: number }>();

  async get(key: string): Promise<GeocodingResult[] | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.results;
  }

  async set(key: string, results: GeocodingResult[]): Promise<void> {
    this.store.set(key, { results, expiresAt: Date.now() + ttlForResults(results) });
  }
}

/** Redis-backed cache, fail-open on any connection/command error (see module doc). */
export class RedisGeocodingCache implements GeocodingCache {
  private readonly client: ReturnType<typeof createClient>;
  private readonly commandTimeoutMs: number;
  private connectPromise: Promise<void> | null = null;
  private lastFailOpenWarnAt = 0;

  constructor(
    url: string,
    options: { connectTimeoutMs?: number; commandTimeoutMs?: number } = {},
  ) {
    this.commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    this.client = createClient({
      url,
      socket: {
        connectTimeout: options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
        reconnectStrategy: false,
      },
    });
    // Required by node-redis — unhandled 'error' events can crash the process.
    this.client.on("error", () => {});
  }

  private async ensureConnected(): Promise<void> {
    if (this.client.isReady) return;
    this.connectPromise ??= this.client
      .connect()
      .then(() => undefined)
      .finally(() => {
        this.connectPromise = null;
      });
    await this.connectPromise;
    if (!this.client.isReady) {
      throw new Error("Redis client not ready");
    }
  }

  private warnFailOpen(): void {
    const now = Date.now();
    if (now - this.lastFailOpenWarnAt >= FAIL_OPEN_LOG_INTERVAL_MS) {
      console.warn(FAIL_OPEN_WARN);
      recordSystemLog({ level: "warn", source: "cache", message: FAIL_OPEN_WARN });
      this.lastFailOpenWarnAt = now;
    }
  }

  async get(key: string): Promise<GeocodingResult[] | null> {
    try {
      await this.ensureConnected();
      const raw = await this.client
        .withAbortSignal(AbortSignal.timeout(this.commandTimeoutMs))
        .get(REDIS_KEY_PREFIX + key);
      if (!raw) return null;
      return JSON.parse(raw) as GeocodingResult[];
    } catch {
      this.warnFailOpen();
      return null;
    }
  }

  async set(key: string, results: GeocodingResult[]): Promise<void> {
    try {
      await this.ensureConnected();
      await this.client
        .withAbortSignal(AbortSignal.timeout(this.commandTimeoutMs))
        .set(REDIS_KEY_PREFIX + key, JSON.stringify(results), {
          expiration: { type: "PX", value: ttlForResults(results) },
        });
    } catch {
      this.warnFailOpen();
    }
  }

  /** @internal test helper */
  async disconnect(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.quit();
    }
    this.connectPromise = null;
  }
}

/** Build the active geocoding cache from environment — Redis when `REDIS_URL` is set in
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
