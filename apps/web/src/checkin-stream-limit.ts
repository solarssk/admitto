import type { Context, Next } from "hono";
import { resolveClientIp } from "./rate-limit/client-ip.js";

/** Max concurrent SSE streams per operator (or bearer IP). */
const MAX_CONCURRENT_CHECKIN_STREAMS = 3;

const activeStreamsByKey = new Map<string, number>();

function streamConcurrencyKey(c: Context): string {
  if (c.get("checkinAuth") === "bearer") {
    return `checkin:stream:bearer:ip:${resolveClientIp(c)}`;
  }
  const userId = c.get("operatorUserId") as string | undefined;
  if (userId) return `checkin:stream:user:${userId}`;
  return `checkin:stream:ip:${resolveClientIp(c)}`;
}

/** Limit parallel long-lived check-in SSE connections per operator. */
export function createCheckinStreamConcurrencyLimit() {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const key = streamConcurrencyKey(c);
    const active = activeStreamsByKey.get(key) ?? 0;
    if (active >= MAX_CONCURRENT_CHECKIN_STREAMS) {
      return c.json({ error: "too_many_streams" }, 429);
    }

    activeStreamsByKey.set(key, active + 1);
    try {
      await next();
    } finally {
      const current = activeStreamsByKey.get(key) ?? 1;
      if (current <= 1) {
        activeStreamsByKey.delete(key);
      } else {
        activeStreamsByKey.set(key, current - 1);
      }
    }
  };
}

/** Test-only: reset concurrency counters. */
export function resetCheckinStreamLimitsForTests(): void {
  activeStreamsByKey.clear();
}
