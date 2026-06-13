import { commandOptions, createClient } from "redis";
import { redisKeyForHit, redisWindowStart } from "./redis-keys.js";
import type { RateLimitHitResult, RateLimitStore } from "./types.js";

const FAIL_OPEN_WARN = "Rate limit Redis unavailable; failing open";
const FAIL_OPEN_LOG_INTERVAL_MS = 60_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 2_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 2_000;
const DEFAULT_OUTAGE_COOLDOWN_MS = 5_000;

/** Atomically INCR and PEXPIRE on first creation (windowMs in ARGV[1]). */
const INCR_PEXPIRE_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return count
`;

export type RedisRateLimitStoreOptions = {
  connectTimeoutMs?: number;
  commandTimeoutMs?: number;
  outageCooldownMs?: number;
};

type RedisClientOptions = {
  url: string;
  connectTimeoutMs: number;
};

/** Create a node-redis client with fail-safe error handling for production use. */
function createRedisClient(options: RedisClientOptions) {
  const client = createClient({
    url: options.url,
    socket: {
      connectTimeout: options.connectTimeoutMs,
      reconnectStrategy: false,
    },
  });
  // Required by node-redis — unhandled 'error' events can crash the process.
  client.on("error", () => {});
  return client;
}

/**
 * Shared Redis-backed rate limiter using fixed windows per client key.
 * Fails open (allows traffic) when Redis is unreachable or commands time out.
 */
export class RedisRateLimitStore implements RateLimitStore {
  private readonly client: ReturnType<typeof createRedisClient>;
  private readonly commandTimeoutMs: number;
  private readonly outageCooldownMs: number;
  private connectPromise: Promise<void> | null = null;
  private lastFailOpenWarnAt = 0;
  private redisUnavailableUntil = 0;

  /** @param url Redis connection URL from `REDIS_URL`. */
  constructor(url: string, options: RedisRateLimitStoreOptions = {}) {
    const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this.commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    this.outageCooldownMs = options.outageCooldownMs ?? DEFAULT_OUTAGE_COOLDOWN_MS;
    this.client = createRedisClient({ url, connectTimeoutMs });
  }

  /**
   * Wait until the client can accept commands (`isReady`).
   * Always joins an in-flight `connect()` so concurrent hits do not race the handshake.
   */
  private async ensureConnected(): Promise<void> {
    if (this.client.isReady) return;

    if (!this.connectPromise) {
      this.connectPromise = this.client
        .connect()
        .then(() => undefined)
        .finally(() => {
          this.connectPromise = null;
        });
    }
    await this.connectPromise;

    if (!this.client.isReady) {
      throw new Error("Redis client not ready");
    }
  }

  private warnFailOpen(now: number): void {
    if (now - this.lastFailOpenWarnAt >= FAIL_OPEN_LOG_INTERVAL_MS) {
      console.warn(FAIL_OPEN_WARN);
      this.lastFailOpenWarnAt = now;
    }
  }

  private markRedisUnavailable(now: number): void {
    this.redisUnavailableUntil = now + this.outageCooldownMs;
  }

  private failOpen(now: number, max: number, windowMs: number): RateLimitHitResult {
    return { allowed: true, remaining: max, resetAt: now + windowMs };
  }

  /** Record one request for `key` within a fixed Redis window of `windowMs`. */
  async hit(key: string, windowMs: number, max: number): Promise<RateLimitHitResult> {
    const now = Date.now();
    const windowStart = redisWindowStart(now, windowMs);
    const resetAt = windowStart + windowMs;

    if (now < this.redisUnavailableUntil) {
      return this.failOpen(now, max, windowMs);
    }

    try {
      await this.ensureConnected();
      const redisKey = redisKeyForHit(key, windowMs, now);
      const count = Number(
        await this.client.eval(
          commandOptions({
            signal: AbortSignal.timeout(this.commandTimeoutMs),
          }),
          INCR_PEXPIRE_SCRIPT,
          {
            keys: [redisKey],
            arguments: [String(windowMs)],
          },
        ),
      );
      const allowed = count <= max;
      return {
        allowed,
        remaining: allowed ? Math.max(0, max - count) : 0,
        resetAt,
      };
    } catch {
      this.markRedisUnavailable(now);
      this.warnFailOpen(now);
      return this.failOpen(now, max, windowMs);
    }
  }

  /** @internal test helper */
  async disconnect(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.quit();
    }
    this.connectPromise = null;
    this.redisUnavailableUntil = 0;
  }
}
