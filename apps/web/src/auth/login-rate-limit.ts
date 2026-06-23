import type { Context, Next } from "hono";
import { logRateLimitExceeded, normalizeEmail } from "@admitto/auth";
import { resolveClientIp } from "../rate-limit/client-ip.js";
import type { RateLimitStore } from "../rate-limit/types.js";

const LOGIN_WINDOW_MS = 60_000;
const LOGIN_MAX_REQUESTS = 10;

/** Rate-limit login POST per client IP (HTML form and JSON API). */
export function createLoginRateLimitMiddleware(
  store: RateLimitStore,
  options: { format?: "json" | "text" } = {},
) {
  const format = options.format ?? "json";
  return async (c: Context, next: Next): Promise<Response | void> => {
    const ip = resolveClientIp(c);
    const { allowed } = await store.hit(`auth:login:ip:${ip}`, LOGIN_WINDOW_MS, LOGIN_MAX_REQUESTS);
    if (!allowed) {
      logRateLimitExceeded({ scope: "login_ip", ip });
      return format === "text"
        ? c.text("Too many requests", 429)
        : c.json({ error: "too many requests" }, 429);
    }
    await next();
  };
}

/** Defense-in-depth: throttle login attempts per normalized email. */
export async function checkLoginEmailRateLimit(
  store: RateLimitStore,
  email: string,
  ip?: string,
): Promise<boolean> {
  const key = `auth:login:email:${normalizeEmail(email)}`;
  const { allowed } = await store.hit(key, LOGIN_WINDOW_MS, LOGIN_MAX_REQUESTS);
  if (!allowed) {
    logRateLimitExceeded({ scope: "login_email", ip, keyHint: "email" });
  }
  return allowed;
}
