import { createClient, type RedisClientType } from "redis";
import { redisKeyForHit, redisWindowStart } from "./redis-keys.js";
import type { RateLimitHitResult, RateLimitStore } from "./types.js";

const FAIL_OPEN_WARN = "Rate limit Redis unavailable; failing open";

type RedisClientOptions = {
  url: string;
  connectTimeoutMs?: number;
};

function createRedisClient(options: RedisClientOptions): RedisClientType {
  return createClient({
    url: options.url,
    socket: {
      connectTimeout: options.connectTimeoutMs ?? 2_000,
      reconnectStrategy: false,
    },
  });
}

export class RedisRateLimitStore implements RateLimitStore {
  private readonly client: RedisClientType;
  private connectPromise: Promise<void> | null = null;

  constructor(url: string, connectTimeoutMs?: number) {
    this.client = createRedisClient({ url, connectTimeoutMs });
  }

  private async ensureConnected(): Promise<void> {
    if (this.client.isOpen) return;
    if (!this.connectPromise) {
      this.connectPromise = this.client.connect().then(
        () => undefined,
        (err) => {
          this.connectPromise = null;
          throw err;
        },
      );
    }
    await this.connectPromise;
  }

  async hit(key: string, windowMs: number, max: number): Promise<RateLimitHitResult> {
    const now = Date.now();
    const windowStart = redisWindowStart(now, windowMs);
    const resetAt = windowStart + windowMs;

    try {
      await this.ensureConnected();
      const redisKey = redisKeyForHit(key, windowMs, now);
      const count = await this.client.incr(redisKey);
      if (count === 1) {
        await this.client.pExpire(redisKey, windowMs);
      }
      const allowed = count <= max;
      return {
        allowed,
        remaining: allowed ? Math.max(0, max - count) : 0,
        resetAt,
      };
    } catch {
      console.warn(FAIL_OPEN_WARN);
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
