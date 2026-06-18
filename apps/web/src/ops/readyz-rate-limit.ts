import type { Context, Next } from "hono";
import { resolveClientIp } from "../rate-limit/client-ip.js";
import type { RateLimitStore } from "../rate-limit/types.js";

const READYZ_WINDOW_MS = 60_000;
const READYZ_MAX_REQUESTS = 10;

/** Rate-limit `/readyz` per client IP (covers failed auth attempts). */
export function createReadyzRateLimitMiddleware(store: RateLimitStore) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const ip = resolveClientIp(c);
    const { allowed } = await store.hit(`ops:readyz:ip:${ip}`, READYZ_WINDOW_MS, READYZ_MAX_REQUESTS);
    if (!allowed) {
      return c.body(null, 429);
    }
    await next();
  };
}
