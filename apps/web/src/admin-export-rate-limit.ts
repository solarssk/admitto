import type { Context, Next } from "hono";
import type { RateLimitStore } from "./rate-limit/types.js";

/** Sliding window for admin data export (ms). */
const EXPORT_WINDOW_MS = 3_600_000;

/** Max exports per admin user per route per window — standard exports. */
const EXPORT_MAX_REQUESTS = 10;

/** Max exports per admin user per route per window — PII export (more restrictive). */
const PII_EXPORT_MAX_REQUESTS = 5;

/**
 * Rate-limit admin data export endpoints after `staffAdminGate`.
 * Keyed by userId + `routePath` (Hono route pattern) so limits apply globally
 * across events, not per `:eventId` instance.
 */
export function createAdminExportRateLimit(
  store: RateLimitStore,
  maxRequests = EXPORT_MAX_REQUESTS,
) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const auth = c.get("auth");
    const userId = auth.userId;
    const key = `admin:export:user:${userId}:route:${c.req.routePath}`;
    const { allowed } = await store.hit(key, EXPORT_WINDOW_MS, maxRequests);
    if (!allowed) return c.json({ error: "too many requests" }, 429);
    await next();
  };
}

/** Stricter export rate limit for superadmin PII CSV download. */
export function createAdminPiiExportRateLimit(store: RateLimitStore) {
  return createAdminExportRateLimit(store, PII_EXPORT_MAX_REQUESTS);
}
