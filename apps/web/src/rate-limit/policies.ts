import { hostname } from "node:os";
import { createHmac } from "node:crypto";
import type { Context, Next } from "hono";
import { routePath } from "hono/route";
import { logRateLimitExceeded, type RateLimitScope } from "@admitto/auth";
import { getEncryptionKey } from "@admitto/crypto";
import { resolveClientIp } from "./client-ip.js";
import { MAX_REQUESTS, WINDOW_MS } from "./constants.js";
import type { RateLimitStore } from "./types.js";

/** Optional context passed into {@link rateLimit} (e.g. healthz per-replica id). */
export interface RateLimitContext {
  instanceId?: string;
}

/** One fixed-window bucket within a {@link RatePolicy}. */
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

/** Fixed-window limits for inline helpers (dual-key, dynamic key, custom 429 body) — not middleware. */
export interface InlineRateLimit {
  windowMs: number;
  max: number;
}

/** Shared shape for authenticated admin routes limited per user (5 / min by default). */
function authUserScopedPolicy(
  keyPrefix: string,
  scope: RateLimitScope,
  max = 5,
  windowMs = 60_000,
): RatePolicy {
  return {
    checks: [
      {
        keyOf: (c) => `${keyPrefix}:user:${c.get("auth").userId}`,
        windowMs,
        max,
        logOnExceeded: { scope },
      },
    ],
  };
}

/** Shared shape for anonymous routes limited per client IP. */
function ipScopedPolicy(
  keyPrefix: string,
  scope: RateLimitScope,
  max: number,
  windowMs = 60_000,
): RatePolicy {
  return {
    checks: [
      {
        keyOf: (c) => `${keyPrefix}:ip:${resolveClientIp(c)}`,
        windowMs,
        max,
        logOnExceeded: { scope },
      },
    ],
  };
}

/**
 * Limits consumed only by inline rate-limit helpers, not {@link rateLimit} middleware.
 * Kept separate so these names are excluded from {@link RatePolicyName} at compile time.
 */
export const INLINE_RATE_LIMITS = {
  "oidc:link-stepup": { windowMs: 60_000, max: 10 },
  "auth:login-email": { windowMs: 60_000, max: 10 },
  "mfa:verify-totp": { windowMs: 15 * 60_000, max: 10 },
  "mfa:verify-recovery": { windowMs: 15 * 60_000, max: 10 },
  "mfa:verify-webauthn": { windowMs: 15 * 60_000, max: 10 },
  "mfa:step-up-total": { windowMs: 15 * 60_000, max: 20 },
  "mfa:enroll": { windowMs: 15 * 60_000, max: 10 },
  "account:password-check": { windowMs: 60_000, max: 10 },
  "mail:test-recipient": { windowMs: 3_600_000, max: 5 },
} as const satisfies Record<string, InlineRateLimit>;

export type InlineRateLimitName = keyof typeof INLINE_RATE_LIMITS;

export type CheckinRateLimitKind = "scan" | "history" | "stream";

function jsonTooManyRequests(c: Context): Response {
  return c.json({ error: "too many requests" }, 429);
}

function authUserId(c: Context): string | undefined {
  return c.get("auth")?.userId;
}

/** Per-actor-per-:paramName key for a route gated behind an auth middleware that always
 * populates c.get("auth") before this runs (staffAdminGate/requireAdminAccess) - unlike
 * adminUserEventKey, no IP fallback: there's no way to reach this middleware unauthenticated. */
function adminUserTargetKey(c: Context, scope: string, paramName: string): string {
  return `admin:${scope}:user:${c.get("auth").userId}:target:${c.req.param(paramName)}`;
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

/** Shared shape for a per-user-per-event polling GET (job-status endpoints, ~2s interval) -
 * factored out once a third near-identical entry (wallet-message-job-status, alongside
 * import-job-status and wallet-push-job-status) would otherwise token-duplicate the other two,
 * tripping SonarCloud's new-code duplication gate. */
function pollingJobStatusPolicy(scope: RateLimitScope, keyHint: string): RatePolicy {
  return {
    checks: [
      {
        keyOf: (c) => adminUserEventKey(c, keyHint),
        windowMs: 60_000,
        max: 120,
        logOnExceeded: { scope, keyHint: "user_event" },
      },
    ],
  };
}

/** "stream" is scoped per event, not just per operator: the SSE stream is one long-lived
 * connection per event an operator has open (Check-in/Overview/Reports all watch the same
 * event's stream), unlike "scan"/"history" which are short bursty requests an operator can
 * fire across many events in a session. A global-per-user budget meant an operator with
 * check-in open for one event (whose stream reconnects periodically - proxy idle timeouts,
 * network blips) could exhaust the whole account's stream budget and see 429s on a completely
 * different event/tab that never itself made excess requests (PO report). */
function checkinRateLimitKey(c: Context, kind: CheckinRateLimitKind): string {
  const eventSuffix = kind === "stream" ? `:event:${c.req.param("eventId")}` : "";
  if (c.get("checkinAuth") === "bearer") {
    return `checkin:${kind}:bearer:ip:${resolveClientIp(c)}${eventSuffix}`;
  }
  const userId = c.get("operatorUserId") as string | undefined;
  if (userId) return `checkin:${kind}:user:${userId}${eventSuffix}`;
  return `checkin:${kind}:ip:${resolveClientIp(c)}${eventSuffix}`;
}

function checkinRateLimitKeyHint(c: Context): "ip" | "user" {
  return c.get("checkinAuth") === "bearer" ? "ip" : "user";
}

/** Actor-wide ceiling alongside "stream"'s own per-event key above - without this, an actor
 * could mint an unbounded number of fresh per-event budgets simply by varying :eventId, since
 * under emergency Bearer auth the event-scope gate deliberately allows an unknown/made-up event
 * id through (assertEventNotArchived has nothing to check against). This keeps the per-event
 * isolation for the legitimate multi-tab/multi-page case while still bounding one actor's total
 * stream-request volume overall, same as the plain per-actor key this policy used before event
 * scoping (bot review). Its own "stream" prefix (not shared with "scan"/"history") keeps this
 * counter in its own namespace rather than colliding with either of those policies' keys. */
function checkinStreamActorKey(c: Context): string {
  if (c.get("checkinAuth") === "bearer") {
    return `checkin:stream:bearer:ip:${resolveClientIp(c)}`;
  }
  const userId = c.get("operatorUserId") as string | undefined;
  if (userId) return `checkin:stream:user:${userId}`;
  return `checkin:stream:ip:${resolveClientIp(c)}`;
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
  "ops:system-logs": {
    checks: [
      {
        keyOf: (c) => `ops:system-logs:ip:${resolveClientIp(c)}`,
        windowMs: 60_000,
        max: 120,
        onExceeded: (c) => c.body(null, 429),
        logOnExceeded: { scope: "ops-system-logs" },
      },
    ],
  },
  /** PassCreator webhook deliveries. Two checks (both must pass): per-event, since PassCreator's
   * own servers (not the attendee's browser) are the caller and retryEnabled means one event's
   * bursts must not throttle another's; and per-IP, since :eventId is an unauthenticated,
   * caller-controlled path segment - without this second check, rotating fake event ids gets a
   * fresh 120-request allowance every time and the per-event check alone bounds nothing. The IP
   * ceiling is deliberately generous (matches PassCreator's own documented 600 req/min outbound
   * limit, ADR 0041 §3) so a real instance's legitimate multi-event traffic from PassCreator's
   * servers is never the thing that trips it. */
  "wallet:webhook": {
    checks: [
      {
        keyOf: (c) => `wallet:webhook:event:${c.req.param("eventId") ?? "unknown"}`,
        windowMs: 60_000,
        max: 120,
        onExceeded: (c) => c.body(null, 429),
        logOnExceeded: { scope: "wallet_webhook" },
      },
      {
        keyOf: (c) => `wallet:webhook:ip:${resolveClientIp(c)}`,
        windowMs: 60_000,
        max: 600,
        onExceeded: (c) => c.body(null, 429),
        logOnExceeded: { scope: "wallet_webhook" },
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
  /** Own buckets, deliberately separate from auth:login-ip: a passkey-login round trip has no
   * email to also throttle per-account against (unlike the password route's
   * checkLoginEmailRateLimit), so this is the only defense-in-depth layer this ceremony gets
   * against an IP hammering it with junk assertions. Begin and finish are separate buckets
   * rather than one shared one - a shared bucket meant every successful sign-in spent 2 of its
   * 10 hits (a cancelled/retried ceremony spent more), so a handful of staff signing in behind
   * the same office/VPN/NAT address within a minute could lock everyone else out even with
   * every ceremony succeeding (Codex P2 review, PR #1108). */
  "auth:passkey-login-begin-ip": ipScopedPolicy("auth:passkey-login-begin", "passkey_login_ip", 10),
  "auth:passkey-login-finish-ip": ipScopedPolicy("auth:passkey-login-finish", "passkey_login_ip", 10),
  /** Whole /api/account/* route group - own IP bucket, deliberately separate from
   * auth:login-ip. These routes run before requireSession (some pre-date the current
   * caller's session even being established), so without their own bucket a handful of
   * cheap, credential-free requests here would drain the same IP's budget for the public
   * login route (or vice versa) - a shared office/VPN egress address then locks every
   * legitimate user behind it out of login. Higher than auth:login-ip's 10/60s: this bucket
   * covers every /api/account/* request from one IP, not just one sensitive action - a single
   * My Account page load alone fires 3 GETs (account, sessions, backup-codes status), and the
   * WebAuthn stack added several more legitimate sub-requests per MFA action (register/begin,
   * register/finish, assert/begin, credential list), so 10/min was tripping on ordinary
   * back-to-back account/MFA management, not just abuse. */
  "auth:account-ip": {
    checks: [
      {
        keyOf: (c) => `auth:account:ip:${resolveClientIp(c)}`,
        windowMs: 60_000,
        max: 30,
        logOnExceeded: { scope: "account_ip" },
      },
    ],
  },
  // Routes with no :id (test, discover-preview, cf-access/test, and the create route) fall back
  // to routePath(c) rather than a shared "unknown" literal - otherwise four functionally
  // unrelated actions (including a Cloudflare Access probe that isn't even OIDC) would compete
  // for one budget, and routine iterative setup (discover, test, adjust, test again) could
  // exhaust the limit an admin needs for the create action itself.
  "admin:oidc-provider-ops": {
    checks: [
      {
        keyOf: (c) => {
          const providerId = c.req.param("id") ?? routePath(c);
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
  // Burst (unchanged) + sustained, same two-check shape as admin:resend's burst+global pair
  // above. The burst bucket alone allows iterating a template (edit, test, edit, test, ...)
  // without waiting between sends, but also allows up to 300 test emails/hour indefinitely if
  // just left running - the sustained bucket caps that without touching normal iteration speed.
  // A separate, recipient-scoped budget (see checkMailTestRecipientRateLimit) applies on top of
  // both, checked in the handler once the recipient address is known.
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
        logOnExceeded: { scope: "admin_test_send", keyHint: "burst" },
      },
      {
        keyOf: (c) => {
          const eventId = c.req.param("eventId")!;
          const userId = authUserId(c);
          return userId
            ? `admin:test-send:sustained:user:${userId}:event:${eventId}`
            : `admin:test-send:sustained:ip:${resolveClientIp(c)}:event:${eventId}`;
        },
        windowMs: 3_600_000,
        max: 20,
        logOnExceeded: { scope: "admin_test_send", keyHint: "sustained" },
      },
    ],
  },
  // Burst + sustained, same shape as admin:test-send above but tighter on both numbers: this
  // dials a real SMTP/Graph transport (DNS resolution, TLS handshake, possibly a bounce-verify
  // round trip) rather than rendering a template, so it is more expensive per call, and no
  // legitimate workflow needs more than a handful of connectivity checks in a row. Same
  // recipient-scoped budget as admin:test-send applies on top, shared across both this and
  // admin:event-mail-transport-test below (see checkMailTestRecipientRateLimit).
  "admin:mail-transport-test": {
    checks: [
      {
        keyOf: (c) => `admin:mail-transport-test:user:${c.get("auth").userId}`,
        windowMs: 60_000,
        max: 3,
        logOnExceeded: { scope: "admin_mail_transport_test", keyHint: "burst" },
      },
      {
        keyOf: (c) => `admin:mail-transport-test:sustained:user:${c.get("auth").userId}`,
        windowMs: 3_600_000,
        max: 10,
        logOnExceeded: { scope: "admin_mail_transport_test", keyHint: "sustained" },
      },
    ],
  },
  // Organization-level SMTP/Graph connectivity probe (/mail-settings/probe) - shares no bucket
  // with admin:mail-transport-test above. It never sends mail to an address (so it never reaches
  // checkMailTestRecipientRateLimit either), so tightening or adding an hourly cap to the actual
  // test-send route must not also throttle this unrelated diagnostic (bot review on this PR:
  // both used to share one policy, so 10 probes/hour would have exhausted the test-send route's
  // own new sustained budget too). Same 5/min single-check shape this route always had.
  "admin:mail-diagnostics": authUserScopedPolicy("admin:mail-diagnostics", "admin_mail_diagnostics"),
  /** Settings → External services' weather connectivity probe - same "no ceiling on a live
   * outbound call" shape as the mail-transport/diagnostics probes above, and openmeteo's baseUrl
   * is caller-supplied, so this also bounds how often an admin can point it at an arbitrary host. */
  "admin:weather-test": authUserScopedPolicy("admin:weather-test", "admin_weather_test"),
  /** On-demand live health probes (Nominatim / OIDC) from Settings → Health check. */
  "admin:health-live": {
    checks: [
      {
        keyOf: (c) => `admin:health-live:user:${c.get("auth").userId}`,
        windowMs: 60_000,
        max: 5,
        onExceeded: (c) => c.json({ error: "health_live_rate_limited" }, 429),
        logOnExceeded: { scope: "admin_health_live" },
      },
    ],
  },
  // Same burst+sustained shape and reasoning as admin:mail-transport-test above, just scoped to
  // the event-level test endpoint's own user-keyed bucket.
  "admin:event-mail-transport-test": {
    checks: [
      {
        keyOf: (c) => `admin:event-mail-transport-test:user:${c.get("auth").userId}`,
        windowMs: 60_000,
        max: 3,
        logOnExceeded: { scope: "admin_event_mail_transport_test", keyHint: "burst" },
      },
      {
        keyOf: (c) => `admin:event-mail-transport-test:sustained:user:${c.get("auth").userId}`,
        windowMs: 3_600_000,
        max: 10,
        logOnExceeded: { scope: "admin_event_mail_transport_test", keyHint: "sustained" },
      },
    ],
  },
  // Event-level SMTP/Graph probe and bounce-ingest connectivity test/manual-run - same reasoning
  // as admin:mail-diagnostics above: none of these three routes sends mail to an address, so they
  // must not share admin:event-mail-transport-test's tightened burst or new hourly budget.
  "admin:event-mail-diagnostics": authUserScopedPolicy(
    "admin:event-mail-diagnostics",
    "admin_event_mail_diagnostics",
  ),
  /** Client-reported errors/CSP violations - the one source meant to fire from an uncontrolled
   * browser-side condition (e.g. a misbehaving extension retrying a blocked mutation), so it
   * needs a ceiling other click-driven admin endpoints don't. Deliberately has no logOnExceeded:
   * logging every rejected request here would just swap the log flood this ceiling exists to
   * stop for an equally unbounded stream of rate-limit-exceeded log lines instead. */
  "admin:client-error": {
    checks: [
      {
        keyOf: (c) => `admin:client-error:user:${c.get("auth").userId}`,
        windowMs: 60_000,
        max: 30,
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
  /** Polling GET …/import/jobs/:jobId (~2s interval); same budget class as attendees search. */
  "admin:import-job-status": {
    checks: [
      {
        keyOf: (c) => adminUserEventKey(c, "import-job-status"),
        windowMs: 60_000,
        max: 120,
        logOnExceeded: { scope: "admin_import_job_status", keyHint: "user_event" },
      },
    ],
  },
  /** Polling GET …/wallet-push/jobs/:jobId - same ~2s interval and budget as import-job-status. */
  "admin:wallet-push-job-status": {
    checks: [
      {
        keyOf: (c) => adminUserEventKey(c, "wallet-push-job-status"),
        windowMs: 60_000,
        max: 120,
        logOnExceeded: { scope: "admin_wallet_push_job_status", keyHint: "user_event" },
      },
    ],
  },
  /** Polling GET …/wallet-message/jobs/:jobId - same budget class as wallet-push-job-status. */
  "admin:wallet-message-job-status": pollingJobStatusPolicy(
    "admin_wallet_message_job_status",
    "wallet-message-job-status",
  ),
  /** Polling GET …/wallet-refresh-status/jobs/:jobId - same budget class as
   * wallet-push-job-status. */
  "admin:wallet-refresh-status-job-status": pollingJobStatusPolicy(
    "admin_wallet_refresh_status_job_status",
    "wallet-refresh-status-job-status",
  ),
  /** POST …/wallet-message/send handles both dry-run (recipient count) and the real send -
   * dry-run is exempted via skipWalletMessageRateLimitForDryRun so adjusting filters while
   * composing stays responsive; the real send itself is tightly bounded. Less strict than mail's
   * admin:resend-bulk (3/10min) since a wallet push carries no email deliverability/spam-
   * reputation risk, but still bounded against accidental or abusive repeat sends. */
  "admin:wallet-message-send": {
    checks: [
      {
        when: (c) => c.get("walletMessageDryRun") !== true,
        keyOf: (c) => adminUserEventKey(c, "wallet-message-send"),
        windowMs: 600_000,
        max: 10,
        logOnExceeded: { scope: "admin_wallet_message_send", keyHint: "user_event" },
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
  // Per-attendee, not per-event or per-route: bounds how fast one admin can loop PATCH requests
  // against a single attendee, which is what a scripted resubmit-to-trigger-a-wallet-push abuse
  // pattern would target (bot review, PR3) - a real admin editing several different attendees in
  // a burst never approaches this. 20/min is generous for legitimate back-to-back corrections on
  // the same record, tight enough that a scripted loop hits it almost immediately.
  "admin:attendee-patch": {
    checks: [
      {
        keyOf: (c) => {
          const attendeeId = c.req.param("id");
          const userId = authUserId(c);
          return userId
            ? `admin:attendee-patch:user:${userId}:attendee:${attendeeId}`
            : `admin:attendee-patch:ip:${resolveClientIp(c)}:attendee:${attendeeId}`;
        },
        windowMs: 60_000,
        max: 20,
        logOnExceeded: { scope: "admin_attendee_patch", keyHint: "user_attendee" },
      },
    ],
  },
  // Per-target-user, not per-actor: bounds how fast one admin can loop this against a single
  // account, matching admin:attendee-patch's reasoning above - a real admin force-logging-out
  // several different accounts in a row never approaches this, unlike a scripted repeat against
  // one target. Sibling reset-password/reset-2fa additionally require actor step-up re-auth when
  // the target is another superadmin (see actorMustStepUpForReset in users-routes.ts) - this
  // route now requires the same, so the rate limit is defense-in-depth, not the only ceiling.
  "admin:user-revoke-sessions": {
    checks: [
      {
        keyOf: (c) => adminUserTargetKey(c, "user-revoke-sessions", "id"),
        windowMs: 60_000,
        max: 10,
        logOnExceeded: { scope: "admin_user_revoke_sessions", keyHint: "user_target" },
      },
    ],
  },
  // Every single-attendee wallet/void|restore|reissue|delete route calls the live PassCreator API
  // once per request - same abuse pattern as admin:wallet-message-send above ("a scripted
  // resubmit-to-trigger-a-wallet-push abuse pattern"), just covering the wallet lifecycle actions
  // instead of the wallet message send. 10/min, loosened from the original 10/10min: that number
  // predated `PASSCREATOR_MIN_CALL_INTERVAL_MS`/the distributed pace gate (see
  // `admin:wallet-action-bulk` below), which is now the layer actually protecting PassCreator's
  // account-wide limit - at 10 calls/min this route alone stays nowhere near that budget even
  // before pacing kicks in, so the HTTP-level number can bound scripted abuse instead of ordinary
  // multi-attendee manual corrections (void Jan, restore Anna, reissue Piotr, ...). Bulk wallet
  // actions get their own, much stricter policy below: a single bulk request can fan out to many
  // more provider calls than one single-attendee request, so sharing this budget with them would
  // still let a scripted attacker fire far more provider traffic than this number implies.
  "admin:wallet-action": {
    checks: [
      {
        keyOf: (c) => adminUserEventKey(c, "wallet-action"),
        windowMs: 60_000,
        max: 10,
        logOnExceeded: { scope: "admin_wallet_action", keyHint: "user_event" },
      },
    ],
  },
  // Every bulk route that can cascade to one PassCreator call per selected attendee: the 3
  // explicit bulk-wallet-* routes always do, and bulk-delete / bulk-revoke-pass do too whenever
  // the selection includes attendees with a wallet pass (deleteWalletPassesBestEffort /
  // syncWalletPassOnStatusChangeBestEffort - bot review, PR #1064 round 2: these two shared only
  // the generic admin:attendee-bulk-mutation budget below, which doesn't account for the
  // PassCreator calls they can trigger). Every route in this group is capped at
  // WALLET_BULK_SEND_LIMIT (100) attendees per request once wallet is in play (see
  // attendees-api-routes.ts) - not the general BULK_SEND_LIMIT (500) the same routes fall back to
  // when wallet isn't configured. So 10 requests/10min bounds worst case to 1,000 provider
  // calls/10min = 100/min, comfortably under both PassCreator's documented 600 req/min
  // account-wide limit (_ops/adr/0041-wallet-passcreator-api-contract.md) and the ~400/min
  // per-process ceiling `PASSCREATOR_MIN_CALL_INTERVAL_MS` already enforces on top of this.
  // Loosened from 3/10min: that number predated the pace gate existing at all, when this HTTP
  // limit was the only thing standing between a scripted loop and PassCreator's account limit; now
  // that the pace gate (local, and Redis-coordinated across `app`/`worker` processes) is the layer
  // actually bounding outbound call volume, this can afford to bound admin workflow instead - an
  // admin working through a 1,000-person event in batches of 100 no longer waits 10 minutes
  // between every 3rd batch.
  "admin:wallet-action-bulk": {
    checks: [
      {
        keyOf: (c) => adminUserEventKey(c, "wallet-action-bulk"),
        windowMs: 600_000,
        max: 10,
        logOnExceeded: { scope: "admin_wallet_action_bulk", keyHint: "user_event" },
      },
    ],
  },
  // Bulk-attendee mutation routes (bulk-delete, bulk-checkin, bulk-revoke-checkin,
  // bulk-revoke-items, bulk-revoke-pass, bulk-ticket-type, bulk-rsvp) - each request can touch up
  // to BULK_SEND_LIMIT (500) attendees at once, and bulk-delete alone is a hard
  // DELETE ... RETURNING with no undo. Same cost class/window as admin:attendee-patch (20/60s),
  // but keyed per user+event rather than per user+attendee: these routes act on many attendees in
  // one call, so there's no single attendee id to scope the bucket to.
  "admin:attendee-bulk-mutation": {
    checks: [
      {
        keyOf: (c) => adminUserEventKey(c, "attendee-bulk-mutation"),
        windowMs: 60_000,
        max: 20,
        logOnExceeded: { scope: "admin_attendee_bulk_mutation", keyHint: "user_event" },
      },
    ],
  },
  // Deliberately its own bucket, not shared with admin:attendee-bulk-mutation - that budget
  // (20/60s per user+event) is easily exhausted by routine bulk-checkin/bulk-revoke/bulk-rsvp
  // cleanup earlier in the same session, and this route is the one safety mechanism for damage
  // control on a bad send: it must not be blocked by unrelated bulk-attendee work. Generous
  // enough that a legitimate operator retry (e.g. after a transient network error) never trips
  // it, while still bounded.
  "admin:bulk-send-cancel": {
    checks: [
      {
        keyOf: (c) => adminUserEventKey(c, "bulk-send-cancel"),
        windowMs: 60_000,
        max: 30,
        logOnExceeded: { scope: "admin_bulk_send_cancel", keyHint: "user_event" },
      },
    ],
  },
  "admin:resend-bulk": {
    checks: [
      {
        when: (c) => c.get("bulkSendDryRun") !== true,
        keyOf: (c) => {
          const userId = authUserId(c);
          return userId
            ? `admin:resend:bulk:user:${userId}`
            : `admin:resend:bulk:ip:${resolveClientIp(c)}`;
        },
        windowMs: 600_000,
        max: 3,
        onExceeded: (c) =>
          c.json(
            {
              error: "bulk_send_rate_limited",
              detail: "Bulk sends are limited to 3 requests every 10 minutes. Try again later.",
            },
            429,
          ),
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
      {
        keyOf: checkinStreamActorKey,
        windowMs: 60_000,
        max: 48,
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

/**
 * Throttle a sensitive re-auth check (OIDC link step-up password, account current-password
 * verification) per user and IP (inline, not middleware). The user-scoped bucket is the
 * load-bearing one: it stays fixed to the account being attacked regardless of which IP the
 * request comes from, so an attacker holding a stolen session cookie can't outrun it by rotating
 * source IPs. The IP-scoped bucket is defense-in-depth on top of that.
 */
async function checkReauthRateLimit(
  store: RateLimitStore,
  keyPrefix: string,
  limitName: InlineRateLimitName,
  scope: RateLimitScope,
  userId: string,
  ip: string,
): Promise<boolean> {
  const { windowMs, max } = INLINE_RATE_LIMITS[limitName];
  const userResult = await store.hit(`${keyPrefix}:user:${userId}`, windowMs, max);
  if (!userResult.allowed) {
    logRateLimitExceeded({ scope, ip, keyHint: "user" });
    return false;
  }
  const ipResult = await store.hit(`${keyPrefix}:ip:${ip}`, windowMs, max);
  if (!ipResult.allowed) {
    logRateLimitExceeded({ scope, ip, keyHint: "ip" });
    return false;
  }
  return true;
}

/** Throttle OIDC link step-up password attempts per user and IP (inline, not middleware). */
export async function checkOidcLinkStepUpRateLimit(
  store: RateLimitStore,
  userId: string,
  ip: string,
): Promise<boolean> {
  return checkReauthRateLimit(
    store,
    "oidc:link:stepup",
    "oidc:link-stepup",
    "oidc_link_stepup",
    userId,
    ip,
  );
}

/** Throttle current-password verification on account/step-up endpoints (password change, MFA
 * reset, SSO unlink) per user and IP (inline, not middleware) - same shape as
 * {@link checkOidcLinkStepUpRateLimit}, see {@link checkReauthRateLimit}. */
export async function checkAccountPasswordRateLimit(
  store: RateLimitStore,
  userId: string,
  ip: string,
): Promise<boolean> {
  return checkReauthRateLimit(
    store,
    "account:password-check",
    "account:password-check",
    "account_password_check",
    userId,
    ip,
  );
}

/** Deterministic, keyed (HMAC-SHA256) tag for a normalized recipient address - never the address
 * itself - so the address is not the rate-limit store's problem to protect. Redis keys are
 * visible in plaintext to anything with read access to that instance (MONITOR, KEYS/SCAN,
 * RDB/AOF snapshots and backups, replica streams, slow logs); an unkeyed hash alone would still
 * let anyone with that access enumerate a target list of common/likely addresses offline and
 * match them against observed keys, which HMAC's server-side secret prevents. Keyed with the
 * app's existing {@link getEncryptionKey}, domain-separated by prefixing the input (not deriving
 * a new key) - the standard, safe way to reuse one HMAC key for more than one purpose without a
 * key-derivation step this codebase doesn't otherwise have. */
function hashRecipientForRateLimit(recipientEmail: string): string {
  return createHmac("sha256", getEncryptionKey())
    .update(`mail-test-recipient:${recipientEmail.toLowerCase()}`)
    .digest("hex");
}

/** Throttle test-send / mail-transport-test emails per recipient address, globally across the
 * whole instance rather than per user, event, or endpoint (inline, not middleware - the recipient
 * is only known once the handler has parsed the request body, after the per-user/event middleware
 * checks above have already run). The three routes that actually send to an external address
 * (admin:test-send's two variants, admin:mail-transport-test's and
 * admin:event-mail-transport-test's own /mail-settings/test routes - not their sibling
 * connectivity-probe/bounce-ingest routes, which have their own separate policies and never call
 * this check) share this same budget, so a compromised admin session can't round-robin between
 * them, or between events/accounts, to send far more test mail to one external address than any
 * single per-user bucket implies. Exported for direct unit testing; call sites should generally
 * use {@link guardMailTestRecipientRateLimit} instead. */
export async function checkMailTestRecipientRateLimit(
  store: RateLimitStore,
  recipientEmail: string,
  ip: string | undefined,
): Promise<boolean> {
  const { windowMs, max } = INLINE_RATE_LIMITS["mail:test-recipient"];
  const key = `mail:test-recipient:${hashRecipientForRateLimit(recipientEmail)}`;
  const result = await store.hit(key, windowMs, max);
  if (!result.allowed) {
    logRateLimitExceeded({ scope: "admin_mail_test_recipient", ip, keyHint: "recipient" });
    return false;
  }
  return true;
}

/** {@link checkMailTestRecipientRateLimit} plus the "resolve IP, and on failure return the 429"
 * sequence every one of its 4 call sites needed identically (SonarCloud new-code duplication,
 * this PR). Returns the response to return immediately, or `null` to continue handling the
 * request normally. */
export async function guardMailTestRecipientRateLimit(
  c: Context,
  store: RateLimitStore,
  recipientEmail: string,
): Promise<Response | null> {
  const allowed = await checkMailTestRecipientRateLimit(store, recipientEmail, resolveClientIp(c));
  return allowed ? null : c.json({ error: "too many requests" }, 429);
}
