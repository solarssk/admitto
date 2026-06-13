import { InMemoryRateLimitStore } from "./in-memory.js";
import { RedisRateLimitStore } from "./redis.js";
import type { RateLimitStore } from "./types.js";

type EnvLike = Record<string, string | undefined>;

/**
 * Build the active rate-limit store from environment.
 * Uses Redis when `REDIS_URL` is set; otherwise the in-memory default for dev/test.
 */
export function createRateLimitStore(env: EnvLike = process.env): RateLimitStore {
  const url = env["REDIS_URL"]?.trim();
  if (url) {
    return new RedisRateLimitStore(url);
  }
  return new InMemoryRateLimitStore();
}
