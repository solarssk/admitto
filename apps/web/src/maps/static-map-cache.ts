/**
 * Cache for generated static map PNGs. Same Redis→in-memory fail-open shape as
 * geocoding via shared `ttl-string-cache` - a Redis outage degrades to regenerating
 * the image, not a 500.
 */
import {
  InMemoryTtlStringCache,
  RedisTtlStringCache,
  type TtlStringCache,
} from "./ttl-string-cache.js";

type EnvLike = Record<string, string | undefined>;

const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REDIS_KEY_PREFIX = "static-map:cache:";
const FAIL_OPEN_WARN = "Static map cache Redis unavailable; treating as cache miss";

export interface StaticMapCache {
  get(key: string): Promise<Buffer | null>;
  set(key: string, png: Buffer): Promise<void>;
}

class StaticMapCacheAdapter implements StaticMapCache {
  constructor(private readonly store: TtlStringCache) {}

  async get(key: string): Promise<Buffer | null> {
    const raw = await this.store.get(key);
    if (raw === null) return null;
    return Buffer.from(raw, "base64");
  }

  async set(key: string, png: Buffer): Promise<void> {
    await this.store.set(key, png.toString("base64"), TTL_MS);
  }

  /** @internal test helper */
  async disconnect(): Promise<void> {
    await this.store.disconnect?.();
  }
}

export class InMemoryStaticMapCache extends StaticMapCacheAdapter {
  constructor() {
    super(new InMemoryTtlStringCache());
  }
}

export class RedisStaticMapCache extends StaticMapCacheAdapter {
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

export function createStaticMapCache(env: EnvLike = process.env): StaticMapCache {
  if (env["NODE_ENV"] === "test") {
    return new InMemoryStaticMapCache();
  }
  const url = env["REDIS_URL"]?.trim();
  if (url) {
    return new RedisStaticMapCache(url);
  }
  return new InMemoryStaticMapCache();
}
