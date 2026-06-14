import { InMemoryRateLimitStore } from "./in-memory.js";
import { RedisRateLimitStore } from "./redis.js";
import type { RateLimitStore } from "./types.js";

type EnvLike = Record<string, string | undefined>;

/**
 * Build the active rate-limit store from environment.
 * Uses Redis when `REDIS_URL` is set in non-test runtimes; vitest uses in-memory
 * so integration tests do not share counters across files on CI Redis.
 */
export function createRateLimitStore(env: EnvLike = process.env): RateLimitStore {
  if (env["NODE_ENV"] === "test") {
    return new InMemoryRateLimitStore();
  }
  const url = env["REDIS_URL"]?.trim();
  if (url) {
    return new RedisRateLimitStore(url);
  }
  return new InMemoryRateLimitStore();
}
