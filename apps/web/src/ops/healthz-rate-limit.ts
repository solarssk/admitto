import type { Context, Next } from "hono";
import { logRateLimitExceeded } from "@admitto/auth";
import { resolveClientIp } from "../rate-limit/client-ip.js";
import type { RateLimitStore } from "../rate-limit/types.js";

const HEALTHZ_WINDOW_MS = 60_000;
/** Allows frequent Docker healthchecks while blocking DB probe floods. */
const HEALTHZ_MAX_REQUESTS = 120;

/** Rate-limit `/healthz` per client IP (liveness probe abuse mitigation). */
export function createHealthzRateLimitMiddleware(store: RateLimitStore) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const ip = resolveClientIp(c);
    const { allowed } = await store.hit(`ops:healthz:ip:${ip}`, HEALTHZ_WINDOW_MS, HEALTHZ_MAX_REQUESTS);
    if (!allowed) {
      logRateLimitExceeded({ scope: "healthz", ip });
      return c.json({ error: "too many requests" }, 429);
    }
    await next();
  };
}
