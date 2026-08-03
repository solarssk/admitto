import { hostname } from "node:os";
import type { Context, Next } from "hono";
import { routePath } from "hono/route";
import { logRateLimitExceeded, type RateLimitScope } from "@admitto/auth";
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
  logOnExceeded?: {
    scope: RateLimitScope;
    keyHint?: string | ((c: Context) => string | undefined);
  };
  /** When present and returns false, this check is skipped (e.g. global resend for authed users only). */
  when?: (c: Context) => boolean;
}

/** Declarative rate-limit definition — one or more checks must all pass (AND). */
export interface RatePolicy {
  checks: RateLimitCheck[];
  beforeCheck?: (c: Context) => Response | void;
  failOpenOnStoreError?: boolean;
}

/** Sliding-window limits for inline helpers (dual-key, dynamic key, custom 429 body) — not middleware. */
export interface InlineRateLimit {
  windowMs: number;
  max: number;
}

/**
 * Limits consumed only by inline rate-limit helpers, not {@link rateLimit} middleware.
 * Kept separate so these names are excluded from {@link RatePolicyName} at compile time.
 */
export const INLINE_RATE_LIMITS = {
  "oidc:link-stepup": { windowMs: 60_000, max: 10 },
  "auth:login-email": { windowMs: 60_000, max: 10 },
  "mfa:verify-totp": { windowMs: 15 * 60_000, max: 10 },
  "mfa:verify-recovery": { windowMs: 15 * 60_000, max: 30 },
  "mfa:enroll": { windowMs: 15 * 60_000, max: 10 },
} as const satisfies Record<string, InlineRateLimit>;

export type InlineRateLimitName = keyof typeof INLINE_RATE_LIMITS;

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

function checkinRateLimitKeyHint(c: Context): "ip" | "user" {
  return c.get("checkinAuth") === "bearer" ? "ip" : "user";
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
        logOnExceeded: { scope: "admin_mail_transport_test" },
      },
    ],
  },
  /** On-demand live health probes (Nominatim / OIDC) from Settings → Health check. */
  "admin:health-live": {
    checks: [
      {
        keyOf: (c) => `admin:health-live:user:${c.get("auth").userId}`,
        windowMs: 60_000,
        max: 5,
        logOnExceeded: { scope: "admin_health_live" },
      },
    ],
  },
  "admin:event-mail-transport-test": {
    checks: [
      {
        keyOf: (c) => `admin:event-mail-transport-test:user:${c.get("auth").userId}`,
        windowMs: 60_000,
        max: 5,
        logOnExceeded: { scope: "admin_event_mail_transport_test" },
      },
    ],
  },
  "admin:export": {
    checks: [
      {
        keyOf: (c) => `admin:export:user:${c.get("auth").userId}:route:${routePath(c)}`,
        windowMs: 3_600_000,
        max: 10,
        logOnExceeded: { scope: "admin_export", keyHint: "user_route" },
      },
    ],
  },
  "admin:export-pii": {
    checks: [
      {
        keyOf: (c) => `admin:export:user:${c.get("auth").userId}:route:${routePath(c)}`,
        windowMs: 3_600_000,
        max: 5,
        logOnExceeded: { scope: "admin_export_pii", keyHint: "user_route" },
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
  "admin:attendees-search": {
    checks: [
      {
        keyOf: (c) => adminUserEventKey(c, "attendees-search"),
        windowMs: 60_000,
        max: 120,
        logOnExceeded: { scope: "admin_attendees_search", keyHint: "user_event" },
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
  /** Nominatim's Usage Policy caps at 1 request/second for the whole deployment, not per
   * user — hence a single shared global key, plus a lighter per-user check so one admin
   * mashing "Find on map" can't eat the entire global budget alone. */
  "admin:geocoding-search": {
    // Per-user API budget only. Nominatim's ≤1 req/s Usage Policy is enforced inside
    // `NominatimProvider` around real upstream calls so Redis cache hits (and the common
    // search-then-reverse enrich path) are not rejected with 429 before the provider runs.
    checks: [
      {
        keyOf: (c) => `admin:geocoding-search:user:${c.get("auth").userId}`,
        windowMs: 60_000,
        max: 40,
        onExceeded: (c) => c.json({ error: "geocoding_rate_limited" }, 429),
        logOnExceeded: { scope: "admin_geocoding_search", keyHint: "user" },
      },
    ],
  },
  // Offline geo-tz only — no Nominatim budget; still bound per staff user.
  "admin:geocoding-timezone": {
    checks: [
      {
        keyOf: (c) => `admin:geocoding-timezone:user:${c.get("auth").userId}`,
        windowMs: 60_000,
        max: 60,
        onExceeded: (c) => c.json({ error: "geocoding_rate_limited" }, 429),
        logOnExceeded: { scope: "admin_geocoding_timezone", keyHint: "user" },
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
        logOnExceeded: { scope: "admin_resend", keyHint: "user_attendee" },
      },
      {
        when: (c) => Boolean(authUserId(c)),
        keyOf: (c) => `admin:resend:global:user:${authUserId(c)!}`,
        windowMs: 3_600_000,
        max: 30,
        onExceeded: (c) => c.json({ error: "resend_global_limit" }, 429),
        logOnExceeded: { scope: "admin_resend", keyHint: "user_global" },
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
        logOnExceeded: { scope: "admin_resend_bulk", keyHint: "user" },
      },
    ],
  },
  "checkin:scan": {
    checks: [
      {
        keyOf: (c) => checkinRateLimitKey(c, "scan"),
        windowMs: 60_000,
        max: 120,
        logOnExceeded: { scope: "checkin_scan", keyHint: checkinRateLimitKeyHint },
      },
    ],
  },
  "checkin:history": {
    checks: [
      {
        keyOf: (c) => checkinRateLimitKey(c, "history"),
        windowMs: 60_000,
        max: 180,
        logOnExceeded: { scope: "checkin_history", keyHint: checkinRateLimitKeyHint },
      },
    ],
  },
  "checkin:stream": {
    checks: [
      {
        keyOf: (c) => checkinRateLimitKey(c, "stream"),
        windowMs: 60_000,
        max: 12,
        logOnExceeded: { scope: "checkin_stream", keyHint: checkinRateLimitKeyHint },
      },
    ],
  },
} as const satisfies Record<string, RatePolicy>;

export type RatePolicyName = keyof typeof RATE_POLICIES;

/** Result of evaluating one {@link RateLimitCheck} against the store. */
type CheckOutcome =
  | { kind: "skip" }
  | { kind: "pass" }
  | { kind: "fail-open" }
  | { kind: "blocked"; response: Response };

/**
 * Evaluate a single check: honor `when`, hit the store, and classify the result.
 * Extracted from {@link rateLimit} to keep the middleware loop's cognitive complexity low.
 */
async function runCheck(
  store: RateLimitStore,
  check: RateLimitCheck,
  c: Context,
  options: RateLimitContext | undefined,
  policyName: RatePolicyName,
  failOpenOnStoreError: boolean | undefined,
): Promise<CheckOutcome> {
  if (check.when && !check.when(c)) return { kind: "skip" };

  const key = check.keyOf(c, options);
  let allowed = true;
  try {
    ({ allowed } = await store.hit(key, check.windowMs, check.max));
  } catch (err) {
    if (failOpenOnStoreError) {
      console.error(`${policyName} rate-limit store hit failed:`, err);
      return { kind: "fail-open" };
    }
    throw err;
  }

  if (!allowed) {
    if (check.logOnExceeded) {
      logRateLimitExceeded({
        scope: check.logOnExceeded.scope,
        ip: resolveClientIp(c),
        keyHint:
          typeof check.logOnExceeded.keyHint === "function"
            ? check.logOnExceeded.keyHint(c)
            : check.logOnExceeded.keyHint,
      });
    }
    return { kind: "blocked", response: check.onExceeded ? check.onExceeded(c) : jsonTooManyRequests(c) };
  }

  return { kind: "pass" };
}

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
      const outcome = await runCheck(
        store,
        check,
        c,
        options,
        policyName,
        policy.failOpenOnStoreError,
      );
      if (outcome.kind === "skip") continue;
      if (outcome.kind === "fail-open") {
        await next();
        return;
      }
      if (outcome.kind === "blocked") return outcome.response;
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
  const { windowMs, max } = INLINE_RATE_LIMITS["oidc:link-stepup"];
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
