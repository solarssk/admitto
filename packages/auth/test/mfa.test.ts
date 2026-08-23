import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { hashPassword } from "../src/password.js";
import { login, completeMfa } from "../src/login.js";
import {
  BACKUP_CODES_STEP_TTL_MS,
  LOGIN_NEXT,
  MFA_PENDING_SESSION_TTL_MS,
  SESSION_STAGE,
} from "../src/constants.js";
import {
  startTotpEnrollment,
  getOrStartTotpEnrollment,
  resumePendingTotpEnrollment,
  cancelPendingTotpEnrollment,
  confirmTotpEnrollment,
  resetUserMfa,
  verifyUserTotpCode,
} from "../src/mfa/enrollment.js";
import {
  generateTotpSecret,
  encryptTotpSecret,
  generateTotpCode,
  verifyTotpCode,
  verifyTotpCodeDetailed,
  decryptTotpSecret,
  buildTotpOtpauthUri,
  parseTotpSecretFromOtpauthUri,
} from "../src/mfa/totp.js";
import {
  verifyBackupRecoveryCode,
  regenerateBackupRecoveryCodes,
} from "../src/mfa/backup-recovery.js";
import {
  generateEmergencyRecoveryCode,
  verifyEmergencyRecoveryCode,
} from "../src/mfa/emergency-recovery.js";
import {
  generateRecoveryCodePlaintext,
  normalizeRecoveryCode,
} from "../src/mfa/recovery-hash.js";
import {
  createTrustedDevice,
  validateTrustedDevice,
  revokeTrustedDeviceByToken,
  revokeAllTrustedDevicesForUser,
} from "../src/mfa/trusted-device.js";
import { userRequiresMfa, userHasConfirmedTotp } from "../src/mfa/policy.js";
import { createSession, validateSession, validatePartialSession, promoteSessionToFull } from "../src/session.js";
import { getSessionTtlAdminMs, getMfaRequiredRoles } from "../src/settings/resolver.js";
import { SETTING_SESSION_TTL } from "../src/settings/keys.js";
import { assertTestDatabaseUrl } from "@admitto/db/test-db-guard";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_ROOT = path.resolve(__dirname, "..", "..", "db");

const USER_ADMIN = "user-mfa-admin";
const USER_OP = "user-mfa-op";
const PASSWORD = "mfa-test-pass-123";

let prisma: PrismaClient;

beforeAll(async () => {
  assertTestDatabaseUrl(process.env.DATABASE_URL ?? "");
  execSync("npx prisma db push --force-reset --accept-data-loss", {
    cwd: DB_ROOT,
    env: { ...process.env },
    stdio: "pipe",
  });

  prisma = createTestPrismaClient();
  const password_hash = await hashPassword(PASSWORD);

  await prisma.user.createMany({
    data: [
      { id: USER_ADMIN, email: "mfa-admin@example.com", password_hash },
      { id: USER_OP, email: "mfa-op@example.com", password_hash },
    ],
  });

  await prisma.roleAssignment.createMany({
    data: [
      { user_id: USER_ADMIN, role: "admin", scope_type: "instance", scope_id: null },
      { user_id: USER_OP, role: "operator", scope_type: "event", scope_id: "evt-mfa" },
    ],
  });

  await prisma.systemSettings.upsert({
    where: { key: SETTING_SESSION_TTL },
    create: { key: SETTING_SESSION_TTL, value_json: "999999" },
    update: { value_json: "999999" },
  });
});

afterAll(async () => {
  delete process.env["SESSION_TTL_ADMIN_MS"];
  await prisma.$disconnect();
});

describe("TOTP enrollment", () => {
  it("parseTotpSecretFromOtpauthUri extracts setup key from otpauth URI", () => {
    const secret = generateTotpSecret();
    const uri = buildTotpOtpauthUri(secret, "user@example.com");
    expect(parseTotpSecretFromOtpauthUri(uri)).toBe(secret);
    expect(parseTotpSecretFromOtpauthUri("not-a-uri")).toBeNull();
  });

  it("stores secret_enc encrypted and confirms with valid code", async () => {
    const userId = "user-totp-enroll";
    const password_hash = await hashPassword(PASSWORD);
    await prisma.user.create({
      data: { id: userId, email: "totp-enroll@example.com", password_hash },
    });

    const enrollment = await startTotpEnrollment(prisma, userId);
    expect(enrollment?.otpauthUri).toMatch(/^otpauth:\/\/totp\//);

    const row = await prisma.userMfaMethod.findFirst({
      where: { user_id: userId, type: "totp" },
    });
    expect(row?.secret_enc).toBeTruthy();

    const secret = decryptTotpSecret(row!.secret_enc!);
    const code = generateTotpCode(secret);
    expect(await confirmTotpEnrollment(prisma, userId, code)).toBe(true);
    expect(await userHasConfirmedTotp(prisma, userId)).toBe(true);
    expect(await confirmTotpEnrollment(prisma, userId, "000000")).toBe(false);
  });

  it("getOrStartTotpEnrollment resumes pending setup without rotating secret", async () => {
    const userId = "user-totp-resume";
    const password_hash = await hashPassword(PASSWORD);
    await prisma.user.create({
      data: { id: userId, email: "totp-resume@example.com", password_hash },
    });

    const first = await startTotpEnrollment(prisma, userId);
    expect(first?.backupCodes.length).toBeGreaterThan(0);

    const rowBefore = await prisma.userMfaMethod.findFirst({
      where: { user_id: userId, type: "totp" },
    });

    const resumed = await getOrStartTotpEnrollment(prisma, userId);
    expect(resumed?.backupCodesAlreadyShown).toBe(true);
    expect(resumed?.backupCodes).toEqual([]);

    const rowAfter = await prisma.userMfaMethod.findFirst({
      where: { user_id: userId, type: "totp" },
    });
    expect(rowAfter?.id).toBe(rowBefore?.id);
    expect(rowAfter?.secret_enc).toBe(rowBefore?.secret_enc);
  });

  it("resumePendingTotpEnrollment is read-only when no pending row", async () => {
    const userId = "user-totp-resume-none";
    const password_hash = await hashPassword(PASSWORD);
    await prisma.user.create({
      data: { id: userId, email: "totp-resume-none@example.com", password_hash },
    });

    expect(await resumePendingTotpEnrollment(prisma, userId)).toBeNull();
    expect(await prisma.userMfaMethod.count({ where: { user_id: userId } })).toBe(0);
  });

  it("resumePendingTotpEnrollment clears corrupt pending secret", async () => {
    const userId = "user-totp-corrupt";
    const password_hash = await hashPassword(PASSWORD);
    await prisma.user.create({
      data: { id: userId, email: "totp-corrupt@example.com", password_hash },
    });
    await prisma.userMfaMethod.create({
      data: {
        user_id: userId,
        type: "totp",
        secret_enc: "not-valid-encrypted-payload",
        confirmed_at: null,
      },
    });

    expect(await resumePendingTotpEnrollment(prisma, userId)).toBeNull();
    expect(await prisma.userMfaMethod.count({ where: { user_id: userId, type: "totp" } })).toBe(0);
    const fresh = await startTotpEnrollment(prisma, userId);
    expect(fresh?.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
  });

  it("startTotpEnrollment refuses when TOTP already confirmed", async () => {
    const userId = "user-totp-confirmed";
    const password_hash = await hashPassword(PASSWORD);
    await prisma.user.create({
      data: { id: userId, email: "totp-confirmed@example.com", password_hash },
    });

    const enrollment = await startTotpEnrollment(prisma, userId);
    const secret = decryptTotpSecret(
      (await prisma.userMfaMethod.findFirst({ where: { user_id: userId, type: "totp" } }))!
        .secret_enc!,
    );
    await confirmTotpEnrollment(prisma, userId, generateTotpCode(secret));

    expect(await startTotpEnrollment(prisma, userId)).toBeNull();
    expect(enrollment?.otpauthUri).toBeTruthy();
  });
});

describe("login MFA flow", () => {
  it("operator gets full session without MFA", async () => {
    const result = await login(prisma, {
      email: "mfa-op@example.com",
      password: PASSWORD,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.next).toBe(LOGIN_NEXT.COMPLETE);
    expect(await validateSession(prisma, result.rawToken)).not.toBeNull();
  });

  it("admin without TOTP gets enrollment_required", async () => {
    await resetUserMfa(prisma, USER_ADMIN);
    const result = await login(prisma, {
      email: "mfa-admin@example.com",
      password: PASSWORD,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.next).toBe(LOGIN_NEXT.ENROLLMENT_REQUIRED);
    const partial = await validatePartialSession(prisma, result.rawToken);
    expect(partial?.stage).toBe(SESSION_STAGE.ENROLLMENT_REQUIRED);
    expect(await validateSession(prisma, result.rawToken)).toBeNull();
  });

  it("admin with TOTP gets mfa_pending then full after verify", async () => {
    await resetUserMfa(prisma, USER_ADMIN);
    const secret = generateTotpSecret();
    await prisma.userMfaMethod.create({
      data: {
        user_id: USER_ADMIN,
        type: "totp",
        secret_enc: encryptTotpSecret(secret),
        confirmed_at: new Date(),
      },
    });

    const loginResult = await login(prisma, {
      email: "mfa-admin@example.com",
      password: PASSWORD,
    });
    expect(loginResult.ok).toBe(true);
    if (!loginResult.ok) return;
    expect(loginResult.next).toBe(LOGIN_NEXT.MFA_REQUIRED);

    const mfa = await completeMfa(prisma, {
      userId: USER_ADMIN,
      sessionId: loginResult.sessionId,
      code: generateTotpCode(secret),
    });
    expect(mfa.ok).toBe(true);
    // Promotion rotates the session token - the pre-MFA token must stop validating.
    expect(await validateSession(prisma, loginResult.rawToken)).toBeNull();
    expect(await validateSession(prisma, mfa.sessionRawToken!)).not.toBeNull();
  });

  it("rolls back backup-code consumption when session promotion fails, and audits the failure", async () => {
    await resetUserMfa(prisma, USER_ADMIN);
    const { codes } = await regenerateBackupRecoveryCodes(prisma, USER_ADMIN);
    const secret = generateTotpSecret();
    await prisma.userMfaMethod.create({
      data: {
        user_id: USER_ADMIN,
        type: "totp",
        secret_enc: encryptTotpSecret(secret),
        confirmed_at: new Date(),
      },
    });

    const loginResult = await login(prisma, {
      email: "mfa-admin@example.com",
      password: PASSWORD,
    });
    expect(loginResult.ok).toBe(true);
    if (!loginResult.ok) return;

    // Force the session out of a promotable stage so promotion fails after the code verifies
    // (e.g. it expired or was concurrently revoked between code entry and promotion).
    await prisma.session.update({
      where: { id: loginResult.sessionId },
      data: { stage: SESSION_STAGE.FULL },
    });

    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const mfa = await completeMfa(prisma, {
      userId: USER_ADMIN,
      sessionId: loginResult.sessionId,
      code: codes[0]!,
    });
    const events = infoSpy.mock.calls.map(([line]) => JSON.parse(String(line)));
    infoSpy.mockRestore();

    expect(mfa.ok).toBe(false);
    // A correct code that can't be promoted must not burn a locked-out user's one-shot
    // recovery code for nothing - consumption rolls back with the rest of the transaction, so
    // the code stays usable on a subsequent attempt.
    expect(await verifyBackupRecoveryCode(prisma, USER_ADMIN, codes[0]!)).toBe(true);

    const failEvent = events.find((e) => e.event === "auth.mfa.fail");
    expect(failEvent?.reason).toBe("session_not_promoted");
    expect(failEvent?.method).toBe("backup");
  });

  it("rolls back emergency-code consumption when session promotion fails", async () => {
    await resetUserMfa(prisma, USER_ADMIN);
    const secret = generateTotpSecret();
    await prisma.userMfaMethod.create({
      data: {
        user_id: USER_ADMIN,
        type: "totp",
        secret_enc: encryptTotpSecret(secret),
        confirmed_at: new Date(),
      },
    });
    const { code: emergencyCode } = await generateEmergencyRecoveryCode(prisma, USER_ADMIN);

    const loginResult = await login(prisma, {
      email: "mfa-admin@example.com",
      password: PASSWORD,
    });
    expect(loginResult.ok).toBe(true);
    if (!loginResult.ok) return;

    await prisma.session.update({
      where: { id: loginResult.sessionId },
      data: { stage: SESSION_STAGE.FULL },
    });

    const mfa = await completeMfa(prisma, {
      userId: USER_ADMIN,
      sessionId: loginResult.sessionId,
      code: emergencyCode,
    });

    expect(mfa.ok).toBe(false);
    // A single active break-glass code must survive a failed promotion attempt intact.
    expect(await verifyEmergencyRecoveryCode(prisma, USER_ADMIN, emergencyCode)).toBe(true);
  });

  it("completes MFA with a backup recovery code, reports method, and consumes it", async () => {
    await resetUserMfa(prisma, USER_ADMIN);
    const { codes } = await regenerateBackupRecoveryCodes(prisma, USER_ADMIN);
    const secret = generateTotpSecret();
    await prisma.userMfaMethod.create({
      data: {
        user_id: USER_ADMIN,
        type: "totp",
        secret_enc: encryptTotpSecret(secret),
        confirmed_at: new Date(),
      },
    });

    const loginResult = await login(prisma, {
      email: "mfa-admin@example.com",
      password: PASSWORD,
    });
    expect(loginResult.ok).toBe(true);
    if (!loginResult.ok) return;

    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const mfa = await completeMfa(prisma, {
      userId: USER_ADMIN,
      sessionId: loginResult.sessionId,
      code: codes[0]!,
    });
    const events = infoSpy.mock.calls.map(([line]) => JSON.parse(String(line)));
    infoSpy.mockRestore();

    expect(mfa.ok).toBe(true);
    // Promotion rotates the session token - the pre-MFA token must stop validating.
    expect(await validateSession(prisma, loginResult.rawToken)).toBeNull();
    expect(await validateSession(prisma, mfa.sessionRawToken!)).not.toBeNull();
    expect(await verifyBackupRecoveryCode(prisma, USER_ADMIN, codes[0]!)).toBe(false);

    expect(events.find((e) => e.event === "auth.mfa.success")?.method).toBe("backup");
    expect(events.find((e) => e.event === "auth.mfa.recovery_consumed")?.method).toBe("backup");
  });

  it("completes MFA with an emergency recovery code and reports method", async () => {
    await resetUserMfa(prisma, USER_ADMIN);
    const secret = generateTotpSecret();
    await prisma.userMfaMethod.create({
      data: {
        user_id: USER_ADMIN,
        type: "totp",
        secret_enc: encryptTotpSecret(secret),
        confirmed_at: new Date(),
      },
    });
    const { code: emergencyCode } = await generateEmergencyRecoveryCode(prisma, USER_ADMIN);

    const loginResult = await login(prisma, {
      email: "mfa-admin@example.com",
      password: PASSWORD,
    });
    expect(loginResult.ok).toBe(true);
    if (!loginResult.ok) return;

    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const mfa = await completeMfa(prisma, {
      userId: USER_ADMIN,
      sessionId: loginResult.sessionId,
      code: emergencyCode,
    });
    const events = infoSpy.mock.calls.map(([line]) => JSON.parse(String(line)));
    infoSpy.mockRestore();

    expect(mfa.ok).toBe(true);
    // Promotion rotates the session token - the pre-MFA token must stop validating.
    expect(await validateSession(prisma, loginResult.rawToken)).toBeNull();
    expect(await validateSession(prisma, mfa.sessionRawToken!)).not.toBeNull();
    expect(await verifyEmergencyRecoveryCode(prisma, USER_ADMIN, emergencyCode)).toBe(false);

    expect(events.find((e) => e.event === "auth.mfa.success")?.method).toBe("emergency");
    expect(events.find((e) => e.event === "auth.mfa.recovery_consumed")?.method).toBe("emergency");
  });

  it("rejects an invalid MFA code without consuming any recovery row or granting access", async () => {
    await resetUserMfa(prisma, USER_ADMIN);
    const { codes } = await regenerateBackupRecoveryCodes(prisma, USER_ADMIN);
    const secret = generateTotpSecret();
    await prisma.userMfaMethod.create({
      data: {
        user_id: USER_ADMIN,
        type: "totp",
        secret_enc: encryptTotpSecret(secret),
        confirmed_at: new Date(),
      },
    });

    const loginResult = await login(prisma, {
      email: "mfa-admin@example.com",
      password: PASSWORD,
    });
    expect(loginResult.ok).toBe(true);
    if (!loginResult.ok) return;

    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const mfa = await completeMfa(prisma, {
      userId: USER_ADMIN,
      sessionId: loginResult.sessionId,
      code: "not-a-real-code",
    });
    const events = infoSpy.mock.calls.map(([line]) => JSON.parse(String(line)));
    infoSpy.mockRestore();

    expect(mfa.ok).toBe(false);
    expect(await validateSession(prisma, loginResult.rawToken)).toBeNull();
    // Unrelated backup codes remain usable: nothing was consumed on a no-match.
    expect(await verifyBackupRecoveryCode(prisma, USER_ADMIN, codes[0]!)).toBe(true);

    expect(events.some((e) => e.event === "auth.mfa.fail")).toBe(true);
    expect(events.some((e) => e.event === "auth.mfa.success")).toBe(false);
    expect(events.some((e) => e.event === "auth.mfa.recovery_consumed")).toBe(false);
  });
});

describe("promoteSessionToFull", () => {
  it("does not promote expired partial sessions", async () => {
    const loginResult = await login(prisma, {
      email: "mfa-admin@example.com",
      password: PASSWORD,
    });
    expect(loginResult.ok).toBe(true);
    if (!loginResult.ok) return;

    await prisma.session.update({
      where: { id: loginResult.sessionId },
      data: { expires_at: new Date(Date.now() - 1000) },
    });

    expect(await promoteSessionToFull(prisma, loginResult.sessionId, loginResult.userId)).toBeNull();
  });

  it("uses the constrained TTL for backup-code and password-change follow-up stages", async () => {
    const backupUserId = "user-promote-backup-codes";
    const passwordUserId = "user-promote-change-password";
    const password_hash = await hashPassword(PASSWORD);
    await prisma.user.createMany({
      data: [
        { id: backupUserId, email: "promote-backup@example.com", password_hash },
        {
          id: passwordUserId,
          email: "promote-password@example.com",
          password_hash,
          must_change_password: true,
        },
      ],
    });

    try {
      const enrollment = await startTotpEnrollment(prisma, backupUserId);
      const backupSecret = parseTotpSecretFromOtpauthUri(enrollment!.otpauthUri);
      expect(await confirmTotpEnrollment(prisma, backupUserId, generateTotpCode(backupSecret!))).toBe(true);

      const backupSession = await createSession(prisma, {
        userId: backupUserId,
        stage: SESSION_STAGE.MFA_PENDING,
      });
      const passwordSession = await createSession(prisma, {
        userId: passwordUserId,
        stage: SESSION_STAGE.MFA_PENDING,
      });

      expect(
        (await promoteSessionToFull(prisma, backupSession.session.id, backupUserId))?.stage,
      ).toBe(SESSION_STAGE.BACKUP_CODES_REQUIRED);
      expect(
        (await promoteSessionToFull(prisma, passwordSession.session.id, passwordUserId))?.stage,
      ).toBe(SESSION_STAGE.CHANGE_PASSWORD_REQUIRED);

      const [promotedBackup, promotedPassword] = await prisma.session.findMany({
        where: { id: { in: [backupSession.session.id, passwordSession.session.id] } },
      });
      const backup = promotedBackup!.id === backupSession.session.id ? promotedBackup! : promotedPassword!;
      const password = promotedPassword!.id === passwordSession.session.id ? promotedPassword! : promotedBackup!;
      expect(backup.expires_at.getTime() - backup.last_seen_at.getTime()).toBe(BACKUP_CODES_STEP_TTL_MS);
      expect(password.expires_at.getTime() - password.last_seen_at.getTime()).toBe(MFA_PENDING_SESSION_TTL_MS);
    } finally {
      await prisma.session.deleteMany({ where: { user_id: { in: [backupUserId, passwordUserId] } } });
      await prisma.userMfaMethod.deleteMany({ where: { user_id: backupUserId } });
      await prisma.user.deleteMany({ where: { id: { in: [backupUserId, passwordUserId] } } });
    }
  });
});

describe("validateSession MFA policy", () => {
  it("rejects stale operator full session after admin role is granted", async () => {
    const userId = "user-elevate-session";
    await prisma.user.create({
      data: {
        id: userId,
        email: "elevate-session@example.com",
        password_hash: await hashPassword(PASSWORD),
      },
    });
    await prisma.roleAssignment.create({
      data: { user_id: userId, role: "operator", scope_type: "instance" },
    });

    const loginResult = await login(prisma, {
      email: "elevate-session@example.com",
      password: PASSWORD,
    });
    expect(loginResult.ok).toBe(true);
    if (!loginResult.ok) return;
    expect(await validateSession(prisma, loginResult.rawToken)).not.toBeNull();

    await new Promise((r) => setTimeout(r, 5));
    await prisma.roleAssignment.create({
      data: { user_id: userId, role: "admin", scope_type: "instance" },
    });

    expect(await userRequiresMfa(prisma, userId)).toBe(true);
    expect(await validateSession(prisma, loginResult.rawToken)).toBeNull();
  });
});

describe("recovery code format", () => {
  it("uses 64-bit entropy (16 hex chars)", () => {
    const code = generateRecoveryCodePlaintext();
    expect(code).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(normalizeRecoveryCode(code)).toHaveLength(16);
  });
});

describe("backup recovery codes", () => {
  it("hashes codes and rejects second use", async () => {
    const userId = "user-backup-rc";
    await prisma.user.create({
      data: { id: userId, email: "backup@example.com", password_hash: await hashPassword(PASSWORD) },
    });

    const { codes } = await regenerateBackupRecoveryCodes(prisma, userId);
    const rows = await prisma.userMfaMethod.findMany({
      where: { user_id: userId, type: "recovery" },
    });
    expect(rows.every((r) => r.credential_hash && !r.credential_hash.includes(codes[0]!))).toBe(
      true,
    );
    expect(await verifyBackupRecoveryCode(prisma, userId, codes[0]!)).toBe(true);
    expect(await verifyBackupRecoveryCode(prisma, userId, codes[0]!)).toBe(false);
  });

  it("regenerate invalidates old backup codes", async () => {
    const userId = "user-regen-rc";
    await prisma.user.create({
      data: { id: userId, email: "regen@example.com", password_hash: await hashPassword(PASSWORD) },
    });

    const first = await regenerateBackupRecoveryCodes(prisma, userId);
    const second = await regenerateBackupRecoveryCodes(prisma, userId);
    expect(await verifyBackupRecoveryCode(prisma, userId, first.codes[0]!)).toBe(false);
    expect(await verifyBackupRecoveryCode(prisma, userId, second.codes[0]!)).toBe(true);
  });
});

describe("trusted device", () => {
  it("rejects a token that does not match a stored trusted device", async () => {
    expect(await validateTrustedDevice(prisma, USER_ADMIN, "missing-trusted-device-token")).toBe(false);
  });

  it("skips MFA when valid trusted device token present", async () => {
    await resetUserMfa(prisma, USER_ADMIN);
    const secret = generateTotpSecret();
    await prisma.userMfaMethod.create({
      data: {
        user_id: USER_ADMIN,
        type: "totp",
        secret_enc: encryptTotpSecret(secret),
        confirmed_at: new Date(),
      },
    });

    const { rawToken } = await createTrustedDevice(prisma, { userId: USER_ADMIN });
    const result = await login(prisma, {
      email: "mfa-admin@example.com",
      password: PASSWORD,
      trustedDeviceToken: rawToken,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.next).toBe(LOGIN_NEXT.COMPLETE);
  });

  it("revoke trusted devices invalidates token", async () => {
    const { rawToken } = await createTrustedDevice(prisma, { userId: USER_ADMIN });
    await revokeAllTrustedDevicesForUser(prisma, USER_ADMIN);
    expect(await validateTrustedDevice(prisma, USER_ADMIN, rawToken)).toBe(false);
  });

  it("revokeTrustedDeviceByToken revokes only matching cookie token", async () => {
    const first = await createTrustedDevice(prisma, { userId: USER_ADMIN });
    const second = await createTrustedDevice(prisma, { userId: USER_ADMIN });

    await revokeTrustedDeviceByToken(prisma, USER_ADMIN, first.rawToken);

    expect(await validateTrustedDevice(prisma, USER_ADMIN, first.rawToken)).toBe(false);
    expect(await validateTrustedDevice(prisma, USER_ADMIN, second.rawToken)).toBe(true);
  });

  it("rejects when a later request's IP and User-Agent both differ from creation", async () => {
    const { rawToken } = await createTrustedDevice(prisma, {
      userId: USER_ADMIN,
      ip: "203.0.113.10",
      userAgent: "Mozilla/5.0 TrustedBrowser/1.0",
    });

    expect(
      await validateTrustedDevice(prisma, USER_ADMIN, rawToken, {
        ip: "198.51.100.20",
        userAgent: "Mozilla/5.0 DifferentBrowser/9.9",
      }),
    ).toBe(false);
  });

  it("accepts a same-device follow-up request with matching IP and User-Agent", async () => {
    const { rawToken } = await createTrustedDevice(prisma, {
      userId: USER_ADMIN,
      ip: "203.0.113.10",
      userAgent: "Mozilla/5.0 TrustedBrowser/1.0",
    });

    expect(
      await validateTrustedDevice(prisma, USER_ADMIN, rawToken, {
        ip: "203.0.113.10",
        userAgent: "Mozilla/5.0 TrustedBrowser/1.0",
      }),
    ).toBe(true);
  });

  it("rejects when the IP rotates even though the User-Agent still matches - a bare User-Agent match is not proof of device (guessable, client-controlled header)", async () => {
    const { rawToken } = await createTrustedDevice(prisma, {
      userId: USER_ADMIN,
      ip: "203.0.113.10",
      userAgent: "Mozilla/5.0 TrustedBrowser/1.0",
    });

    expect(
      await validateTrustedDevice(prisma, USER_ADMIN, rawToken, {
        ip: "198.51.100.99",
        userAgent: "Mozilla/5.0 TrustedBrowser/1.0",
      }),
    ).toBe(false);
  });

  it("accepts when the User-Agent changes but the IP still matches (browser update) - User-Agent is recorded but never gates the decision", async () => {
    const { rawToken } = await createTrustedDevice(prisma, {
      userId: USER_ADMIN,
      ip: "203.0.113.10",
      userAgent: "Mozilla/5.0 TrustedBrowser/1.0",
    });

    expect(
      await validateTrustedDevice(prisma, USER_ADMIN, rawToken, {
        ip: "203.0.113.10",
        userAgent: "Mozilla/5.0 TrustedBrowser/2.0",
      }),
    ).toBe(true);
  });

  it("treats a trusted device with no recorded IP/User-Agent as still valid (pre-fix rows)", async () => {
    const { rawToken } = await createTrustedDevice(prisma, { userId: USER_ADMIN });

    expect(
      await validateTrustedDevice(prisma, USER_ADMIN, rawToken, {
        ip: "203.0.113.10",
        userAgent: "Mozilla/5.0 TrustedBrowser/1.0",
      }),
    ).toBe(true);
  });

  it("login() falls through to requiring MFA when the trusted-device token's IP/User-Agent no longer match", async () => {
    await resetUserMfa(prisma, USER_ADMIN);
    const secret = generateTotpSecret();
    await prisma.userMfaMethod.create({
      data: {
        user_id: USER_ADMIN,
        type: "totp",
        secret_enc: encryptTotpSecret(secret),
        confirmed_at: new Date(),
      },
    });

    const { rawToken } = await createTrustedDevice(prisma, {
      userId: USER_ADMIN,
      ip: "203.0.113.10",
      userAgent: "Mozilla/5.0 TrustedBrowser/1.0",
    });

    const result = await login(prisma, {
      email: "mfa-admin@example.com",
      password: PASSWORD,
      trustedDeviceToken: rawToken,
      ip: "198.51.100.20",
      userAgent: "Mozilla/5.0 DifferentBrowser/9.9",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.next).toBe(LOGIN_NEXT.MFA_REQUIRED);
  });

  it("login() still requires MFA for a stolen password + stolen cookie replayed from a different network with a guessed User-Agent", async () => {
    // The exact attack a bare User-Agent match used to permit: attacker has the account
    // password (phishing/breach) and a copied trusted-device cookie value (infostealer, leaked
    // browser-profile backup) but is not on the victim's network - they send a common,
    // easily-guessed User-Agent string hoping it alone vouches for the device.
    await resetUserMfa(prisma, USER_ADMIN);
    const secret = generateTotpSecret();
    await prisma.userMfaMethod.create({
      data: {
        user_id: USER_ADMIN,
        type: "totp",
        secret_enc: encryptTotpSecret(secret),
        confirmed_at: new Date(),
      },
    });

    const { rawToken } = await createTrustedDevice(prisma, {
      userId: USER_ADMIN,
      ip: "203.0.113.10",
      userAgent: "Mozilla/5.0 TrustedBrowser/1.0",
    });

    const result = await login(prisma, {
      email: "mfa-admin@example.com",
      password: PASSWORD,
      trustedDeviceToken: rawToken,
      ip: "198.51.100.20",
      userAgent: "Mozilla/5.0 TrustedBrowser/1.0", // guessed/copied exactly - IP is the only signal that differs
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.next).toBe(LOGIN_NEXT.MFA_REQUIRED);
  });
});

describe("emergency recovery", () => {
  it("stores hash not plaintext", async () => {
    const { code } = await generateEmergencyRecoveryCode(prisma, USER_ADMIN);
    const row = await prisma.userMfaMethod.findFirst({
      where: { user_id: USER_ADMIN, label: "emergency" },
    });
    expect(row?.credential_hash).toBeTruthy();
    expect(row?.credential_hash).not.toContain(code);
  });

  it("wraps the delete-then-create rotation in a single transaction (matching regenerateBackupRecoveryCodes)", async () => {
    const tx = {
      userMfaMethod: {
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockResolvedValue({}),
      },
    };
    const order: string[] = [];
    tx.userMfaMethod.deleteMany.mockImplementation(async () => {
      order.push("delete");
      return { count: 1 };
    });
    tx.userMfaMethod.create.mockImplementation(async () => {
      order.push("create");
      return {};
    });
    const fakePrisma = {
      $transaction: vi.fn(async (fn: (inner: typeof tx) => Promise<unknown>) => fn(tx)),
    };

    const result = await generateEmergencyRecoveryCode(fakePrisma as never, USER_ADMIN);

    expect(fakePrisma.$transaction).toHaveBeenCalledOnce();
    expect(order).toEqual(["delete", "create"]);
    expect(result.code).toBeTruthy();
    expect(tx.userMfaMethod.deleteMany).toHaveBeenCalledWith({
      where: { user_id: USER_ADMIN, type: "recovery", label: "emergency", last_used_at: null },
    });
  });
});

describe("SystemSettings", () => {
  it("reads session_ttl from DB", async () => {
    expect(await getSessionTtlAdminMs(prisma)).toBe(999999);
  });

  it("env override locks setting", async () => {
    process.env["SESSION_TTL_ADMIN_MS"] = "12345";
    expect(await getSessionTtlAdminMs(prisma)).toBe(12345);
    delete process.env["SESSION_TTL_ADMIN_MS"];
  });

  it("mfa_required_roles includes admin and superadmin", async () => {
    const roles = await getMfaRequiredRoles(prisma);
    expect(roles).toContain("admin");
    expect(roles).toContain("superadmin");
  });
});

describe("policy", () => {
  it("requires MFA for admin not operator", async () => {
    expect(await userRequiresMfa(prisma, USER_ADMIN)).toBe(true);
    expect(await userRequiresMfa(prisma, USER_OP)).toBe(false);
  });
});

describe("TOTP verify", () => {
  it("accepts valid code and rejects invalid", () => {
    const secret = generateTotpSecret();
    const enc = encryptTotpSecret(secret);
    const code = generateTotpCode(secret);
    expect(verifyTotpCode(enc, code)).toBe(true);
    expect(verifyTotpCode(enc, "000000")).toBe(false);
  });

  it("rejects replay of the same time step via afterTimeStep", () => {
    const secret = generateTotpSecret();
    const enc = encryptTotpSecret(secret);
    const code = generateTotpCode(secret);
    const first = verifyTotpCodeDetailed(enc, code);
    expect(first.valid).toBe(true);
    if (!first.valid) return;

    const replay = verifyTotpCodeDetailed(enc, code, { afterTimeStep: first.timeStep });
    expect(replay.valid).toBe(false);
  });

  it("verifyUserTotpCode rejects immediate replay of the same code", async () => {
    const userId = "user-totp-replay";
    const password_hash = await hashPassword(PASSWORD);
    await prisma.user.create({
      data: { id: userId, email: "totp-replay@example.com", password_hash },
    });

    const secret = generateTotpSecret();
    await prisma.userMfaMethod.create({
      data: {
        user_id: userId,
        type: "totp",
        secret_enc: encryptTotpSecret(secret),
        confirmed_at: new Date(),
      },
    });

    const code = generateTotpCode(secret);
    expect(await verifyUserTotpCode(prisma, userId, code)).toBe(true);
    expect(await verifyUserTotpCode(prisma, userId, code)).toBe(false);
  });
});

describe("cancelPendingTotpEnrollment", () => {
  it("removes pending TOTP and enrollment backup codes", async () => {
    const userId = "user-cancel-pending";
    await prisma.user.create({
      data: { id: userId, email: "cancel-pending@example.com", password_hash: await hashPassword(PASSWORD) },
    });

    const started = await startTotpEnrollment(prisma, userId);
    expect(started).not.toBeNull();

    await cancelPendingTotpEnrollment(prisma, userId);

    expect(await prisma.userMfaMethod.count({ where: { user_id: userId, type: "totp" } })).toBe(0);
    expect(
      await prisma.userMfaMethod.count({
        where: { user_id: userId, type: "recovery" },
      }),
    ).toBe(0);
  });

  it("does not delete confirmed TOTP or saved recovery codes when no pending enrollment", async () => {
    const userId = "user-cancel-confirmed";
    await prisma.user.create({
      data: { id: userId, email: "cancel-confirmed@example.com", password_hash: await hashPassword(PASSWORD) },
    });

    const secret = generateTotpSecret();
    await prisma.userMfaMethod.create({
      data: {
        user_id: userId,
        type: "totp",
        secret_enc: encryptTotpSecret(secret),
        confirmed_at: new Date(),
      },
    });
    await regenerateBackupRecoveryCodes(prisma, userId);
    const recoveryCountBefore = await prisma.userMfaMethod.count({
      where: { user_id: userId, type: "recovery" },
    });

    await cancelPendingTotpEnrollment(prisma, userId);

    expect(await userHasConfirmedTotp(prisma, userId)).toBe(true);
    expect(
      await prisma.userMfaMethod.count({
        where: { user_id: userId, type: "recovery" },
      }),
    ).toBe(recoveryCountBefore);
  });
});

describe("resetUserMfa", () => {
  it("clears methods and revokes sessions", async () => {
    await resetUserMfa(prisma, USER_ADMIN);
    const secret = generateTotpSecret();
    await prisma.userMfaMethod.create({
      data: {
        user_id: USER_ADMIN,
        type: "totp",
        secret_enc: encryptTotpSecret(secret),
        confirmed_at: new Date(),
      },
    });

    const loginResult = await login(prisma, {
      email: "mfa-admin@example.com",
      password: PASSWORD,
    });
    expect(loginResult.ok).toBe(true);

    await resetUserMfa(prisma, USER_ADMIN);
    expect(await prisma.userMfaMethod.count({ where: { user_id: USER_ADMIN } })).toBe(0);

    if (loginResult.ok) {
      expect(await validatePartialSession(prisma, loginResult.rawToken)).toBeNull();
    }
  });
});
