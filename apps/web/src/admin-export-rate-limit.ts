import type { Context, Next } from "hono";
import { routePath } from "hono/route";
import type { RateLimitStore } from "./rate-limit/types.js";

/** Sliding window for admin data export (ms). */
const EXPORT_WINDOW_MS = 3_600_000;

/** Max exports per admin user per route per window — standard exports. */
const EXPORT_MAX_REQUESTS = 10;

/** Max exports per admin user per route per window — PII export (more restrictive). */
const PII_EXPORT_MAX_REQUESTS = 5;

/**
 * Rate-limit admin data export endpoints after `staffAdminGate`.
 * Keyed by userId + `routePath(c)` from `hono/route` (Hono route pattern) so limits apply globally
 * across events, not per `:eventId` instance.
 *
 * @returns Hono middleware that returns 429 when the per-user per-route limit is exceeded.
 */
export function createAdminExportRateLimit(
  store: RateLimitStore,
  maxRequests = EXPORT_MAX_REQUESTS,
) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const auth = c.get("auth");
    const userId = auth.userId;
    const key = `admin:export:user:${userId}:route:${routePath(c)}`;
    const { allowed } = await store.hit(key, EXPORT_WINDOW_MS, maxRequests);
    if (!allowed) return c.json({ error: "too many requests" }, 429);
    await next();
  };
}

/**
 * Stricter export rate limit for superadmin PII CSV download (5 req/h per user per route).
 *
 * @returns Hono middleware that returns 429 when the PII export limit is exceeded.
 */
export function createAdminPiiExportRateLimit(store: RateLimitStore) {
  return createAdminExportRateLimit(store, PII_EXPORT_MAX_REQUESTS);
}
