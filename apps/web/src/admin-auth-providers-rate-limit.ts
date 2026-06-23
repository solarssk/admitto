import type { Context, Next } from "hono";
import { logRateLimitExceeded } from "@admitto/auth";
import { resolveClientIp } from "./rate-limit/client-ip.js";
import type { RateLimitStore } from "./rate-limit/types.js";

const PROVIDER_OPS_WINDOW_MS = 60_000;
const PROVIDER_OPS_MAX_REQUESTS = 10;

/** Rate-limit OIDC discover/test (outbound HTTP) per superadmin user. */
export function createAdminAuthProviderOpsRateLimit(store: RateLimitStore) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const auth = c.get("auth");
    const providerId = c.req.param("id") ?? "unknown";
    const userId = auth?.userId;
    const key = userId
      ? `admin:oidc-provider-ops:user:${userId}:provider:${providerId}`
      : `admin:oidc-provider-ops:ip:${resolveClientIp(c)}:provider:${providerId}`;

    const { allowed } = await store.hit(key, PROVIDER_OPS_WINDOW_MS, PROVIDER_OPS_MAX_REQUESTS);
    if (!allowed) {
      logRateLimitExceeded({ scope: "admin_oidc_provider_ops", ip: resolveClientIp(c), keyHint: "user" });
      return c.text("Too many requests", 429);
    }
    await next();
  };
}
