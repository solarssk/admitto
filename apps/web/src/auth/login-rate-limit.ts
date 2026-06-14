import type { Context, Next } from "hono";
import { normalizeEmail } from "@admitto/auth";
import { resolveClientIp } from "../rate-limit/client-ip.js";
import type { RateLimitStore } from "../rate-limit/types.js";

const LOGIN_WINDOW_MS = 60_000;
const LOGIN_MAX_REQUESTS = 10;

/** Rate-limit POST /api/auth/login per client IP. */
export function createLoginRateLimitMiddleware(store: RateLimitStore) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const ip = resolveClientIp(c);
    const { allowed } = await store.hit(`auth:login:ip:${ip}`, LOGIN_WINDOW_MS, LOGIN_MAX_REQUESTS);
    if (!allowed) return c.json({ error: "too many requests" }, 429);
    await next();
  };
}

/** Defense-in-depth: throttle login attempts per normalized email. */
export async function checkLoginEmailRateLimit(
  store: RateLimitStore,
  email: string,
): Promise<boolean> {
  const key = `auth:login:email:${normalizeEmail(email)}`;
  const { allowed } = await store.hit(key, LOGIN_WINDOW_MS, LOGIN_MAX_REQUESTS);
  return allowed;
}
