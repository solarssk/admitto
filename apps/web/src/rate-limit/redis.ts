import { createClient } from "redis";
import { redisKeyForHit, redisWindowStart } from "./redis-keys.js";
import { InMemoryRateLimitStore } from "./in-memory.js";
import type { RateLimitHitResult, RateLimitStore } from "./types.js";
import { recordSystemLog } from "@admitto/shared/system-log";

const FALLBACK_WARN = "Rate limit Redis unavailable; falling back to per-process in-memory limiter";
const FAIL_OPEN_LOG_INTERVAL_MS = 60_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 2_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 2_000;
const DEFAULT_OUTAGE_COOLDOWN_MS = 5_000;

/** Atomically INCR and PEXPIRE on first creation (ttlMs in ARGV[1]). */
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

function positiveMs(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 1) {
    throw new Error(`${name} must be a positive number`);
  }
  return value;
}

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
 * Falls back to a process-local {@link InMemoryRateLimitStore} when Redis is unreachable or
 * commands time out, so an outage degrades limits to "per replica" instead of removing them
 * entirely — see {@link fallbackHit}.
 */
export class RedisRateLimitStore implements RateLimitStore {
  private readonly client: ReturnType<typeof createRedisClient>;
  private readonly commandTimeoutMs: number;
  private readonly outageCooldownMs: number;
  private readonly fallbackStore = new InMemoryRateLimitStore();
  private connectPromise: Promise<void> | null = null;
  private lastFailOpenWarnAt = 0;
  private redisUnavailableUntil = 0;

  /** @param url Redis connection URL from `REDIS_URL`. */
  constructor(url: string, options: RedisRateLimitStoreOptions = {}) {
    const connectTimeoutMs = positiveMs(
      options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      "connectTimeoutMs",
    );
    this.commandTimeoutMs = positiveMs(
      options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
      "commandTimeoutMs",
    );
    this.outageCooldownMs = positiveMs(
      options.outageCooldownMs ?? DEFAULT_OUTAGE_COOLDOWN_MS,
      "outageCooldownMs",
    );
    this.client = createRedisClient({ url, connectTimeoutMs });
  }

  /**
   * Wait until the client can accept commands (`isReady`).
   * Always joins an in-flight `connect()` so concurrent hits do not race the handshake.
   */
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

  private warnFailOpen(now: number): void {
    if (now - this.lastFailOpenWarnAt >= FAIL_OPEN_LOG_INTERVAL_MS) {
      console.warn(FALLBACK_WARN);
      recordSystemLog({ level: "warn", source: "cache", message: FALLBACK_WARN });
      this.lastFailOpenWarnAt = now;
    }
  }

  private markRedisUnavailable(now: number): void {
    this.redisUnavailableUntil = now + this.outageCooldownMs;
  }

  /** Degraded-mode enforcement while Redis is unreachable: delegate to the process-local
   * fallback instead of allowing every request. Still bounds traffic (per replica, not shared
   * account-wide), unlike the previous unconditional allow. */
  private fallbackHit(key: string, windowMs: number, max: number): Promise<RateLimitHitResult> {
    return this.fallbackStore.hit(key, windowMs, max);
  }

  /** Record one request for `key` within a fixed Redis window of `windowMs`. */
  async hit(key: string, windowMs: number, max: number): Promise<RateLimitHitResult> {
    const now = Date.now();
    const windowStart = redisWindowStart(now, windowMs);
    const resetAt = windowStart + windowMs;
    const ttlMs = Math.max(1, resetAt - now);

    if (now < this.redisUnavailableUntil) {
      return this.fallbackHit(key, windowMs, max);
    }

    try {
      await this.ensureConnected();
      const redisKey = redisKeyForHit(key, windowMs, now);
      const count = Number(
        await this.client
          .withAbortSignal(AbortSignal.timeout(this.commandTimeoutMs))
          .eval(INCR_PEXPIRE_SCRIPT, {
            keys: [redisKey],
            arguments: [String(ttlMs)],
          }),
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
      return this.fallbackHit(key, windowMs, max);
    }
  }

  /** Ping Redis and measure round-trip latency for readiness probes. */
  async health(): Promise<{ ok: boolean; latencyMs: number | null }> {
    const started = Date.now();
    try {
      await this.ensureConnected();
      await this.client
        .withAbortSignal(AbortSignal.timeout(this.commandTimeoutMs))
        .ping();
      return { ok: true, latencyMs: Date.now() - started };
    } catch {
      return { ok: false, latencyMs: Date.now() - started };
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
