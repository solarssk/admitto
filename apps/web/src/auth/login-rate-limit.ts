import type { Context, Next } from "hono";
import { logRateLimitExceeded, normalizeEmail } from "@admitto/auth";
import { resolveClientIp } from "../rate-limit/client-ip.js";
import { INLINE_RATE_LIMITS, RATE_POLICIES } from "../rate-limit/policies.js";
import type { RateLimitStore } from "../rate-limit/types.js";

/**
 * Rate-limit login POST per client IP (HTML form and JSON API).
 * Stays outside the generic rateLimit() wrapper because format changes the 429 body.
 */
export function createLoginRateLimitMiddleware(
  store: RateLimitStore,
  options: { format?: "json" | "text"; policyKey?: "auth:login-ip" | "auth:passkey-login-ip" } = {},
) {
  const format = options.format ?? "json";
  const policyKey = options.policyKey ?? "auth:login-ip";
  const check = RATE_POLICIES[policyKey].checks[0];
  const scope = policyKey === "auth:login-ip" ? "login_ip" : "passkey_login_ip";
  return async (c: Context, next: Next): Promise<Response | void> => {
    const ip = resolveClientIp(c);
    const { allowed } = await store.hit(check.keyOf(c), check.windowMs, check.max);
    if (!allowed) {
      logRateLimitExceeded({ scope, ip });
      return format === "text"
        ? c.text("Too many requests", 429)
        : c.json({ error: "too many requests" }, 429);
    }
    await next();
  };
}

/** Defense-in-depth: throttle login attempts per normalized email (inline, not middleware). */
export async function checkLoginEmailRateLimit(
  store: RateLimitStore,
  email: string,
  ip?: string,
): Promise<boolean> {
  const { windowMs, max } = INLINE_RATE_LIMITS["auth:login-email"];
  const key = `auth:login:email:${normalizeEmail(email)}`;
  const { allowed } = await store.hit(key, windowMs, max);
  if (!allowed) {
    logRateLimitExceeded({ scope: "login_email", ip, keyHint: "email" });
  }
  return allowed;
}
