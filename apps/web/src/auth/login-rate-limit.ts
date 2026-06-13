import type { Context, Next } from "hono";
import { clientIpFromHeaders } from "../rate-limit/client-ip.js";
import type { RateLimitStore } from "../rate-limit/types.js";

const LOGIN_WINDOW_MS = 60_000;
const LOGIN_MAX_REQUESTS = 10;

/** Rate-limit POST /api/auth/login per client IP. */
export function createLoginRateLimitMiddleware(store: RateLimitStore) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const ip = clientIpFromHeaders(c.req.header("x-forwarded-for"));
    const { allowed } = await store.hit(`auth:login:${ip}`, LOGIN_WINDOW_MS, LOGIN_MAX_REQUESTS);
    if (!allowed) return c.json({ error: "too many requests" }, 429);
    await next();
  };
}
