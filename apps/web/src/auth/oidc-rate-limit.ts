import type { Context, Next } from "hono";
import { logRateLimitExceeded } from "@admitto/auth";
import { resolveClientIp } from "../rate-limit/client-ip.js";
import type { RateLimitStore } from "../rate-limit/types.js";

const OIDC_AUTH_WINDOW_MS = 60_000;
const OIDC_AUTH_MAX_REQUESTS = 20;
const OIDC_LINK_STEPUP_MAX_REQUESTS = 10;

/** Rate-limit unauthenticated OIDC start/callback per client IP. */
export function createOidcAuthRateLimitMiddleware(store: RateLimitStore) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const ip = resolveClientIp(c);
    const { allowed } = await store.hit(
      `auth:oidc:ip:${ip}`,
      OIDC_AUTH_WINDOW_MS,
      OIDC_AUTH_MAX_REQUESTS,
    );
    if (!allowed) {
      logRateLimitExceeded({ scope: "oidc_auth", ip });
      return c.text("Too many requests", 429);
    }
    await next();
  };
}

/** Throttle OIDC link step-up password attempts per user and IP. */
export async function checkOidcLinkStepUpRateLimit(
  store: RateLimitStore,
  userId: string,
  ip: string,
): Promise<boolean> {
  const userResult = await store.hit(
    `oidc:link:stepup:user:${userId}`,
    OIDC_AUTH_WINDOW_MS,
    OIDC_LINK_STEPUP_MAX_REQUESTS,
  );
  if (!userResult.allowed) {
    logRateLimitExceeded({ scope: "oidc_link_stepup", ip, keyHint: "user" });
    return false;
  }
  const ipResult = await store.hit(
    `oidc:link:stepup:ip:${ip}`,
    OIDC_AUTH_WINDOW_MS,
    OIDC_LINK_STEPUP_MAX_REQUESTS,
  );
  if (!ipResult.allowed) {
    logRateLimitExceeded({ scope: "oidc_link_stepup", ip, keyHint: "ip" });
    return false;
  }
  return true;
}
