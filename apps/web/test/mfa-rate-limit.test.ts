import { describe, expect, it } from "vitest";
import { checkMfaVerifyRateLimit } from "../src/auth/mfa-rate-limit.js";
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
