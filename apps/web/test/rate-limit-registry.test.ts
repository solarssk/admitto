import { describe, expect, it } from "vitest";
import { INLINE_RATE_LIMITS, RATE_POLICIES } from "../src/rate-limit/policies.js";

/** Regression guard — middleware policies: limits and check counts must match production wiring. */
const EXPECTED_POLICIES: Record<
  keyof typeof RATE_POLICIES,
  { windowMs: number[]; max: number[]; checks: number }
> = {
  "public:tq": { windowMs: [60_000], max: [60], checks: 1 },
  "ops:healthz": { windowMs: [60_000], max: [120], checks: 1 },
  "ops:readyz": { windowMs: [60_000], max: [10], checks: 1 },
  "auth:oidc": { windowMs: [60_000], max: [20], checks: 1 },
  "auth:login-ip": { windowMs: [60_000], max: [10], checks: 1 },
  "admin:oidc-provider-ops": { windowMs: [60_000], max: [10], checks: 1 },
  "admin:test-send": { windowMs: [60_000], max: [5], checks: 1 },
  "admin:mail-transport-test": { windowMs: [60_000], max: [5], checks: 1 },
  "admin:export": { windowMs: [3_600_000], max: [10], checks: 1 },
  "admin:export-pii": { windowMs: [3_600_000], max: [5], checks: 1 },
  "admin:import-preview": { windowMs: [60_000], max: [10], checks: 1 },
  "admin:import-commit": { windowMs: [60_000], max: [5], checks: 1 },
  "admin:template-preview": { windowMs: [60_000], max: [20], checks: 1 },
  "admin:resend": { windowMs: [60_000, 3_600_000], max: [5, 30], checks: 2 },
  "admin:resend-bulk": { windowMs: [600_000], max: [3], checks: 1 },
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
    "mfa:verify-recovery": { windowMs: 900_000, max: 30 },
    "mfa:enroll": { windowMs: 900_000, max: 10 },
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
