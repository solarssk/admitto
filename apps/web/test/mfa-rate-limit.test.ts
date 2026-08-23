import { describe, expect, it } from "vitest";
import {
  checkMfaVerifyRateLimit,
  checkWebauthnStepUpRateLimit,
  checkStepUpTotalRateLimit,
} from "../src/auth/mfa-rate-limit.js";
import { InMemoryRateLimitStore } from "../src/rate-limit/in-memory.js";

const SESSION = "sess-1";
const IP = "127.0.0.1";
const TOTP_CODE = "123456";
const RECOVERY_CODE = "AAAA-BBBB-CCCC";
const TOTP_MAX = 10;
const RECOVERY_MAX = 30;

describe("checkMfaVerifyRateLimit", () => {
  it("namespaces TOTP buckets by action — exhausting one action's limit does not block a different action for the same session/IP", async () => {
    const store = new InMemoryRateLimitStore();
    for (let i = 0; i < TOTP_MAX; i++) {
      expect(await checkMfaVerifyRateLimit(store, SESSION, IP, TOTP_CODE, "mfa-confirm")).toBe(true);
    }
    expect(await checkMfaVerifyRateLimit(store, SESSION, IP, TOTP_CODE, "mfa-confirm")).toBe(false);
    expect(await checkMfaVerifyRateLimit(store, SESSION, IP, TOTP_CODE, "mfa-reset")).toBe(true);
  });

  it("namespaces recovery-code buckets by action the same way as TOTP buckets", async () => {
    const store = new InMemoryRateLimitStore();
    for (let i = 0; i < RECOVERY_MAX; i++) {
      expect(await checkMfaVerifyRateLimit(store, SESSION, IP, RECOVERY_CODE, "mfa-confirm")).toBe(true);
    }
    expect(await checkMfaVerifyRateLimit(store, SESSION, IP, RECOVERY_CODE, "mfa-confirm")).toBe(false);
    expect(await checkMfaVerifyRateLimit(store, SESSION, IP, RECOVERY_CODE, "mfa-reset")).toBe(true);
  });

  it("keeps the un-namespaced (login-time) TOTP bucket separate from any action-tagged bucket", async () => {
    const store = new InMemoryRateLimitStore();
    for (let i = 0; i < TOTP_MAX; i++) {
      expect(await checkMfaVerifyRateLimit(store, SESSION, IP, TOTP_CODE)).toBe(true);
    }
    expect(await checkMfaVerifyRateLimit(store, SESSION, IP, TOTP_CODE)).toBe(false);
    expect(await checkMfaVerifyRateLimit(store, SESSION, IP, TOTP_CODE, "oidc-link")).toBe(true);
  });

  it("keeps the un-namespaced (login-time) recovery-code bucket separate from any action-tagged bucket", async () => {
    const store = new InMemoryRateLimitStore();
    for (let i = 0; i < RECOVERY_MAX; i++) {
      expect(await checkMfaVerifyRateLimit(store, SESSION, IP, RECOVERY_CODE)).toBe(true);
    }
    expect(await checkMfaVerifyRateLimit(store, SESSION, IP, RECOVERY_CODE)).toBe(false);
    expect(await checkMfaVerifyRateLimit(store, SESSION, IP, RECOVERY_CODE, "mfa-confirm")).toBe(true);
  });

  it("still rate-limits by IP within the same action — a fresh session from an exhausted IP is blocked", async () => {
    const store = new InMemoryRateLimitStore();
    for (let i = 0; i < TOTP_MAX; i++) {
      expect(await checkMfaVerifyRateLimit(store, "sess-a", IP, TOTP_CODE, "mfa-reset")).toBe(true);
    }
    expect(await checkMfaVerifyRateLimit(store, "sess-b", IP, TOTP_CODE, "mfa-reset")).toBe(false);
  });

  it("does not let a recovery-shaped code borrow the TOTP budget, or vice versa", async () => {
    const store = new InMemoryRateLimitStore();
    for (let i = 0; i < TOTP_MAX; i++) {
      expect(await checkMfaVerifyRateLimit(store, SESSION, IP, TOTP_CODE, "mfa-reset")).toBe(true);
    }
    expect(await checkMfaVerifyRateLimit(store, SESSION, IP, TOTP_CODE, "mfa-reset")).toBe(false);
    // Same session/IP/action, but a recovery-shaped code — separate bucket, separate budget.
    expect(await checkMfaVerifyRateLimit(store, SESSION, IP, RECOVERY_CODE, "mfa-reset")).toBe(true);
  });
});

describe("checkWebauthnStepUpRateLimit", () => {
  const WEBAUTHN_MAX = 10;

  it("blocks after exhausting the session bucket", async () => {
    const store = new InMemoryRateLimitStore();
    for (let i = 0; i < WEBAUTHN_MAX; i++) {
      expect(await checkWebauthnStepUpRateLimit(store, SESSION, IP, "login-mfa-webauthn")).toBe(true);
    }
    expect(await checkWebauthnStepUpRateLimit(store, SESSION, IP, "login-mfa-webauthn")).toBe(false);
  });

  it("still rate-limits by IP within the same action — a fresh session from an exhausted IP is blocked", async () => {
    const store = new InMemoryRateLimitStore();
    for (let i = 0; i < WEBAUTHN_MAX; i++) {
      expect(await checkWebauthnStepUpRateLimit(store, "sess-a", IP, "account-webauthn-remove")).toBe(true);
    }
    expect(await checkWebauthnStepUpRateLimit(store, "sess-b", IP, "account-webauthn-remove")).toBe(false);
  });

  it("namespaces buckets by action — exhausting one action's limit does not block a different action", async () => {
    const store = new InMemoryRateLimitStore();
    for (let i = 0; i < WEBAUTHN_MAX; i++) {
      expect(await checkWebauthnStepUpRateLimit(store, SESSION, IP, "login-mfa-webauthn")).toBe(true);
    }
    expect(await checkWebauthnStepUpRateLimit(store, SESSION, IP, "login-mfa-webauthn")).toBe(false);
    expect(await checkWebauthnStepUpRateLimit(store, SESSION, IP, "account-webauthn-remove")).toBe(true);
  });

  it("keeps the un-namespaced bucket separate from any action-tagged bucket", async () => {
    const store = new InMemoryRateLimitStore();
    for (let i = 0; i < WEBAUTHN_MAX; i++) {
      expect(await checkWebauthnStepUpRateLimit(store, SESSION, IP)).toBe(true);
    }
    expect(await checkWebauthnStepUpRateLimit(store, SESSION, IP)).toBe(false);
    expect(await checkWebauthnStepUpRateLimit(store, SESSION, IP, "login-mfa-webauthn")).toBe(true);
  });
});

describe("checkStepUpTotalRateLimit", () => {
  const TOTAL_MAX = 20;

  it("blocks after exhausting the shared session bucket", async () => {
    const store = new InMemoryRateLimitStore();
    for (let i = 0; i < TOTAL_MAX; i++) {
      expect(await checkStepUpTotalRateLimit(store, SESSION, IP)).toBe(true);
    }
    expect(await checkStepUpTotalRateLimit(store, SESSION, IP)).toBe(false);
  });

  it("is action-agnostic — closes the gap where per-action buckets let a session multiply its real attempt budget by hopping across actions", async () => {
    const store = new InMemoryRateLimitStore();
    // Each of these calls uses a DIFFERENT rateLimitAction, so checkWebauthnStepUpRateLimit's own
    // per-action bucket alone would never block them (see the "namespaces buckets by action" test
    // above) - this shared bucket is what actually caps the total across all of them.
    const actions = [
      "account-password",
      "mfa-reset",
      "account-webauthn-remove",
      "account-totp-remove",
      "account-backup-codes-regenerate",
      "account-external-identity",
      "admin-reset-2fa-superadmin",
      "admin-reset-password-superadmin",
    ];
    const PER_ACTION_MAX = 10;
    let blocked = false;
    let attempts = 0;
    for (const action of actions) {
      for (let i = 0; i < PER_ACTION_MAX; i++) {
        attempts++;
        const totalAllowed = await checkStepUpTotalRateLimit(store, SESSION, IP);
        if (!totalAllowed) {
          blocked = true;
          break;
        }
        expect(await checkWebauthnStepUpRateLimit(store, SESSION, IP, action)).toBe(true);
      }
      if (blocked) break;
    }
    expect(blocked).toBe(true);
    // Blocked well before the naive per-action-only ceiling (8 actions * 10/action = 80) would
    // have allowed, and at exactly the shared cap.
    expect(attempts).toBe(TOTAL_MAX + 1);
  });

  it("still rate-limits by IP - a fresh session from an exhausted IP is blocked", async () => {
    const store = new InMemoryRateLimitStore();
    for (let i = 0; i < TOTAL_MAX; i++) {
      expect(await checkStepUpTotalRateLimit(store, "sess-a", IP)).toBe(true);
    }
    expect(await checkStepUpTotalRateLimit(store, "sess-b", IP)).toBe(false);
  });

  it("keeps separate sessions on separate budgets when IPs differ too", async () => {
    const store = new InMemoryRateLimitStore();
    for (let i = 0; i < TOTAL_MAX; i++) {
      expect(await checkStepUpTotalRateLimit(store, "sess-a", "10.0.0.1")).toBe(true);
    }
    expect(await checkStepUpTotalRateLimit(store, "sess-a", "10.0.0.1")).toBe(false);
    expect(await checkStepUpTotalRateLimit(store, "sess-b", "10.0.0.2")).toBe(true);
  });
});
