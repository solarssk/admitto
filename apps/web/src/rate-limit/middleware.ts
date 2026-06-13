import type { Context, Next } from "hono";
import { resolveClientIp } from "./client-ip.js";
import { MAX_REQUESTS, WINDOW_MS } from "./constants.js";
import type { RateLimitStore } from "./types.js";

/**
 * Hono middleware that rate-limits public `/t` and `/q` routes per client IP.
 * X-Forwarded-For is trusted only behind a reverse proxy that overwrites the header.
 */
export function createPublicRateLimitMiddleware(store: RateLimitStore) {
  return async (c: Context, next: Next) => {
    const ip = resolveClientIp(c);
    const { allowed } = await store.hit(ip, WINDOW_MS, MAX_REQUESTS);
    if (!allowed) return c.text("Too Many Requests", 429);
    await next();
  };
}
