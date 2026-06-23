import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/password.js";
import { login, completeMfa } from "../src/login.js";
import { LOGIN_NEXT, SESSION_STAGE } from "../src/constants.js";
import {
  startTotpEnrollment,
  getOrStartTotpEnrollment,
  resumePendingTotpEnrollment,
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
import { generateEmergencyRecoveryCode } from "../src/mfa/emergency-recovery.js";
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
import { validateSession, validatePartialSession, promoteSessionToFull } from "../src/session.js";
import { getSessionTtlAdminMs, getMfaRequiredRoles } from "../src/settings/resolver.js";
import { SETTING_SESSION_TTL } from "../src/settings/keys.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_ROOT = path.resolve(__dirname, "..", "..", "db");

const USER_ADMIN = "user-mfa-admin";
const USER_OP = "user-mfa-op";
const PASSWORD = "mfa-test-pass-123";

let prisma: PrismaClient;

beforeAll(async () => {
  execSync("npx prisma db push --force-reset --accept-data-loss", {
    cwd: DB_ROOT,
    env: { ...process.env },
    stdio: "pipe",
  });

  prisma = new PrismaClient();
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
    expect(await validateSession(prisma, loginResult.rawToken)).not.toBeNull();
  });

  it("does not consume recovery code when session promotion fails", async () => {
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

    await prisma.session.update({
      where: { id: loginResult.sessionId },
      data: { stage: SESSION_STAGE.FULL },
    });

    const mfa = await completeMfa(prisma, {
      userId: USER_ADMIN,
      sessionId: loginResult.sessionId,
      code: codes[0]!,
    });
    expect(mfa.ok).toBe(false);
    expect(await verifyBackupRecoveryCode(prisma, USER_ADMIN, codes[0]!)).toBe(true);
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

    expect(await promoteSessionToFull(prisma, loginResult.sessionId, loginResult.userId)).toBe(false);
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
