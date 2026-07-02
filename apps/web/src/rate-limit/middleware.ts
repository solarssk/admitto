import type { RateLimitStore } from "./types.js";
import { rateLimit } from "./policies.js";

/**
 * Hono middleware that rate-limits public `/t` and `/q` routes per client IP.
 * Implemented via the declarative registry — key is bare IP (no prefix).
 * Fail-open when Redis is down is handled by {@link RedisRateLimitStore}.
 */
export function createPublicRateLimitMiddleware(store: RateLimitStore) {
  return rateLimit(store, "public:tq");
}
