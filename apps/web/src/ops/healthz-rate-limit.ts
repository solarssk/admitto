import { hostname } from "node:os";
import type { Context, Next } from "hono";
import { logRateLimitExceeded } from "@admitto/auth";
import { resolveClientIp } from "../rate-limit/client-ip.js";
import type { RateLimitStore } from "../rate-limit/types.js";

const HEALTHZ_WINDOW_MS = 60_000;
/** Allows frequent Docker healthchecks while blocking DB probe floods. */
const HEALTHZ_MAX_REQUESTS = 120;

function healthzRateLimitKey(ip: string, instanceId: string): string {
  return `ops:healthz:${instanceId}:ip:${ip}`;
}

/**
 * Rate-limit `/healthz` per replica and client IP (shared Redis must not merge probe traffic).
 * Fails open when the rate-limit backend throws so liveness is not coupled to Redis incidents.
 */
export function createHealthzRateLimitMiddleware(
  store: RateLimitStore,
  instanceId: string = hostname(),
) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const ip = resolveClientIp(c);
    let allowed = true;
    try {
      ({ allowed } = await store.hit(
        healthzRateLimitKey(ip, instanceId),
        HEALTHZ_WINDOW_MS,
        HEALTHZ_MAX_REQUESTS,
      ));
    } catch (err) {
      console.error("healthz rate-limit store hit failed:", err);
      await next();
      return;
    }
    if (!allowed) {
      logRateLimitExceeded({ scope: "healthz", ip });
      return c.json({ error: "too many requests" }, 429);
    }
    await next();
  };
}
