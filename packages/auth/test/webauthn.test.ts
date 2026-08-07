import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { hashPassword } from "../src/password.js";
import { login } from "../src/login.js";
import { LOGIN_NEXT, SESSION_STAGE } from "../src/constants.js";
import {
  beginWebauthnRegistration,
  finishWebauthnRegistration,
  listWebauthnCredentials,
  removeWebauthnCredential,
  beginWebauthnAssertion,
  finishWebauthnAssertion,
  type WebauthnRpConfig,
} from "../src/mfa/webauthn.js";
import { startTotpEnrollment, confirmTotpEnrollment, resetUserMfa } from "../src/mfa/enrollment.js";
import { generateTotpCode, parseTotpSecretFromOtpauthUri } from "../src/mfa/totp.js";
import {
  userHasAnyConfirmedMfaMethod,
  userHasUnacknowledgedBackupCodes,
  userRequiresMfaStepUp,
} from "../src/mfa/policy.js";
import { validateSession, validatePartialSession, promoteSessionToFull } from "../src/session.js";
import { assertTestDatabaseUrl } from "@admitto/db/test-db-guard";
import { createVirtualAuthenticator } from "../src/webauthn-testing.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_ROOT = path.resolve(__dirname, "..", "..", "db");

const PASSWORD = "webauthn-test-pass-123";
const RP: WebauthnRpConfig = { rpName: "Admitto", rpID: "localhost", origin: "http://localhost:3000" };

let prisma: PrismaClient;

beforeAll(async () => {
  assertTestDatabaseUrl(process.env.DATABASE_URL ?? "");
  execSync("npx prisma db push --force-reset --accept-data-loss", {
    cwd: DB_ROOT,
    env: { ...process.env },
    stdio: "pipe",
  });
  prisma = createTestPrismaClient();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function createAdmin(id: string, email: string) {
  await prisma.user.create({
    data: { id, email, password_hash: await hashPassword(PASSWORD) },
  });
  await prisma.roleAssignment.create({
    data: { user_id: id, role: "admin", scope_type: "instance", scope_id: null },
  });
}

/** Full register round trip via the virtual authenticator. */
async function registerCredential(
  userId: string,
  attachment: "platform" | "cross-platform",
  label: string | null = null,
) {
  const authenticator = createVirtualAuthenticator();
  const begin = await beginWebauthnRegistration(prisma, userId, attachment, RP);
  if (!begin) throw new Error("beginWebauthnRegistration returned null");
  const response = authenticator.register({ challenge: begin.challenge, rpID: RP.rpID, origin: RP.origin });
  const result = await finishWebauthnRegistration(prisma, userId, response, begin.challenge, attachment, label, RP);
  return { authenticator, begin, response, result };
}

describe("WebAuthn registration", () => {
  it("registers a platform credential (passkey) as the user's first MFA method", async () => {
    const userId = "user-wa-passkey";
    await createAdmin(userId, "wa-passkey@example.com");

    const { result } = await registerCredential(userId, "platform", "My MacBook");
    expect(result).not.toBeNull();
    expect(result!.backupCodes.length).toBeGreaterThan(0);

    const row = await prisma.userMfaMethod.findUnique({ where: { id: result!.credentialRowId } });
    expect(row?.type).toBe("webauthn");
    expect(row?.webauthn_attachment).toBe("platform");
    expect(row?.label).toBe("My MacBook");
    expect(row?.confirmed_at).toBeTruthy();
    expect(row?.webauthn_sign_count).toBe(1);
    expect(row?.backup_codes_acknowledged_at).toBeNull();

    expect(await userHasAnyConfirmedMfaMethod(prisma, userId)).toBe(true);
    expect(await userHasUnacknowledgedBackupCodes(prisma, userId)).toBe(true);
  });

  it("registers a cross-platform credential (security key) with residentKey discouraged", async () => {
    const userId = "user-wa-seckey";
    await createAdmin(userId, "wa-seckey@example.com");

    const begin = await beginWebauthnRegistration(prisma, userId, "cross-platform", RP);
    expect(begin?.options.authenticatorSelection?.residentKey).toBe("discouraged");
    expect(begin?.options.authenticatorSelection?.authenticatorAttachment).toBe("cross-platform");

    const { result } = await registerCredential(userId, "cross-platform", "YubiKey 5C");
    expect(result?.credentialRowId).toBeTruthy();

    const row = await prisma.userMfaMethod.findUnique({ where: { id: result!.credentialRowId } });
    expect(row?.webauthn_attachment).toBe("cross-platform");
  });

  it("a second credential does not re-generate or re-gate already-acknowledged backup codes", async () => {
    const userId = "user-wa-second-method";
    await createAdmin(userId, "wa-second@example.com");

    const first = await registerCredential(userId, "platform", "Key 1");
    expect(first.result!.backupCodes.length).toBeGreaterThan(0);
    // Simulate the user having acknowledged their backup codes (IAM-002 step).
    await prisma.userMfaMethod.update({
      where: { id: first.result!.credentialRowId },
      data: { backup_codes_acknowledged_at: new Date() },
    });
    const recoveryCountBefore = await prisma.userMfaMethod.count({
      where: { user_id: userId, type: "recovery" },
    });

    const second = await registerCredential(userId, "cross-platform", "Key 2");
    expect(second.result!.backupCodes).toEqual([]);
    expect(
      await prisma.userMfaMethod.count({ where: { user_id: userId, type: "recovery" } }),
    ).toBe(recoveryCountBefore);
    expect(await userHasUnacknowledgedBackupCodes(prisma, userId)).toBe(false);
  });

  it("TOTP added after an already-acknowledged passkey does not re-gate on backup codes", async () => {
    const userId = "user-wa-then-totp";
    await createAdmin(userId, "wa-then-totp@example.com");

    const passkey = await registerCredential(userId, "platform", "Only Key");
    await prisma.userMfaMethod.update({
      where: { id: passkey.result!.credentialRowId },
      data: { backup_codes_acknowledged_at: new Date() },
    });

    const enrollment = await startTotpEnrollment(prisma, userId);
    expect(enrollment?.backupCodes).toEqual([]);
    const secret = parseTotpSecretFromOtpauthUri(enrollment!.otpauthUri)!;
    expect(await confirmTotpEnrollment(prisma, userId, generateTotpCode(secret))).toBe(true);

    expect(await userHasUnacknowledgedBackupCodes(prisma, userId)).toBe(false);
  });

  it("rejects a response signed for a different challenge", async () => {
    const userId = "user-wa-bad-challenge";
    await createAdmin(userId, "wa-bad-challenge@example.com");

    const authenticator = createVirtualAuthenticator();
    const begin = await beginWebauthnRegistration(prisma, userId, "platform", RP);
    const response = authenticator.register({ challenge: "wrong-challenge", rpID: RP.rpID, origin: RP.origin });

    const result = await finishWebauthnRegistration(prisma, userId, response, begin!.challenge, "platform", null, RP);
    expect(result).toBeNull();
  });

  it("rejects a response for a different origin", async () => {
    const userId = "user-wa-bad-origin";
    await createAdmin(userId, "wa-bad-origin@example.com");

    const authenticator = createVirtualAuthenticator();
    const begin = await beginWebauthnRegistration(prisma, userId, "platform", RP);
    const response = authenticator.register({
      challenge: begin!.challenge,
      rpID: RP.rpID,
      origin: "https://evil.example.com",
    });

    const result = await finishWebauthnRegistration(prisma, userId, response, begin!.challenge, "platform", null, RP);
    expect(result).toBeNull();
  });

  it("rejects re-registering the same credential ID", async () => {
    const userId = "user-wa-dup";
    await createAdmin(userId, "wa-dup@example.com");
    const { authenticator } = await registerCredential(userId, "platform", "First");

    const begin = await beginWebauthnRegistration(prisma, userId, "platform", RP);
    const response = authenticator.register({ challenge: begin!.challenge, rpID: RP.rpID, origin: RP.origin });
    const result = await finishWebauthnRegistration(prisma, userId, response, begin!.challenge, "platform", null, RP);
    expect(result).toBeNull();
  });

  it("excludes the user's own existing credentials from a new registration's options", async () => {
    const userId = "user-wa-exclude";
    await createAdmin(userId, "wa-exclude@example.com");
    const { response: firstResponse } = await registerCredential(userId, "platform", "First");

    const begin = await beginWebauthnRegistration(prisma, userId, "cross-platform", RP);
    expect(begin?.options.excludeCredentials?.map((c) => c.id)).toContain(firstResponse.id);
  });
});

describe("WebAuthn credential management", () => {
  it("lists only this user's confirmed credentials", async () => {
    const userA = "user-wa-list-a";
    const userB = "user-wa-list-b";
    await createAdmin(userA, "wa-list-a@example.com");
    await createAdmin(userB, "wa-list-b@example.com");
    await registerCredential(userA, "platform", "A's key");
    await registerCredential(userB, "platform", "B's key");

    const listA = await listWebauthnCredentials(prisma, userA);
    expect(listA).toHaveLength(1);
    expect(listA[0]?.label).toBe("A's key");
    expect(listA[0]?.attachment).toBe("platform");
  });

  it("removes a credential only for its owner", async () => {
    const userId = "user-wa-remove";
    const otherUserId = "user-wa-remove-other";
    await createAdmin(userId, "wa-remove@example.com");
    await createAdmin(otherUserId, "wa-remove-other@example.com");
    const { result } = await registerCredential(userId, "platform", "To remove");

    expect(await removeWebauthnCredential(prisma, otherUserId, result!.credentialRowId)).toBe(false);
    expect(await removeWebauthnCredential(prisma, userId, result!.credentialRowId)).toBe(true);
    expect(await listWebauthnCredentials(prisma, userId)).toHaveLength(0);
  });
});

describe("WebAuthn assertion (login/step-up verification)", () => {
  it("returns null when the user has no credentials", async () => {
    const userId = "user-wa-no-creds";
    await createAdmin(userId, "wa-no-creds@example.com");
    expect(await beginWebauthnAssertion(prisma, userId, RP.rpID)).toBeNull();
  });

  it("verifies a legitimate assertion and advances the sign counter", async () => {
    const userId = "user-wa-assert";
    await createAdmin(userId, "wa-assert@example.com");
    const { authenticator, result } = await registerCredential(userId, "platform", "Assert key");

    const begin = await beginWebauthnAssertion(prisma, userId, RP.rpID);
    expect(begin?.options.allowCredentials).toHaveLength(1);

    const response = authenticator.authenticate({ challenge: begin!.challenge, rpID: RP.rpID, origin: RP.origin });
    const finished = await finishWebauthnAssertion(prisma, userId, response, begin!.challenge, RP);
    expect(finished?.credentialRowId).toBe(result!.credentialRowId);

    const row = await prisma.userMfaMethod.findUnique({ where: { id: result!.credentialRowId } });
    expect(row?.webauthn_sign_count).toBe(2); // 1 from registration, 2 from this assertion
    expect(row?.last_used_at?.getTime()).toBeGreaterThan(0);
  });

  it("rejects replaying the exact same assertion response twice (counter does not advance)", async () => {
    const userId = "user-wa-replay";
    await createAdmin(userId, "wa-replay@example.com");
    const { authenticator } = await registerCredential(userId, "platform", "Replay key");

    const begin = await beginWebauthnAssertion(prisma, userId, RP.rpID);
    const response = authenticator.authenticate({ challenge: begin!.challenge, rpID: RP.rpID, origin: RP.origin });

    expect(await finishWebauthnAssertion(prisma, userId, response, begin!.challenge, RP)).not.toBeNull();
    expect(await finishWebauthnAssertion(prisma, userId, response, begin!.challenge, RP)).toBeNull();
  });

  it("rejects an assertion signed with the wrong key", async () => {
    const userId = "user-wa-wrong-sig";
    await createAdmin(userId, "wa-wrong-sig@example.com");
    await registerCredential(userId, "platform", "Real key");
    const impostor = createVirtualAuthenticator();

    const begin = await beginWebauthnAssertion(prisma, userId, RP.rpID);
    // Impostor signs with its own key but claims the real credential ID is unknown to it, so
    // its own (different) id won't match any stored row — finishWebauthnAssertion looks up by
    // response.id, which naturally rejects an authenticator that was never registered.
    const response = impostor.authenticate({ challenge: begin!.challenge, rpID: RP.rpID, origin: RP.origin });
    expect(await finishWebauthnAssertion(prisma, userId, response, begin!.challenge, RP)).toBeNull();
  });
});

describe("WebAuthn-only user — login and session policy", () => {
  it("login flow reaches mfa_pending (not enrollment_required) once a passkey is confirmed", async () => {
    const userId = "user-wa-login";
    const email = "wa-login@example.com";
    await createAdmin(userId, email);

    const before = await login(prisma, { email, password: PASSWORD });
    expect(before.ok && before.next).toBe(LOGIN_NEXT.ENROLLMENT_REQUIRED);

    await registerCredential(userId, "platform", "Login key");

    const after = await login(prisma, { email, password: PASSWORD });
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.next).toBe(LOGIN_NEXT.MFA_REQUIRED);
    const partial = await validatePartialSession(prisma, after.rawToken);
    expect(partial?.stage).toBe(SESSION_STAGE.MFA_PENDING);
  });

  it("a full session for a WebAuthn-only user passes assertFullSessionMfaPolicy", async () => {
    const userId = "user-wa-full-session";
    const email = "wa-full-session@example.com";
    await createAdmin(userId, email);
    const { result } = await registerCredential(userId, "platform", "Full session key");
    await prisma.userMfaMethod.update({
      where: { id: result!.credentialRowId },
      data: { backup_codes_acknowledged_at: new Date() },
    });

    const loginResult = await login(prisma, { email, password: PASSWORD });
    expect(loginResult.ok).toBe(true);
    if (!loginResult.ok) return;

    // WebAuthn login-time verification is wired in a later PR; promote directly here to isolate
    // the session-policy check this PR is responsible for (a WebAuthn-only full session must not
    // be rejected the way a TOTP-only check would have rejected it before this change).
    const promoted = await promoteSessionToFull(prisma, loginResult.sessionId, userId);
    expect(promoted).toBe(SESSION_STAGE.FULL);
    expect(await validateSession(prisma, loginResult.rawToken)).not.toBeNull();
  });

  it("userRequiresMfaStepUp is true for a WebAuthn-only confirmed admin", async () => {
    const userId = "user-wa-stepup";
    await createAdmin(userId, "wa-stepup@example.com");
    expect(await userRequiresMfaStepUp(prisma, userId)).toBe(false);

    await registerCredential(userId, "platform", "Step-up key");
    expect(await userRequiresMfaStepUp(prisma, userId)).toBe(true);
  });

  it("resetUserMfa clears WebAuthn credentials same as TOTP", async () => {
    const userId = "user-wa-reset";
    await createAdmin(userId, "wa-reset@example.com");
    await registerCredential(userId, "platform", "To be reset");

    await resetUserMfa(prisma, userId);
    expect(await listWebauthnCredentials(prisma, userId)).toHaveLength(0);
    expect(await userHasAnyConfirmedMfaMethod(prisma, userId)).toBe(false);
  });
});
