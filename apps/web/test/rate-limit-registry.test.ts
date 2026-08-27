import { describe, expect, it, vi } from "vitest";
import { INLINE_RATE_LIMITS, RATE_POLICIES } from "../src/rate-limit/policies.js";

vi.mock("@hono/node-server/conninfo", () => ({
  getConnInfo: vi.fn(() => ({ remote: { address: "127.0.0.1", port: 1234 } })),
}));

/** Regression guard — middleware policies: limits and check counts must match production wiring. */
const EXPECTED_POLICIES: Record<
  keyof typeof RATE_POLICIES,
  { windowMs: number[]; max: number[]; checks: number }
> = {
  "public:tq": { windowMs: [60_000], max: [500], checks: 1 },
  "ops:healthz": { windowMs: [60_000], max: [120], checks: 1 },
  "ops:readyz": { windowMs: [60_000], max: [10], checks: 1 },
  "ops:system-logs": { windowMs: [60_000], max: [120], checks: 1 },
  "wallet:webhook": { windowMs: [60_000, 60_000], max: [120, 600], checks: 2 },
  "auth:oidc": { windowMs: [60_000], max: [20], checks: 1 },
  "auth:login-ip": { windowMs: [60_000], max: [10], checks: 1 },
  "auth:passkey-login-ip": { windowMs: [60_000], max: [10], checks: 1 },
  "auth:account-ip": { windowMs: [60_000], max: [30], checks: 1 },
  "admin:oidc-provider-ops": { windowMs: [60_000], max: [10], checks: 1 },
  "admin:test-send": { windowMs: [60_000, 3_600_000], max: [5, 20], checks: 2 },
  "admin:mail-transport-test": { windowMs: [60_000, 3_600_000], max: [3, 10], checks: 2 },
  "admin:mail-diagnostics": { windowMs: [60_000], max: [5], checks: 1 },
  "admin:health-live": { windowMs: [60_000], max: [5], checks: 1 },
  "admin:weather-test": { windowMs: [60_000], max: [5], checks: 1 },
  "admin:event-mail-transport-test": { windowMs: [60_000, 3_600_000], max: [3, 10], checks: 2 },
  "admin:event-mail-diagnostics": { windowMs: [60_000], max: [5], checks: 1 },
  "admin:client-error": { windowMs: [60_000], max: [30], checks: 1 },
  "admin:export": { windowMs: [3_600_000], max: [10], checks: 1 },
  "admin:export-pii": { windowMs: [3_600_000], max: [5], checks: 1 },
  "admin:import-preview": { windowMs: [60_000], max: [10], checks: 1 },
  "admin:attendees-search": { windowMs: [60_000], max: [120], checks: 1 },
  "admin:geocoding-search": { windowMs: [60_000], max: [40], checks: 1 },
  "admin:geocoding-timezone": { windowMs: [60_000], max: [60], checks: 1 },
  "admin:import-commit": { windowMs: [60_000], max: [5], checks: 1 },
  "admin:import-job-status": { windowMs: [60_000], max: [120], checks: 1 },
  "admin:wallet-push-job-status": { windowMs: [60_000], max: [120], checks: 1 },
  "admin:wallet-message-job-status": { windowMs: [60_000], max: [120], checks: 1 },
  "admin:wallet-message-send": { windowMs: [600_000], max: [10], checks: 1 },
  "admin:template-preview": { windowMs: [60_000], max: [20], checks: 1 },
  "admin:resend": { windowMs: [60_000, 3_600_000], max: [5, 30], checks: 2 },
  "admin:resend-bulk": { windowMs: [600_000], max: [3], checks: 1 },
  "admin:attendee-patch": { windowMs: [60_000], max: [20], checks: 1 },
  "admin:user-revoke-sessions": { windowMs: [60_000], max: [10], checks: 1 },
  "admin:wallet-action": { windowMs: [60_000], max: [10], checks: 1 },
  "admin:wallet-action-bulk": { windowMs: [600_000], max: [10], checks: 1 },
  "admin:attendee-bulk-mutation": { windowMs: [60_000], max: [20], checks: 1 },
  "admin:bulk-send-cancel": { windowMs: [60_000], max: [30], checks: 1 },
  "checkin:scan": { windowMs: [60_000], max: [120], checks: 1 },
  "checkin:history": { windowMs: [60_000], max: [180], checks: 1 },
  "checkin:stream": { windowMs: [60_000], max: [12], checks: 1 },
};

/** Inline helpers — not passable to rateLimit(); limits only. */
const EXPECTED_INLINE_LIMITS: Record<keyof typeof INLINE_RATE_LIMITS, { windowMs: number; max: number }> =
  {
    "oidc:link-stepup": { windowMs: 60_000, max: 10 },
    "auth:login-email": { windowMs: 60_000, max: 10 },
    "mfa:verify-totp": { windowMs: 900_000, max: 10 },
    "mfa:verify-recovery": { windowMs: 900_000, max: 10 },
    "mfa:verify-webauthn": { windowMs: 900_000, max: 10 },
    "mfa:step-up-total": { windowMs: 900_000, max: 20 },
    "mfa:enroll": { windowMs: 900_000, max: 10 },
    "account:password-check": { windowMs: 60_000, max: 10 },
    "mail:test-recipient": { windowMs: 3_600_000, max: 5 },
  };

describe("RATE_POLICIES registry", () => {
  it("defines every expected policy with correct limits", () => {
    expect(Object.keys(RATE_POLICIES).sort()).toEqual(Object.keys(EXPECTED_POLICIES).sort());

    for (const [name, expected] of Object.entries(EXPECTED_POLICIES)) {
      const policy = RATE_POLICIES[name as keyof typeof RATE_POLICIES];
      expect(policy.checks).toHaveLength(expected.checks);
      expect(policy.checks.map((c) => c.windowMs)).toEqual(expected.windowMs);
      expect(policy.checks.map((c) => c.max)).toEqual(expected.max);
    }
  });

  it("uses bare IP key for public:tq (no prefix)", () => {
    const prev = process.env.TRUST_PROXY;
    process.env.TRUST_PROXY = "true";
    try {
      const check = RATE_POLICIES["public:tq"].checks[0];
      const mockContext = {
        req: {
          header: (name: string) => (name === "x-forwarded-for" ? "203.0.113.55" : undefined),
        },
      } as Parameters<typeof check.keyOf>[0];
      expect(check.keyOf(mockContext)).toBe("203.0.113.55");
      expect(check.keyOf(mockContext)).not.toMatch(/^public:/);
    } finally {
      if (prev === undefined) delete process.env.TRUST_PROXY;
      else process.env.TRUST_PROXY = prev;
    }
  });

  it("returns health_live_rate_limited JSON when admin:health-live is exceeded", () => {
    const check = RATE_POLICIES["admin:health-live"].checks[0]!;
    expect(check.onExceeded).toBeTypeOf("function");
    const json = vi.fn((body: unknown, status: number) => ({ body, status }));
    const response = check.onExceeded!({ json } as never);
    expect(json).toHaveBeenCalledWith({ error: "health_live_rate_limited" }, 429);
    expect(response).toEqual({ body: { error: "health_live_rate_limited" }, status: 429 });
  });

  it("scopes admin:health-live and authUserScopedPolicy keys by user id", () => {
    const authCtx = {
      get: (key: string) => (key === "auth" ? { userId: "user-42" } : undefined),
    } as never;
    expect(RATE_POLICIES["admin:health-live"].checks[0]!.keyOf(authCtx)).toBe(
      "admin:health-live:user:user-42",
    );
    expect(RATE_POLICIES["admin:mail-transport-test"].checks[0]!.keyOf(authCtx)).toBe(
      "admin:mail-transport-test:user:user-42",
    );
    expect(RATE_POLICIES["admin:event-mail-transport-test"].checks[0]!.keyOf(authCtx)).toBe(
      "admin:event-mail-transport-test:user:user-42",
    );
    expect(RATE_POLICIES["admin:mail-diagnostics"].checks[0]!.keyOf(authCtx)).toBe(
      "admin:mail-diagnostics:user:user-42",
    );
    expect(RATE_POLICIES["admin:event-mail-diagnostics"].checks[0]!.keyOf(authCtx)).toBe(
      "admin:event-mail-diagnostics:user:user-42",
    );
  });

  it("keeps the mail-diagnostics policies on a separate bucket from their test-send siblings", () => {
    // The bot-review gap this guards against: admin:mail-diagnostics (probe) and
    // admin:event-mail-diagnostics (probe, bounce-ingest test/run) must never share a key with
    // admin:mail-transport-test / admin:event-mail-transport-test (the actual test-send routes) -
    // otherwise exercising the diagnostics routes would silently eat into test-send's budget.
    const authCtx = {
      get: (key: string) => (key === "auth" ? { userId: "user-42" } : undefined),
    } as never;
    expect(RATE_POLICIES["admin:mail-diagnostics"].checks[0]!.keyOf(authCtx)).not.toBe(
      RATE_POLICIES["admin:mail-transport-test"].checks[0]!.keyOf(authCtx),
    );
    expect(RATE_POLICIES["admin:event-mail-diagnostics"].checks[0]!.keyOf(authCtx)).not.toBe(
      RATE_POLICIES["admin:event-mail-transport-test"].checks[0]!.keyOf(authCtx),
    );
  });

  it("gives the burst and sustained checks on the three test-mail policies distinct, correctly-scoped keys", () => {
    // Guards against a keyOf typo/collision making checks[1] silently double-count checks[0]'s
    // bucket (or vice versa) - each pair must produce two different key strings for the same
    // context, and the sustained key must still vary per user/event like the burst one does.
    const ctxA = {
      get: (key: string) => (key === "auth" ? { userId: "user-42" } : undefined),
      req: { param: (name: string) => (name === "eventId" ? "evt-1" : undefined) },
    } as never;
    const ctxB = {
      get: (key: string) => (key === "auth" ? { userId: "user-99" } : undefined),
      req: { param: (name: string) => (name === "eventId" ? "evt-2" : undefined) },
    } as never;

    const testSend = RATE_POLICIES["admin:test-send"];
    expect(testSend.checks[0]!.keyOf(ctxA)).toBe("admin:test-send:user:user-42:event:evt-1");
    expect(testSend.checks[1]!.keyOf(ctxA)).toBe(
      "admin:test-send:sustained:user:user-42:event:evt-1",
    );
    expect(testSend.checks[1]!.keyOf(ctxA)).not.toBe(testSend.checks[0]!.keyOf(ctxA));
    expect(testSend.checks[1]!.keyOf(ctxA)).not.toBe(testSend.checks[1]!.keyOf(ctxB));

    for (const name of ["admin:mail-transport-test", "admin:event-mail-transport-test"] as const) {
      const policy = RATE_POLICIES[name];
      expect(policy.checks[0]!.keyOf(ctxA)).toBe(`${name}:user:user-42`);
      expect(policy.checks[1]!.keyOf(ctxA)).toBe(`${name}:sustained:user:user-42`);
      expect(policy.checks[1]!.keyOf(ctxA)).not.toBe(policy.checks[0]!.keyOf(ctxA));
      expect(policy.checks[1]!.keyOf(ctxA)).not.toBe(policy.checks[1]!.keyOf(ctxB));
    }
  });

  it("scopes admin:wallet-message-job-status by user and event via adminUserEventKey", () => {
    const ctx = {
      get: (key: string) => (key === "auth" ? { userId: "user-42" } : undefined),
      req: { param: (name: string) => (name === "eventId" ? "evt-1" : undefined) },
    } as never;
    expect(RATE_POLICIES["admin:wallet-message-job-status"].checks[0]!.keyOf(ctx)).toBe(
      "admin:wallet-message-job-status:user:user-42:event:evt-1",
    );
  });

  it("scopes admin:wallet-action and admin:attendee-bulk-mutation by user and event", () => {
    const ctx = {
      get: (key: string) => (key === "auth" ? { userId: "user-42" } : undefined),
      req: { param: (name: string) => (name === "eventId" ? "evt-1" : undefined) },
    } as never;
    expect(RATE_POLICIES["admin:wallet-action"].checks[0]!.keyOf(ctx)).toBe(
      "admin:wallet-action:user:user-42:event:evt-1",
    );
    expect(RATE_POLICIES["admin:wallet-action-bulk"].checks[0]!.keyOf(ctx)).toBe(
      "admin:wallet-action-bulk:user:user-42:event:evt-1",
    );
    expect(RATE_POLICIES["admin:attendee-bulk-mutation"].checks[0]!.keyOf(ctx)).toBe(
      "admin:attendee-bulk-mutation:user:user-42:event:evt-1",
    );
    // Deliberately its own bucket, not admin:attendee-bulk-mutation's - see the policy's own
    // comment for why (unrelated bulk-attendee cleanup work must not be able to exhaust the
    // budget for the one safety action that stops a bad send).
    expect(RATE_POLICIES["admin:bulk-send-cancel"].checks[0]!.keyOf(ctx)).toBe(
      "admin:bulk-send-cancel:user:user-42:event:evt-1",
    );
  });

  it("caps admin:wallet-action-bulk tightly enough to bound PassCreator call volume", () => {
    // Worst case: max requests * WALLET_BULK_SEND_LIMIT (100 - the cap every route in this policy
    // group is held to once wallet is in play, not the general BULK_SEND_LIMIT of 500) provider
    // calls in the window must stay a comfortable margin under PassCreator's documented 600
    // req/min limit (_ops/adr/0041-wallet-passcreator-api-contract.md), even before
    // PASSCREATOR_MIN_CALL_INTERVAL_MS paces the actual outbound calls further.
    const policy = RATE_POLICIES["admin:wallet-action-bulk"].checks[0]!;
    const WALLET_BULK_SEND_LIMIT = 100;
    const worstCaseCalls = policy.max * WALLET_BULK_SEND_LIMIT;
    const windowMinutes = policy.windowMs / 60_000;
    const worstCaseCallsPerMinute = worstCaseCalls / windowMinutes;
    expect(worstCaseCallsPerMinute).toBeLessThan(600);
  });
});

describe("INLINE_RATE_LIMITS", () => {
  it("defines every expected inline limit", () => {
    expect(Object.keys(INLINE_RATE_LIMITS).sort()).toEqual(
      Object.keys(EXPECTED_INLINE_LIMITS).sort(),
    );

    for (const [name, expected] of Object.entries(EXPECTED_INLINE_LIMITS)) {
      const limit = INLINE_RATE_LIMITS[name as keyof typeof INLINE_RATE_LIMITS];
      expect(limit.windowMs).toBe(expected.windowMs);
      expect(limit.max).toBe(expected.max);
    }
  });
});
