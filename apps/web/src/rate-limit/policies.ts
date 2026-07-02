import { hostname } from "node:os";
import type { Context, Next } from "hono";
import { routePath } from "hono/route";
import { logRateLimitExceeded, normalizeEmail, type RateLimitScope } from "@admitto/auth";
import { resolveClientIp } from "./client-ip.js";
import { MAX_REQUESTS, WINDOW_MS } from "./constants.js";
import type { RateLimitStore } from "./types.js";

/** Optional context passed into {@link rateLimit} (e.g. healthz per-replica id). */
export interface RateLimitContext {
  instanceId?: string;
}

/** One sliding-window bucket within a {@link RatePolicy}. */
export interface RateLimitCheck {
  keyOf: (c: Context, ctx?: RateLimitContext) => string;
  windowMs: number;
  max: number;
  onExceeded?: (c: Context) => Response;
  logOnExceeded?: { scope: RateLimitScope; keyHint?: string };
  /** When present and returns false, this check is skipped (e.g. global resend for authed users only). */
  when?: (c: Context) => boolean;
}

/** Declarative rate-limit definition — one or more checks must all pass (AND). */
export interface RatePolicy {
  checks: RateLimitCheck[];
  beforeCheck?: (c: Context) => Response | void;
  failOpenOnStoreError?: boolean;
}

export type CheckinRateLimitKind = "scan" | "history" | "stream";

function jsonTooManyRequests(c: Context): Response {
  return c.json({ error: "too many requests" }, 429);
}

function authUserId(c: Context): string | undefined {
  return c.get("auth")?.userId;
}

/** 1:1 from former admin-heavy-ops-rate-limit.ts — three branches when eventId missing. */
export function adminUserEventKey(c: Context, scope: string): string {
  const auth = c.get("auth");
  const eventId = c.req.param("eventId");
  if (!eventId) return `admin:${scope}:ip:${resolveClientIp(c)}`;
  const userId = auth?.userId;
  return userId
    ? `admin:${scope}:user:${userId}:event:${eventId}`
    : `admin:${scope}:ip:${resolveClientIp(c)}:event:${eventId}`;
}

function checkinRateLimitKey(c: Context, kind: CheckinRateLimitKind): string {
  if (c.get("checkinAuth") === "bearer") {
    return `checkin:${kind}:bearer:ip:${resolveClientIp(c)}`;
  }
  const userId = c.get("operatorUserId") as string | undefined;
  if (userId) return `checkin:${kind}:user:${userId}`;
  return `checkin:${kind}:ip:${resolveClientIp(c)}`;
}

function healthzRateLimitKey(ip: string, instanceId: string): string {
  return `ops:healthz:${instanceId}:ip:${ip}`;
}

/**
 * Central registry of rate-limit policies for apps/web.
 * Keys in Redis must stay bit-identical to pre-registry inline code (see keyOf helpers).
 */
export const RATE_POLICIES = {
  /** Public ticket/QR routes — key is bare client IP (no prefix). */
  "public:tq": {
    checks: [
      {
        keyOf: (c) => resolveClientIp(c),
        windowMs: WINDOW_MS,
        max: MAX_REQUESTS,
        onExceeded: (c) => c.text("Too Many Requests", 429),
        logOnExceeded: { scope: "public" },
      },
    ],
  },
  "ops:healthz": {
    failOpenOnStoreError: true,
    checks: [
      {
        keyOf: (c, ctx) => healthzRateLimitKey(resolveClientIp(c), ctx?.instanceId ?? hostname()),
        windowMs: 60_000,
        max: 120,
        logOnExceeded: { scope: "healthz" },
      },
    ],
  },
  "ops:readyz": {
    checks: [
      {
        keyOf: (c) => `ops:readyz:ip:${resolveClientIp(c)}`,
        windowMs: 60_000,
        max: 10,
        onExceeded: (c) => c.body(null, 429),
        logOnExceeded: { scope: "readyz" },
      },
    ],
  },
  "auth:oidc": {
    checks: [
      {
        keyOf: (c) => `auth:oidc:ip:${resolveClientIp(c)}`,
        windowMs: 60_000,
        max: 20,
        onExceeded: (c) => c.text("Too many requests", 429),
        logOnExceeded: { scope: "oidc_auth" },
      },
    ],
  },
  /** Inline-only — consumed by checkOidcLinkStepUpRateLimit (user + IP share limits), not rateLimit(). */
  "oidc:link-stepup": {
    checks: [{ keyOf: () => "", windowMs: 60_000, max: 10 }],
  },
  "auth:login-ip": {
    checks: [
      {
        keyOf: (c) => `auth:login:ip:${resolveClientIp(c)}`,
        windowMs: 60_000,
        max: 10,
        logOnExceeded: { scope: "login_ip" },
      },
    ],
  },
  /** Inline-only — consumed by checkLoginEmailRateLimit, not rateLimit(). */
  "auth:login-email": {
    checks: [{ keyOf: () => "", windowMs: 60_000, max: 10 }],
  },
  /** Inline-only — TOTP verify dual-key; consumed by checkMfaVerifyRateLimit. */
  "mfa:verify-totp": {
    checks: [{ keyOf: () => "", windowMs: 15 * 60_000, max: 10 }],
  },
  /** Inline-only — recovery verify dual-key; consumed by checkMfaVerifyRateLimit. */
  "mfa:verify-recovery": {
    checks: [{ keyOf: () => "", windowMs: 15 * 60_000, max: 30 }],
  },
  "admin:oidc-provider-ops": {
    checks: [
      {
        keyOf: (c) => {
          const providerId = c.req.param("id") ?? "unknown";
          const userId = authUserId(c);
          return userId
            ? `admin:oidc-provider-ops:user:${userId}:provider:${providerId}`
            : `admin:oidc-provider-ops:ip:${resolveClientIp(c)}:provider:${providerId}`;
        },
        windowMs: 60_000,
        max: 10,
        onExceeded: (c) => c.text("Too many requests", 429),
        logOnExceeded: { scope: "admin_oidc_provider_ops", keyHint: "user" },
      },
    ],
  },
  "admin:test-send": {
    beforeCheck: (c) => {
      if (!c.req.param("eventId")) return c.json({ error: "eventId required" }, 400);
    },
    checks: [
      {
        keyOf: (c) => {
          const eventId = c.req.param("eventId")!;
          const userId = authUserId(c);
          return userId
            ? `admin:test-send:user:${userId}:event:${eventId}`
            : `admin:test-send:ip:${resolveClientIp(c)}:event:${eventId}`;
        },
        windowMs: 60_000,
        max: 5,
      },
    ],
  },
  "admin:mail-transport-test": {
    checks: [
      {
        keyOf: (c) => `admin:mail-transport-test:user:${c.get("auth").userId}`,
        windowMs: 60_000,
        max: 5,
      },
    ],
  },
  "admin:export": {
    checks: [
      {
        keyOf: (c) => `admin:export:user:${c.get("auth").userId}:route:${routePath(c)}`,
        windowMs: 3_600_000,
        max: 10,
      },
    ],
  },
  "admin:export-pii": {
    checks: [
      {
        keyOf: (c) => `admin:export:user:${c.get("auth").userId}:route:${routePath(c)}`,
        windowMs: 3_600_000,
        max: 5,
      },
    ],
  },
  "admin:import-preview": {
    checks: [
      {
        keyOf: (c) => adminUserEventKey(c, "import-preview"),
        windowMs: 60_000,
        max: 10,
        logOnExceeded: { scope: "admin_import_preview", keyHint: "user_event" },
      },
    ],
  },
  "admin:import-commit": {
    checks: [
      {
        keyOf: (c) => adminUserEventKey(c, "import-commit"),
        windowMs: 60_000,
        max: 5,
        logOnExceeded: { scope: "admin_import_commit", keyHint: "user_event" },
      },
    ],
  },
  "admin:template-preview": {
    checks: [
      {
        keyOf: (c) => adminUserEventKey(c, "template-preview"),
        windowMs: 60_000,
        max: 20,
        logOnExceeded: { scope: "admin_template_preview", keyHint: "user_event" },
      },
    ],
  },
  "admin:resend": {
    beforeCheck: (c) => {
      if (!c.req.param("id")) return c.json({ error: "id required" }, 400);
    },
    checks: [
      {
        keyOf: (c) => {
          const attendeeId = c.req.param("id")!;
          const userId = authUserId(c);
          return userId
            ? `admin:resend:user:${userId}:attendee:${attendeeId}`
            : `admin:resend:ip:${resolveClientIp(c)}:attendee:${attendeeId}`;
        },
        windowMs: 60_000,
        max: 5,
      },
      {
        when: (c) => Boolean(authUserId(c)),
        keyOf: (c) => `admin:resend:global:user:${authUserId(c)!}`,
        windowMs: 3_600_000,
        max: 30,
        onExceeded: (c) => c.json({ error: "resend_global_limit" }, 429),
      },
    ],
  },
  "admin:resend-bulk": {
    checks: [
      {
        keyOf: (c) => {
          const userId = authUserId(c);
          return userId
            ? `admin:resend:bulk:user:${userId}`
            : `admin:resend:bulk:ip:${resolveClientIp(c)}`;
        },
        windowMs: 600_000,
        max: 3,
      },
    ],
  },
  "checkin:scan": {
    checks: [
      {
        keyOf: (c) => checkinRateLimitKey(c, "scan"),
        windowMs: 60_000,
        max: 120,
      },
    ],
  },
  "checkin:history": {
    checks: [
      {
        keyOf: (c) => checkinRateLimitKey(c, "history"),
        windowMs: 60_000,
        max: 180,
      },
    ],
  },
  "checkin:stream": {
    checks: [
      {
        keyOf: (c) => checkinRateLimitKey(c, "stream"),
        windowMs: 60_000,
        max: 12,
      },
    ],
  },
} as const satisfies Record<string, RatePolicy>;

export type RatePolicyName = keyof typeof RATE_POLICIES;

/**
 * Build Hono middleware from a named policy in {@link RATE_POLICIES}.
 * All checks in the policy must pass (AND). Redis keys come from each check's keyOf.
 */
export function rateLimit(
  store: RateLimitStore,
  policyName: RatePolicyName,
  options?: RateLimitContext,
) {
  const policy = RATE_POLICIES[policyName] as RatePolicy;
  return async (c: Context, next: Next): Promise<Response | void> => {
    if (policy.beforeCheck) {
      const early = policy.beforeCheck(c);
      if (early) return early;
    }

    for (const check of policy.checks) {
      if (check.when && !check.when(c)) continue;

      const key = check.keyOf(c, options);
      let allowed = true;
      try {
        ({ allowed } = await store.hit(key, check.windowMs, check.max));
      } catch (err) {
        if (policy.failOpenOnStoreError) {
          console.error(`${policyName} rate-limit store hit failed:`, err);
          await next();
          return;
        }
        throw err;
      }

      if (!allowed) {
        if (check.logOnExceeded) {
          logRateLimitExceeded({
            scope: check.logOnExceeded.scope,
            ip: resolveClientIp(c),
            keyHint: check.logOnExceeded.keyHint,
          });
        }
        return check.onExceeded ? check.onExceeded(c) : jsonTooManyRequests(c);
      }
    }

    await next();
  };
}

/** Rate-limit `/healthz` per replica — thin wrapper over ops:healthz policy. */
export function createHealthzRateLimitMiddleware(
  store: RateLimitStore,
  instanceId: string = hostname(),
) {
  return rateLimit(store, "ops:healthz", { instanceId });
}

/** Throttle OIDC link step-up password attempts per user and IP (inline, not middleware). */
export async function checkOidcLinkStepUpRateLimit(
  store: RateLimitStore,
  userId: string,
  ip: string,
): Promise<boolean> {
  const { windowMs, max } = RATE_POLICIES["oidc:link-stepup"].checks[0];
  const userResult = await store.hit(`oidc:link:stepup:user:${userId}`, windowMs, max);
  if (!userResult.allowed) {
    logRateLimitExceeded({ scope: "oidc_link_stepup", ip, keyHint: "user" });
    return false;
  }
  const ipResult = await store.hit(`oidc:link:stepup:ip:${ip}`, windowMs, max);
  if (!ipResult.allowed) {
    logRateLimitExceeded({ scope: "oidc_link_stepup", ip, keyHint: "ip" });
    return false;
  }
  return true;
}
