import type { Context, Next } from "hono";
import { resolveClientIp } from "./rate-limit/client-ip.js";
import type { RateLimitStore } from "./rate-limit/types.js";

/** Sliding window for check-in API rate limiting (ms). */
const CHECKIN_WINDOW_MS = 60_000;

/** Authed check-in: loose per-IP cap (scan bursts at the door). */
const CHECKIN_MAX_REQUESTS = 120;

/** Rate-limit `/api/checkin/*` per client IP (before auth). */
export function createCheckinRateLimitMiddleware(store: RateLimitStore) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const ip = resolveClientIp(c);
    const { allowed } = await store.hit(
      `checkin:ip:${ip}`,
      CHECKIN_WINDOW_MS,
      CHECKIN_MAX_REQUESTS,
    );
    if (!allowed) return c.json({ error: "too many requests" }, 429);
    await next();
  };
}
