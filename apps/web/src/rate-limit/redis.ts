import { createClient } from "redis";
import { redisKeyForHit, redisWindowStart } from "./redis-keys.js";
import type { RateLimitHitResult, RateLimitStore } from "./types.js";

const FAIL_OPEN_WARN = "Rate limit Redis unavailable; failing open";
const FAIL_OPEN_LOG_INTERVAL_MS = 60_000;

/** Atomically INCR and PEXPIRE on first creation (windowMs in ARGV[1]). */
const INCR_PEXPIRE_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return count
`;

type RedisClientOptions = {
  url: string;
  connectTimeoutMs?: number;
};

/** Create a node-redis client with fail-safe error handling for production use. */
function createRedisClient(options: RedisClientOptions) {
  const client = createClient({
    url: options.url,
    socket: {
      connectTimeout: options.connectTimeoutMs ?? 2_000,
      reconnectStrategy: false,
    },
  });
  // Required by node-redis — unhandled 'error' events can crash the process.
  client.on("error", () => {});
  return client;
}

/**
 * Shared Redis-backed rate limiter using fixed windows per client key.
 * Fails open (allows traffic) when Redis is unreachable.
 */
export class RedisRateLimitStore implements RateLimitStore {
  private readonly client: ReturnType<typeof createRedisClient>;
  private connectPromise: Promise<void> | null = null;
  private lastFailOpenWarnAt = 0;

  /** @param url Redis connection URL from `REDIS_URL`. */
  constructor(url: string, connectTimeoutMs?: number) {
    this.client = createRedisClient({ url, connectTimeoutMs });
  }

  /** Lazily open the Redis connection; cleared after each attempt for reconnect. */
  private async ensureConnected(): Promise<void> {
    if (this.client.isOpen) return;
    if (!this.connectPromise) {
      this.connectPromise = this.client
        .connect()
        .then(() => undefined)
        .finally(() => {
          this.connectPromise = null;
        });
    }
    await this.connectPromise;
  }

  /** Record one request for `key` within a fixed Redis window of `windowMs`. */
  async hit(key: string, windowMs: number, max: number): Promise<RateLimitHitResult> {
    const now = Date.now();
    const windowStart = redisWindowStart(now, windowMs);
    const resetAt = windowStart + windowMs;

    try {
      await this.ensureConnected();
      const redisKey = redisKeyForHit(key, windowMs, now);
      const count = Number(
        await this.client.eval(INCR_PEXPIRE_SCRIPT, {
          keys: [redisKey],
          arguments: [String(windowMs)],
        }),
      );
      const allowed = count <= max;
      return {
        allowed,
        remaining: allowed ? Math.max(0, max - count) : 0,
        resetAt,
      };
    } catch {
      if (now - this.lastFailOpenWarnAt >= FAIL_OPEN_LOG_INTERVAL_MS) {
        console.warn(FAIL_OPEN_WARN);
        this.lastFailOpenWarnAt = now;
      }
      return { allowed: true, remaining: max, resetAt: now + windowMs };
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
