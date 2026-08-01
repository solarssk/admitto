import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { SESSION_STAGE } from "../src/constants.js";

const mocks = vi.hoisted(() => ({
  recordFailedLoginForPrivilegedUser: vi.fn().mockResolvedValue(undefined),
  resetFailedLoginStreak: vi.fn().mockResolvedValue(undefined),
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
  promoteSessionToFull: vi.fn(),
  getTrustedDeviceDays: vi.fn(),
  createTrustedDevice: vi.fn(),
  logMfaSuccess: vi.fn().mockResolvedValue(undefined),
  logMfaFailure: vi.fn().mockResolvedValue(undefined),
  logMfaRecoveryConsumed: vi.fn().mockResolvedValue(undefined),
  logTrustedDeviceCreated: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/privileged-login-alert.js", () => ({
  recordFailedLoginForPrivilegedUser: mocks.recordFailedLoginForPrivilegedUser,
  resetFailedLoginStreak: mocks.resetFailedLoginStreak,
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

vi.mock("../src/settings/resolver.js", () => ({
  getTrustedDeviceDays: mocks.getTrustedDeviceDays,
}));

import { login, completeMfa } from "../src/login.js";

const prisma = {} as PrismaClient;

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

  it("records failed privileged logins when the user exists but the password is wrong", async () => {
    mocks.findUserByEmail.mockResolvedValue(testUser);
    mocks.verifyPasswordOrDummy.mockResolvedValue(false);

    const result = await login(prisma, { email: testUser.email, password: "wrong" });

    expect(result).toEqual({ ok: false, reason: "invalid_credentials" });
    expect(mocks.recordFailedLoginForPrivilegedUser).toHaveBeenCalledWith(prisma, testUser, {
      ip: undefined,
    });
    expect(mocks.resetFailedLoginStreak).not.toHaveBeenCalled();
  });

  it("resets the failed-login streak after a successful password login", async () => {
    mocks.findUserByEmail.mockResolvedValue(testUser);
    mocks.verifyPasswordOrDummy.mockResolvedValue(true);

    const result = await login(prisma, { email: testUser.email, password: "correct" });

    expect(result.ok).toBe(true);
    expect(mocks.resetFailedLoginStreak).toHaveBeenCalledWith(prisma, testUser.id);
    expect(mocks.recordFailedLoginForPrivilegedUser).not.toHaveBeenCalled();
  });
});

describe("completeMfa trusted-device audit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("emits auth.trusted_device.created when remember-device is enabled", async () => {
    mocks.verifyTotpOrRecoveryCodeDetailed.mockResolvedValue({ ok: true, method: "totp" });
    mocks.promoteSessionToFull.mockResolvedValue(SESSION_STAGE.FULL);
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

    expect(result).toEqual({ ok: true, trustedDeviceRawToken: "trusted-raw", stage: SESSION_STAGE.FULL });
    expect(mocks.logTrustedDeviceCreated).toHaveBeenCalledWith(prisma, {
      userId: "user-1",
      sessionId: "sess-1",
      ip: "1.2.3.4",
      userAgent: "test-agent",
    });
  });
});
