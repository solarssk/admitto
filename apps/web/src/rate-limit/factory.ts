import { InMemoryRateLimitStore } from "./in-memory.js";
import { RedisRateLimitStore } from "./redis.js";
import type { RateLimitStore } from "./types.js";

type EnvLike = Record<string, string | undefined>;

export function createRateLimitStore(env: EnvLike = process.env): RateLimitStore {
  const url = env["REDIS_URL"]?.trim();
  if (url) {
    return new RedisRateLimitStore(url);
  }
  return new InMemoryRateLimitStore();
}
