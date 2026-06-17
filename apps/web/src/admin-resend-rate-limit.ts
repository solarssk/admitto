import type { Context, Next } from "hono";
import { resolveClientIp } from "./rate-limit/client-ip.js";
import type { RateLimitStore } from "./rate-limit/types.js";

/** Sliding window for admin ticket resend (ms). */
const RESEND_WINDOW_MS = 60_000;

/** Max resends per admin user per attendee per minute. */
const RESEND_MAX_REQUESTS = 5;

/**
 * Rate-limit admin ticket resend after `staffAdminGate`.
 * Key: per user + attendee so unauthenticated clients cannot consume the bucket.
 */
export function createAdminResendRateLimit(store: RateLimitStore) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const auth = c.get("auth");
    const attendeeId = c.req.param("id");
    if (!attendeeId) return c.json({ error: "id required" }, 400);

    const userId = auth?.userId;
    const key = userId
      ? `admin:resend:user:${userId}:attendee:${attendeeId}`
      : `admin:resend:ip:${resolveClientIp(c)}:attendee:${attendeeId}`;

    const { allowed } = await store.hit(key, RESEND_WINDOW_MS, RESEND_MAX_REQUESTS);
    if (!allowed) return c.json({ error: "too many requests" }, 429);
    await next();
  };
}
