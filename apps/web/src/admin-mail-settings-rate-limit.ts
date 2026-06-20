import type { Context, Next } from "hono";
import type { RateLimitStore } from "./rate-limit/types.js";

const TRANSPORT_TEST_WINDOW_MS = 60_000;
const TRANSPORT_TEST_MAX_REQUESTS = 5;

/** Rate-limit instance mail transport test-send after `staffAdminGate`. */
export function createAdminMailSettingsRateLimit(store: RateLimitStore) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const auth = c.get("auth");
    const userId = auth.userId;
    const key = `admin:mail-transport-test:user:${userId}`;

    const { allowed } = await store.hit(key, TRANSPORT_TEST_WINDOW_MS, TRANSPORT_TEST_MAX_REQUESTS);
    if (!allowed) return c.json({ error: "too many requests" }, 429);

    await next();
  };
}
