import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { assertTestDatabaseUrl } from "@admitto/db/test-db-guard";
import { hashPassword } from "../src/password.js";
import { loginWithPasskey } from "../src/login.js";
import { LOGIN_NEXT } from "../src/constants.js";
import { beginWebauthnRegistration, finishWebauthnRegistration, type WebauthnRpConfig } from "../src/mfa/webauthn.js";
import { beginPasskeyLogin, finishPasskeyLogin } from "../src/webauthn-login.js";
import { createVirtualAuthenticator } from "../src/webauthn-testing.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_ROOT = path.resolve(__dirname, "..", "..", "db");

const PASSWORD = "passkey-login-test-pass-123";
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

async function createUser(id: string, email: string, overrides: Partial<{ is_active: boolean }> = {}) {
  await prisma.user.create({
    data: { id, email, password_hash: await hashPassword(PASSWORD), ...overrides },
  });
  await prisma.roleAssignment.create({
    data: { user_id: id, role: "admin", scope_type: "instance", scope_id: null },
  });
}

/** Full register round trip via the virtual authenticator (same helper `webauthn.test.ts` uses). */
async function registerCredential(userId: string, label: string | null = null) {
  const authenticator = createVirtualAuthenticator();
  const begin = await beginWebauthnRegistration(prisma, userId, "platform", RP);
  if (!begin) throw new Error("beginWebauthnRegistration returned null");
  const response = authenticator.register({ challenge: begin.challenge, rpID: RP.rpID, origin: RP.origin });
  const result = await finishWebauthnRegistration(prisma, userId, response, begin.challenge, "platform", label, RP);
  if (!result) throw new Error("finishWebauthnRegistration returned null");
  // Acknowledge backup codes so login tests exercise the FULL-session path, not the
  // separate BACKUP_CODES_REQUIRED gate `finalizeLoginSession` also enforces.
  await prisma.userMfaMethod.update({
    where: { id: result.credentialRowId },
    data: { backup_codes_acknowledged_at: new Date() },
  });
  return { authenticator, begin, response, result };
}

describe("beginPasskeyLogin / finishPasskeyLogin", () => {
  it("begins with no allowCredentials (discoverable/usernameless) and requires user verification", async () => {
    const begin = await beginPasskeyLogin(RP.rpID);
    expect(begin.options.allowCredentials).toBeUndefined();
    expect(begin.options.userVerification).toBe("required");
  });

  it("resolves the owning userId from the credential alone, with no userId supplied ahead of time", async () => {
    const userId = "user-pl-resolve";
    await createUser(userId, "pl-resolve@example.com");
    const { authenticator, result } = await registerCredential(userId, "Resolve key");

    const begin = await beginPasskeyLogin(RP.rpID);
    const response = authenticator.authenticate({ challenge: begin.challenge, rpID: RP.rpID, origin: RP.origin });
    const finished = await finishPasskeyLogin(prisma, response, begin.challenge, RP);

    expect(finished?.userId).toBe(userId);
    expect(finished?.credentialRowId).toBe(result.credentialRowId);
  });

  it("returns null for a credential ID no account has registered", async () => {
    const impostor = createVirtualAuthenticator();
    const begin = await beginPasskeyLogin(RP.rpID);
    const response = impostor.authenticate({ challenge: begin.challenge, rpID: RP.rpID, origin: RP.origin });
    expect(await finishPasskeyLogin(prisma, response, begin.challenge, RP)).toBeNull();
  });

  it("rejects a response signed for a different challenge", async () => {
    const userId = "user-pl-bad-challenge";
    await createUser(userId, "pl-bad-challenge@example.com");
    const { authenticator } = await registerCredential(userId, "Key");

    const begin = await beginPasskeyLogin(RP.rpID);
    const response = authenticator.authenticate({ challenge: "wrong-challenge", rpID: RP.rpID, origin: RP.origin });
    expect(await finishPasskeyLogin(prisma, response, begin.challenge, RP)).toBeNull();
  });
});

describe("loginWithPasskey", () => {
  it("issues a full session directly, no password and no second MFA step", async () => {
    const userId = "user-pl-full-session";
    const email = "pl-full-session@example.com";
    await createUser(userId, email);
    const { authenticator } = await registerCredential(userId, "Login key");

    const begin = await beginPasskeyLogin(RP.rpID);
    const response = authenticator.authenticate({ challenge: begin.challenge, rpID: RP.rpID, origin: RP.origin });

    const result = await loginWithPasskey(prisma, { response, challenge: begin.challenge, rp: RP });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.userId).toBe(userId);
    expect(result.next).toBe(LOGIN_NEXT.COMPLETE);
  });

  it("records the login-success audit row with method \"passkey\"", async () => {
    const userId = "user-pl-audit";
    const email = "pl-audit@example.com";
    await createUser(userId, email);
    const { authenticator } = await registerCredential(userId, "Audit key");

    const begin = await beginPasskeyLogin(RP.rpID);
    const response = authenticator.authenticate({ challenge: begin.challenge, rpID: RP.rpID, origin: RP.origin });
    await loginWithPasskey(prisma, { response, challenge: begin.challenge, rp: RP });

    const row = await prisma.securityAuditLog.findFirst({
      where: { user_id: userId, event_type: "auth.login.success" },
      orderBy: { created_at: "desc" },
    });
    expect((row?.metadata as { method?: string } | null)?.method).toBe("passkey");
  });

  it("rejects an inactive account even with a valid passkey assertion", async () => {
    const userId = "user-pl-inactive";
    const email = "pl-inactive@example.com";
    await createUser(userId, email);
    const { authenticator } = await registerCredential(userId, "Key");
    await prisma.user.update({ where: { id: userId }, data: { is_active: false } });

    const begin = await beginPasskeyLogin(RP.rpID);
    const response = authenticator.authenticate({ challenge: begin.challenge, rpID: RP.rpID, origin: RP.origin });
    const result = await loginWithPasskey(prisma, { response, challenge: begin.challenge, rp: RP });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("inactive");
  });

  it("rejects an unknown/forged credential without identifying any account", async () => {
    const impostor = createVirtualAuthenticator();
    const begin = await beginPasskeyLogin(RP.rpID);
    const response = impostor.authenticate({ challenge: begin.challenge, rpID: RP.rpID, origin: RP.origin });

    const result = await loginWithPasskey(prisma, { response, challenge: begin.challenge, rp: RP });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_credentials");
  });

  it("still routes to BACKUP_CODES_REQUIRED when the account's backup codes are unacknowledged", async () => {
    const userId = "user-pl-backup-codes";
    const email = "pl-backup-codes@example.com";
    await createUser(userId, email);
    // Register directly (not via the registerCredential() helper, which pre-acknowledges backup
    // codes) so this account's first-ever MFA method still owes that acknowledgment.
    const authenticator = createVirtualAuthenticator();
    const beginReg = await beginWebauthnRegistration(prisma, userId, "platform", RP);
    const regResponse = authenticator.register({ challenge: beginReg!.challenge, rpID: RP.rpID, origin: RP.origin });
    await finishWebauthnRegistration(prisma, userId, regResponse, beginReg!.challenge, "platform", "Key", RP);

    const begin = await beginPasskeyLogin(RP.rpID);
    const response = authenticator.authenticate({ challenge: begin.challenge, rpID: RP.rpID, origin: RP.origin });
    const result = await loginWithPasskey(prisma, { response, challenge: begin.challenge, rp: RP });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.next).toBe(LOGIN_NEXT.BACKUP_CODES_REQUIRED);
  });
});
