import type { Context, Next } from "hono";
import { logRateLimitExceeded } from "@admitto/auth";
import { resolveClientIp } from "./rate-limit/client-ip.js";
import type { RateLimitStore } from "./rate-limit/types.js";

const HEAVY_OPS_WINDOW_MS = 60_000;

function userEventKey(c: Context, scope: string): string {
  const auth = c.get("auth");
  const eventId = c.req.param("eventId");
  if (!eventId) return `admin:${scope}:ip:${resolveClientIp(c)}`;
  const userId = auth?.userId;
  return userId
    ? `admin:${scope}:user:${userId}:event:${eventId}`
    : `admin:${scope}:ip:${resolveClientIp(c)}:event:${eventId}`;
}

function deny(c: Context): Response {
  return c.json({ error: "too many requests" }, 429);
}

/** Rate-limit import preview (CPU/parse) per admin user and event. */
export function createAdminImportPreviewRateLimit(store: RateLimitStore) {
  const max = 10;
  return async (c: Context, next: Next): Promise<Response | void> => {
    const { allowed } = await store.hit(userEventKey(c, "import-preview"), HEAVY_OPS_WINDOW_MS, max);
    if (!allowed) {
      logRateLimitExceeded({ scope: "admin_import_preview", ip: resolveClientIp(c), keyHint: "user_event" });
      return deny(c);
    }
    await next();
  };
}

/** Rate-limit import commit (long DB transaction) per admin user and event. */
export function createAdminImportCommitRateLimit(store: RateLimitStore) {
  const max = 5;
  return async (c: Context, next: Next): Promise<Response | void> => {
    const { allowed } = await store.hit(userEventKey(c, "import-commit"), HEAVY_OPS_WINDOW_MS, max);
    if (!allowed) {
      logRateLimitExceeded({ scope: "admin_import_commit", ip: resolveClientIp(c), keyHint: "user_event" });
      return deny(c);
    }
    await next();
  };
}

/** Rate-limit template preview (MJML compile) per admin user and event. */
export function createAdminTemplatePreviewRateLimit(store: RateLimitStore) {
  const max = 20;
  return async (c: Context, next: Next): Promise<Response | void> => {
    const { allowed } = await store.hit(userEventKey(c, "template-preview"), HEAVY_OPS_WINDOW_MS, max);
    if (!allowed) {
      logRateLimitExceeded({ scope: "admin_template_preview", ip: resolveClientIp(c), keyHint: "user_event" });
      return deny(c);
    }
    await next();
  };
}
