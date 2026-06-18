import type { Context, Next } from "hono";
import { resolveClientIp } from "./rate-limit/client-ip.js";
import type { RateLimitStore } from "./rate-limit/types.js";

/** Sliding window for admin template test-send (ms). */
const TEST_SEND_WINDOW_MS = 60_000;

/** Max test sends per admin user per event per minute. */
const TEST_SEND_MAX_REQUESTS = 5;

/**
 * Rate-limit admin mail test-send after `staffAdminGate`.
 * Per-event key: user + event so unauthenticated clients cannot consume the bucket.
 */
export function createAdminCommunicationRateLimit(store: RateLimitStore) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const auth = c.get("auth");
    const eventId = c.req.param("eventId");
    if (!eventId) return c.json({ error: "eventId required" }, 400);

    const userId = auth?.userId;
    const key = userId
      ? `admin:test-send:user:${userId}:event:${eventId}`
      : `admin:test-send:ip:${resolveClientIp(c)}:event:${eventId}`;

    const { allowed } = await store.hit(key, TEST_SEND_WINDOW_MS, TEST_SEND_MAX_REQUESTS);
    if (!allowed) return c.json({ error: "too many requests" }, 429);

    await next();
  };
}
