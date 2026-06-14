import type { Context, Next } from "hono";
import { resolveClientIp } from "./rate-limit/client-ip.js";
import type { RateLimitStore } from "./rate-limit/types.js";

/** Sliding window for check-in API rate limiting (ms). */
const CHECKIN_WINDOW_MS = 60_000;

/** Per-operator scan bursts at the door. */
const CHECKIN_SCAN_MAX_REQUESTS = 120;

/** History polling — separate bucket so it cannot block scans on shared venue NAT. */
const CHECKIN_HISTORY_MAX_REQUESTS = 180;

export type CheckinRateLimitKind = "scan" | "history";

/**
 * Rate-limit authed check-in traffic after `createCheckinPreAuth`.
 * Session path: per `operatorUserId`; Bearer break-glass: per client IP.
 */
export function createCheckinAuthenticatedRateLimit(
  store: RateLimitStore,
  kind: CheckinRateLimitKind,
) {
  const max = kind === "scan" ? CHECKIN_SCAN_MAX_REQUESTS : CHECKIN_HISTORY_MAX_REQUESTS;

  return async (c: Context, next: Next): Promise<Response | void> => {
    const key = rateLimitKey(c, kind);
    const { allowed } = await store.hit(key, CHECKIN_WINDOW_MS, max);
    if (!allowed) return c.json({ error: "too many requests" }, 429);
    await next();
  };
}

function rateLimitKey(c: Context, kind: CheckinRateLimitKind): string {
  if (c.get("checkinAuth") === "bearer") {
    return `checkin:${kind}:bearer:ip:${resolveClientIp(c)}`;
  }
  const userId = c.get("operatorUserId") as string | undefined;
  if (userId) return `checkin:${kind}:user:${userId}`;
  return `checkin:${kind}:ip:${resolveClientIp(c)}`;
}
