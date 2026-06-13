import type { Context, Next } from "hono";
import { clientIpFromHeaders } from "./client-ip.js";
import { MAX_REQUESTS, WINDOW_MS } from "./constants.js";
import type { RateLimitStore } from "./types.js";

/**
 * Public /t and /q rate limit — X-Forwarded-For is trusted only behind a reverse
 * proxy that overwrites the header with the real client IP.
 */
export function createPublicRateLimitMiddleware(store: RateLimitStore) {
  return async (c: Context, next: Next) => {
    const ip = clientIpFromHeaders(c.req.header("x-forwarded-for"));
    const { allowed } = await store.hit(ip, WINDOW_MS, MAX_REQUESTS);
    if (!allowed) return c.text("Too Many Requests", 429);
    await next();
  };
}
