import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { SESSION_STAGE } from "../src/constants.js";

const mocks = vi.hoisted(() => ({
  recordFailedLoginFailureSideEffects: vi.fn().mockResolvedValue(undefined),
  resetFailedLoginStreak: vi.fn().mockResolvedValue(undefined),
  recordFailedMfaFailureSideEffects: vi.fn().mockResolvedValue(undefined),
  resetFailedMfaFailureStreak: vi.fn().mockResolvedValue(undefined),
  findUserByEmail: vi.fn(),
  verifyPasswordOrDummy: vi.fn(),
  logLoginFailure: vi.fn().mockResolvedValue(undefined),
  logLoginSuccess: vi.fn().mockResolvedValue(undefined),
  createSession: vi.fn(),
  userRequiresMfa: vi.fn().mockResolvedValue(false),
  userHasConfirmedTotp: vi.fn(),
  userHasUnacknowledgedBackupCodes: vi.fn().mockResolvedValue(false),
  validateTrustedDevice: vi.fn(),
  verifyTotpOrRecoveryCodeDetailed: vi.fn(),
  finishWebauthnAssertion: vi.fn(),
  promoteSessionToFull: vi.fn(),
  getTrustedDeviceDays: vi.fn(),
  createTrustedDevice: vi.fn(),
  logMfaSuccess: vi.fn().mockResolvedValue(undefined),
  logMfaFailure: vi.fn().mockResolvedValue(undefined),
  logMfaRecoveryConsumed: vi.fn().mockResolvedValue(undefined),
  logTrustedDeviceCreated: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/privileged-login-alert.js", () => ({
  recordFailedLoginFailureSideEffects: mocks.recordFailedLoginFailureSideEffects,
  resetFailedLoginStreak: mocks.resetFailedLoginStreak,
  recordFailedMfaFailureSideEffects: mocks.recordFailedMfaFailureSideEffects,
  resetFailedMfaFailureStreak: mocks.resetFailedMfaFailureStreak,
}));

vi.mock("../src/user.js", () => ({
  findUserByEmail: mocks.findUserByEmail,
  normalizeEmail: (email: string) => email.trim().toLowerCase(),
}));

vi.mock("../src/password.js", () => ({
  verifyPasswordOrDummy: mocks.verifyPasswordOrDummy,
}));

vi.mock("../src/audit.js", () => ({
  logLoginFailure: mocks.logLoginFailure,
  logLoginSuccess: mocks.logLoginSuccess,
  logMfaFailure: mocks.logMfaFailure,
  logMfaRecoveryConsumed: mocks.logMfaRecoveryConsumed,
  logMfaSuccess: mocks.logMfaSuccess,
  logTrustedDeviceCreated: mocks.logTrustedDeviceCreated,
}));

vi.mock("../src/session.js", () => ({
  createSession: mocks.createSession,
  promoteSessionToFull: mocks.promoteSessionToFull,
}));

vi.mock("../src/mfa/policy.js", () => ({
  userRequiresMfa: mocks.userRequiresMfa,
  userHasConfirmedTotp: mocks.userHasConfirmedTotp,
  userHasUnacknowledgedBackupCodes: mocks.userHasUnacknowledgedBackupCodes,
}));

vi.mock("../src/mfa/trusted-device.js", () => ({
  validateTrustedDevice: mocks.validateTrustedDevice,
  createTrustedDevice: mocks.createTrustedDevice,
}));

vi.mock("../src/mfa/verify-step-up-code.js", () => ({
  verifyTotpOrRecoveryCodeDetailed: mocks.verifyTotpOrRecoveryCodeDetailed,
}));

vi.mock("../src/mfa/webauthn.js", () => ({
  finishWebauthnAssertion: mocks.finishWebauthnAssertion,
}));

vi.mock("../src/settings/resolver.js", () => ({
  getTrustedDeviceDays: mocks.getTrustedDeviceDays,
}));

import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { login, completeMfa, completeMfaWithWebauthn } from "../src/login.js";
import type { WebauthnRpConfig } from "../src/mfa/webauthn.js";

// $transaction just invokes the callback with `prisma` itself as the stand-in `tx` - login()
// never calls $transaction directly, and completeMfa's mocked internals (verifyTotpOrRecoveryCodeDetailed
// et al.) don't distinguish tx from the root client. This makes completeMfa exercise its
// real root-client branch (open $transaction, catch-and-convert SessionPromotionFailedAfterCodeVerifiedError
// on failure) rather than the caller-owned-transaction branch (which now lets that error
// propagate uncaught - see completeMfa's own docstring).
const prisma = {
  $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
} as unknown as PrismaClient;

const testUser = {
  id: "user-1",
  email: "admin@example.com",
  password_hash: "hash",
  is_active: true,
  must_change_password: false,
  failed_login_streak: 2,
};

describe("login privileged failure tracking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSession.mockResolvedValue({
      session: { id: "sess-1" },
      rawToken: "token",
    });
  });

  it("records failed-login side effects for both unknown and existing accounts", async () => {
    mocks.findUserByEmail.mockResolvedValue(null);
    mocks.verifyPasswordOrDummy.mockResolvedValue(false);

    await login(prisma, { email: "missing@example.com", password: "wrong" });

    expect(mocks.recordFailedLoginFailureSideEffects).toHaveBeenCalledWith(prisma, null, {
      ip: undefined,
    });
    expect(mocks.logLoginFailure).toHaveBeenCalledWith(prisma, expect.anything(), "invalid_credentials");
  });

  it("records failed-login side effects when the user exists but the password is wrong", async () => {
    mocks.findUserByEmail.mockResolvedValue(testUser);
    mocks.verifyPasswordOrDummy.mockResolvedValue(false);

    const result = await login(prisma, { email: testUser.email, password: "wrong" });

    expect(result).toEqual({ ok: false, reason: "invalid_credentials" });
    expect(mocks.recordFailedLoginFailureSideEffects).toHaveBeenCalledWith(prisma, testUser, {
      ip: undefined,
    });
    expect(mocks.logLoginFailure).toHaveBeenCalledWith(prisma, expect.anything(), "invalid_credentials");
    expect(mocks.resetFailedLoginStreak).not.toHaveBeenCalled();
  });

  it("resets the failed-login streak after a successful password login", async () => {
    mocks.findUserByEmail.mockResolvedValue(testUser);
    mocks.verifyPasswordOrDummy.mockResolvedValue(true);

    const result = await login(prisma, { email: testUser.email, password: "correct" });

    expect(result.ok).toBe(true);
    expect(mocks.resetFailedLoginStreak).toHaveBeenCalledWith(prisma, testUser.id);
    expect(mocks.recordFailedLoginFailureSideEffects).not.toHaveBeenCalled();
  });

  it("runs the same timing-parity side effects for a deactivated account as for a wrong password, with a distinguishable audit reason", async () => {
    const inactiveUser = { ...testUser, is_active: false };
    mocks.findUserByEmail.mockResolvedValue(inactiveUser);
    mocks.verifyPasswordOrDummy.mockResolvedValue(true);

    const result = await login(prisma, { email: inactiveUser.email, password: "correct" });

    expect(result).toEqual({ ok: false, reason: "inactive" });
    // Same side-effect call as the invalid-credentials branch (P0 security review) - a correct
    // password against a deactivated account must not respond faster than a wrong password.
    expect(mocks.recordFailedLoginFailureSideEffects).toHaveBeenCalledWith(prisma, inactiveUser, {
      ip: undefined,
    });
    expect(mocks.logLoginFailure).toHaveBeenCalledWith(prisma, expect.anything(), "inactive");
    expect(mocks.resetFailedLoginStreak).not.toHaveBeenCalled();
  });
});

describe("completeMfa trusted-device audit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("emits auth.trusted_device.created when remember-device is enabled", async () => {
    mocks.verifyTotpOrRecoveryCodeDetailed.mockResolvedValue({ ok: true, method: "totp" });
    mocks.promoteSessionToFull.mockResolvedValue({ stage: SESSION_STAGE.FULL, rawToken: "rotated-token" });
    mocks.getTrustedDeviceDays.mockResolvedValue(30);
    mocks.createTrustedDevice.mockResolvedValue({ rawToken: "trusted-raw" });

    const result = await completeMfa(prisma, {
      userId: "user-1",
      sessionId: "sess-1",
      code: "123456",
      rememberDevice: true,
      ip: "1.2.3.4",
      userAgent: "test-agent",
    });

    expect(result).toEqual({
      ok: true,
      trustedDeviceRawToken: "trusted-raw",
      stage: SESSION_STAGE.FULL,
      sessionRawToken: "rotated-token",
    });
    expect(mocks.logTrustedDeviceCreated).toHaveBeenCalledWith(prisma, {
      userId: "user-1",
      sessionId: "sess-1",
      ip: "1.2.3.4",
      userAgent: "test-agent",
    });
    expect(mocks.resetFailedMfaFailureStreak).toHaveBeenCalledWith(prisma, "user-1");
  });
});

describe("completeMfa failure audit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("audits a wrong code and bumps the repeated-MFA-failure alert streak", async () => {
    mocks.verifyTotpOrRecoveryCodeDetailed.mockResolvedValue({ ok: false, reason: "no_match" });

    const result = await completeMfa(prisma, {
      userId: "user-1",
      sessionId: "sess-1",
      code: "000000",
      ip: "1.2.3.4",
    });

    expect(result).toEqual({ ok: false });
    expect(mocks.logMfaFailure).toHaveBeenCalledWith(
      prisma,
      expect.anything(),
      "invalid_code",
      undefined,
    );
    expect(mocks.recordFailedMfaFailureSideEffects).toHaveBeenCalledWith(prisma, "user-1", {
      ip: "1.2.3.4",
    });
    expect(mocks.promoteSessionToFull).not.toHaveBeenCalled();
  });

  it("audits a recovery-consume race without bumping the guessing-alert streak", async () => {
    mocks.verifyTotpOrRecoveryCodeDetailed.mockResolvedValue({ ok: false, reason: "consume_conflict" });

    const result = await completeMfa(prisma, {
      userId: "user-1",
      sessionId: "sess-1",
      code: "AAAA-BBBB-CCCC-DDDD",
    });

    expect(result).toEqual({ ok: false });
    expect(mocks.logMfaFailure).toHaveBeenCalledWith(
      prisma,
      expect.anything(),
      "recovery_consume_conflict",
      undefined,
    );
    // The code matched but lost the race to consume it - not a guess, so it must not count
    // toward the repeated-MFA-failure alert.
    expect(mocks.recordFailedMfaFailureSideEffects).not.toHaveBeenCalled();
  });

  it("audits a correct code whose session promotion failed, without bumping the guessing-alert streak", async () => {
    mocks.verifyTotpOrRecoveryCodeDetailed.mockResolvedValue({ ok: true, method: "emergency" });
    mocks.promoteSessionToFull.mockResolvedValue(null);

    const result = await completeMfa(prisma, {
      userId: "user-1",
      sessionId: "sess-1",
      code: "EEEE-FFFF-0000-1111",
    });

    // The code was correct - no access granted, but nothing was silently swallowed either.
    expect(result).toEqual({ ok: false });
    expect(mocks.logMfaFailure).toHaveBeenCalledWith(
      prisma,
      expect.anything(),
      "session_not_promoted",
      "emergency",
    );
    expect(mocks.recordFailedMfaFailureSideEffects).not.toHaveBeenCalled();
    expect(mocks.logMfaSuccess).not.toHaveBeenCalled();
  });

  it("propagates the session-promotion failure uncaught when the caller already owns the transaction, instead of letting the caller commit a burned code", async () => {
    // A caller-owned Prisma.TransactionClient has no $transaction method - completeMfa must not
    // swallow SessionPromotionFailedAfterCodeVerifiedError here, since it has no authority to
    // roll back a transaction it didn't open itself. See completeMfa's own docstring.
    const callerOwnedTx = {} as PrismaClient;
    mocks.verifyTotpOrRecoveryCodeDetailed.mockResolvedValue({ ok: true, method: "emergency" });
    mocks.promoteSessionToFull.mockResolvedValue(null);

    await expect(
      completeMfa(callerOwnedTx, {
        userId: "user-1",
        sessionId: "sess-1",
        code: "EEEE-FFFF-0000-1111",
      }),
    ).rejects.toThrow("mfa session promotion failed after code verification");

    // emitMfaAudit never runs on this path (see completeMfa's docstring) - the caller's own
    // transaction wrapper is responsible for handling/auditing the propagated failure.
    expect(mocks.logMfaFailure).not.toHaveBeenCalled();
  });
});

const testWebauthnRp: WebauthnRpConfig = {
  rpName: "Admitto",
  rpID: "admitto.example.com",
  origin: "https://admitto.example.com",
};

const testWebauthnResponse = {
  id: "cred-1",
  rawId: "cred-1",
  response: { clientDataJSON: "a", authenticatorData: "b", signature: "c" },
  clientExtensionResults: {},
  type: "public-key",
} as unknown as AuthenticationResponseJSON;

describe("completeMfaWithWebauthn trusted-device audit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("emits auth.trusted_device.created when remember-device is enabled", async () => {
    mocks.finishWebauthnAssertion.mockResolvedValue({ credentialId: "cred-1" });
    mocks.promoteSessionToFull.mockResolvedValue(SESSION_STAGE.FULL);
    mocks.getTrustedDeviceDays.mockResolvedValue(30);
    mocks.createTrustedDevice.mockResolvedValue({ rawToken: "trusted-raw" });

    const result = await completeMfaWithWebauthn(prisma, {
      userId: "user-1",
      sessionId: "sess-1",
      response: testWebauthnResponse,
      challenge: "chal-1",
      rp: testWebauthnRp,
      rememberDevice: true,
      ip: "1.2.3.4",
      userAgent: "test-agent",
    });

    expect(result).toEqual({ ok: true, trustedDeviceRawToken: "trusted-raw", stage: SESSION_STAGE.FULL });
    expect(mocks.logTrustedDeviceCreated).toHaveBeenCalledWith(prisma, {
      userId: "user-1",
      sessionId: "sess-1",
      ip: "1.2.3.4",
      userAgent: "test-agent",
    });
    expect(mocks.logMfaSuccess).toHaveBeenCalledWith(prisma, expect.anything(), "webauthn");
    expect(mocks.resetFailedMfaFailureStreak).toHaveBeenCalledWith(prisma, "user-1");
  });

  it("carries the captured timezone into the audit context, same as completeMfa's own TOTP path", async () => {
    mocks.finishWebauthnAssertion.mockResolvedValue({ credentialId: "cred-1" });
    mocks.promoteSessionToFull.mockResolvedValue(SESSION_STAGE.FULL);

    await completeMfaWithWebauthn(prisma, {
      userId: "user-1",
      sessionId: "sess-1",
      response: testWebauthnResponse,
      challenge: "chal-1",
      rp: testWebauthnRp,
      ip: "1.2.3.4",
      timezone: "Europe/Warsaw",
    });

    expect(mocks.logMfaSuccess).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ timezone: "Europe/Warsaw" }),
      "webauthn",
    );
  });

  it("skips trusted-device creation and getTrustedDeviceDays entirely when remember-device is not requested", async () => {
    mocks.finishWebauthnAssertion.mockResolvedValue({ credentialId: "cred-1" });
    mocks.promoteSessionToFull.mockResolvedValue(SESSION_STAGE.FULL);

    const result = await completeMfaWithWebauthn(prisma, {
      userId: "user-1",
      sessionId: "sess-1",
      response: testWebauthnResponse,
      challenge: "chal-1",
      rp: testWebauthnRp,
    });

    expect(result).toEqual({ ok: true, trustedDeviceRawToken: undefined, stage: SESSION_STAGE.FULL });
    expect(mocks.getTrustedDeviceDays).not.toHaveBeenCalled();
    expect(mocks.createTrustedDevice).not.toHaveBeenCalled();
    expect(mocks.logTrustedDeviceCreated).not.toHaveBeenCalled();
  });

  it("skips trusted-device creation when the instance's trusted-device window is disabled (0 days)", async () => {
    mocks.finishWebauthnAssertion.mockResolvedValue({ credentialId: "cred-1" });
    mocks.promoteSessionToFull.mockResolvedValue(SESSION_STAGE.FULL);
    mocks.getTrustedDeviceDays.mockResolvedValue(0);

    const result = await completeMfaWithWebauthn(prisma, {
      userId: "user-1",
      sessionId: "sess-1",
      response: testWebauthnResponse,
      challenge: "chal-1",
      rp: testWebauthnRp,
      rememberDevice: true,
    });

    expect(result).toEqual({ ok: true, trustedDeviceRawToken: undefined, stage: SESSION_STAGE.FULL });
    expect(mocks.createTrustedDevice).not.toHaveBeenCalled();
    expect(mocks.logTrustedDeviceCreated).not.toHaveBeenCalled();
  });
});

describe("completeMfaWithWebauthn failure audit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("audits a rejected assertion without bumping the repeated-guessing alert streak", async () => {
    mocks.finishWebauthnAssertion.mockResolvedValue(null);

    const result = await completeMfaWithWebauthn(prisma, {
      userId: "user-1",
      sessionId: "sess-1",
      response: testWebauthnResponse,
      challenge: "chal-1",
      rp: testWebauthnRp,
      ip: "1.2.3.4",
    });

    expect(result).toEqual({ ok: false });
    expect(mocks.logMfaFailure).toHaveBeenCalledWith(prisma, expect.anything(), "invalid_webauthn", undefined);
    // A rejected assertion isn't brute-forceable the way a guessed code is - see
    // emitMfaWebauthnAudit's own docstring.
    expect(mocks.recordFailedMfaFailureSideEffects).not.toHaveBeenCalled();
    expect(mocks.promoteSessionToFull).not.toHaveBeenCalled();
  });

  it("audits a verified assertion whose session promotion failed", async () => {
    mocks.finishWebauthnAssertion.mockResolvedValue({ credentialId: "cred-1" });
    mocks.promoteSessionToFull.mockResolvedValue(null);

    const result = await completeMfaWithWebauthn(prisma, {
      userId: "user-1",
      sessionId: "sess-1",
      response: testWebauthnResponse,
      challenge: "chal-1",
      rp: testWebauthnRp,
    });

    expect(result).toEqual({ ok: false });
    expect(mocks.logMfaFailure).toHaveBeenCalledWith(prisma, expect.anything(), "session_not_promoted", "webauthn");
    expect(mocks.recordFailedMfaFailureSideEffects).not.toHaveBeenCalled();
    expect(mocks.logMfaSuccess).not.toHaveBeenCalled();
  });

  it("propagates the session-promotion failure uncaught when the caller already owns the transaction", async () => {
    const callerOwnedTx = {} as PrismaClient;
    mocks.finishWebauthnAssertion.mockResolvedValue({ credentialId: "cred-1" });
    mocks.promoteSessionToFull.mockResolvedValue(null);

    await expect(
      completeMfaWithWebauthn(callerOwnedTx, {
        userId: "user-1",
        sessionId: "sess-1",
        response: testWebauthnResponse,
        challenge: "chal-1",
        rp: testWebauthnRp,
      }),
    ).rejects.toThrow("mfa session promotion failed after webauthn assertion verified");

    expect(mocks.logMfaFailure).not.toHaveBeenCalled();
  });
});
