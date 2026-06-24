import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  createSession,
  hashPassword,
  parseTotpSecretFromOtpauthUri,
  SESSION_STAGE,
  verifyPassword,
} from "@admitto/auth";
import { encryptTotpSecret, generateTotpCode, generateTotpSecret } from "@admitto/auth/testing";
import { createApp } from "../../src/app.js";
import { InMemoryRateLimitStore } from "../../src/rate-limit/in-memory.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };

const ORG_ACCOUNT = "org-account-test";
const EMAIL_USER = "account-user@example.com";
const EMAIL_OIDC = "account-oidc@example.com";
const EMAIL_OTHER = "account-other@example.com";
const PASSWORD = "account-pass-123";
const NEW_PASSWORD = "account-new-pass-456";

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let rateLimitStore: InMemoryRateLimitStore;
let userId = "";
let oidcUserId = "";
let otherUserId = "";
let userCookie = "";
let userSessionId = "";
let prevInstanceOrgId: string | undefined;

async function seed(client: PrismaClient) {
  await client.session.deleteMany({ where: { user: { email: { in: [EMAIL_USER, EMAIL_OIDC, EMAIL_OTHER] } } } });
  await client.userMfaMethod.deleteMany({ where: { user: { email: { in: [EMAIL_USER, EMAIL_OIDC, EMAIL_OTHER] } } } });
  await client.roleAssignment.deleteMany({ where: { scope_id: ORG_ACCOUNT } });
  await client.user.deleteMany({ where: { email: { in: [EMAIL_USER, EMAIL_OIDC, EMAIL_OTHER] } } });
  await client.organization.deleteMany({ where: { id: ORG_ACCOUNT } });

  const password_hash = await hashPassword(PASSWORD);
  await client.organization.create({ data: { id: ORG_ACCOUNT, name: "Account Test Org", slug: "account-test" } });

  const user = await client.user.create({ data: { email: EMAIL_USER, password_hash, must_change_password: true } });
  userId = user.id;
  const oidcUser = await client.user.create({ data: { email: EMAIL_OIDC, password_hash: null } });
  oidcUserId = oidcUser.id;
  const otherUser = await client.user.create({ data: { email: EMAIL_OTHER, password_hash } });
  otherUserId = otherUser.id;

  await client.roleAssignment.createMany({
    data: [
      { user_id: userId, role: "admin", scope_type: "organization", scope_id: ORG_ACCOUNT },
      { user_id: oidcUserId, role: "operator", scope_type: "event", scope_id: "evt-account" },
      { user_id: otherUserId, role: "operator", scope_type: "event", scope_id: "evt-account" },
    ],
  });
}

beforeAll(async () => {
  prevInstanceOrgId = process.env.INSTANCE_ORG_ID;
  process.env.INSTANCE_ORG_ID = ORG_ACCOUNT;
  prisma = new PrismaClient();
  await seed(prisma);
  rateLimitStore = new InMemoryRateLimitStore();
  app = createApp({
    prisma,
    baseUrl: "https://admitto.example.com",
    rateLimitStore,
    skipCheckinBootValidation: true,
    adminDistRoot,
    mailDeliveryDeps: { exportSink: () => {} },
  });
  const session = await createSession(prisma, { userId, stage: SESSION_STAGE.FULL, ip: "127.0.0.1" });
  userCookie = `admitto_session=${session.rawToken}`;
  userSessionId = session.session.id;
});

afterEach(async () => {
  await prisma.userMfaMethod.deleteMany({ where: { user_id: userId } });
  await prisma.session.deleteMany({ where: { user_id: userId, id: { not: userSessionId } } });
  await prisma.user.update({ where: { id: userId }, data: { password_hash: await hashPassword(PASSWORD), must_change_password: false } });
});

afterAll(async () => {
  if (prevInstanceOrgId !== undefined) process.env.INSTANCE_ORG_ID = prevInstanceOrgId;
  else delete process.env.INSTANCE_ORG_ID;
  await prisma?.$disconnect();
});

describe("GET /api/account", () => {
  it("returns profile without password_hash", async () => {
    const res = await app.request("/api/account", { headers: { Cookie: userCookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.email).toBe(EMAIL_USER);
    expect(body.has_local_password).toBe(true);
    expect(body.must_change_password).toBe(true);
    expect(body).not.toHaveProperty("password_hash");
  });
});

describe("PATCH /api/account/password", () => {
  it("returns 401 wrong_password for bad current password", async () => {
    const res = await app.request("/api/account/password", {
      method: "PATCH",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ current_password: "wrong", new_password: NEW_PASSWORD, new_password_confirm: NEW_PASSWORD }),
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe("wrong_password");
  });

  it("changes hash, clears must_change_password, revokes other sessions", async () => {
    const other = await createSession(prisma, { userId, stage: SESSION_STAGE.FULL });
    const res = await app.request("/api/account/password", {
      method: "PATCH",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ current_password: PASSWORD, new_password: NEW_PASSWORD, new_password_confirm: NEW_PASSWORD }),
    });
    expect(res.status).toBe(200);
    const dbUser = await prisma.user.findUnique({ where: { id: userId } });
    expect(dbUser?.must_change_password).toBe(false);
    expect(await verifyPassword(NEW_PASSWORD, dbUser!.password_hash!)).toBe(true);
    expect((await prisma.session.findUnique({ where: { id: userSessionId } }))?.revoked_at).toBeNull();
    expect((await prisma.session.findUnique({ where: { id: other.session.id } }))?.revoked_at).not.toBeNull();
  });

  it("returns 400 no_local_password for OIDC-only account", async () => {
    const oidcSession = await createSession(prisma, { userId: oidcUserId, stage: SESSION_STAGE.FULL });
    const res = await app.request("/api/account/password", {
      method: "PATCH",
      headers: { Cookie: `admitto_session=${oidcSession.rawToken}`, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ current_password: "any", new_password: NEW_PASSWORD, new_password_confirm: NEW_PASSWORD }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("no_local_password");
    await prisma.session.delete({ where: { id: oidcSession.session.id } });
  });
});

describe("DELETE /api/account/sessions/:id", () => {
  it("returns 409 when revoking current session", async () => {
    const res = await app.request(`/api/account/sessions/${userSessionId}`, {
      method: "DELETE",
      headers: { Cookie: userCookie, ...sameOrigin },
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("cannot_revoke_current");
  });

  it("returns 403 when revoking another user's session", async () => {
    const otherSession = await createSession(prisma, { userId: otherUserId, stage: SESSION_STAGE.FULL });
    const res = await app.request(`/api/account/sessions/${otherSession.session.id}`, {
      method: "DELETE",
      headers: { Cookie: userCookie, ...sameOrigin },
    });
    expect(res.status).toBe(403);
    await prisma.session.delete({ where: { id: otherSession.session.id } });
  });
});

describe("POST /api/account/mfa/totp/*", () => {
  it("enrolls and confirms TOTP", async () => {
    const enrollRes = await app.request("/api/account/mfa/totp/enroll", {
      method: "POST",
      headers: { Cookie: userCookie, ...sameOrigin },
    });
    expect(enrollRes.status).toBe(200);
    const enroll = (await enrollRes.json()) as { otpauthUri: string; backupCodes: string[] };
    const secret = parseTotpSecretFromOtpauthUri(enroll.otpauthUri);
    const confirmRes = await app.request("/api/account/mfa/totp/confirm", {
      method: "POST",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ code: generateTotpCode(secret!) }),
    });
    expect(confirmRes.status).toBe(200);
  });

  it("returns 401 on MFA reset with wrong password", async () => {
    await prisma.userMfaMethod.create({
      data: { user_id: userId, type: "totp", secret_enc: encryptTotpSecret(generateTotpSecret()), confirmed_at: new Date() },
    });
    const res = await app.request("/api/account/mfa/reset", {
      method: "POST",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ password: "wrong-password" }),
    });
    expect(res.status).toBe(401);
  });

  it("resets MFA and revokes sessions on valid password", async () => {
    await prisma.userMfaMethod.create({
      data: { user_id: userId, type: "totp", secret_enc: encryptTotpSecret(generateTotpSecret()), confirmed_at: new Date() },
    });
    const extra = await createSession(prisma, { userId, stage: SESSION_STAGE.FULL });
    const res = await app.request("/api/account/mfa/reset", {
      method: "POST",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ password: NEW_PASSWORD }),
    });
    expect(res.status).toBe(200);
    expect(await prisma.userMfaMethod.count({ where: { user_id: userId } })).toBe(0);
    expect((await prisma.session.findUnique({ where: { id: userSessionId } }))?.revoked_at).not.toBeNull();
    expect((await prisma.session.findUnique({ where: { id: extra.session.id } }))?.revoked_at).not.toBeNull();
  });
});

describe("CSRF", () => {
  it("rejects PATCH without Origin", async () => {
    const res = await app.request("/api/account/profile", {
      method: "PATCH",
      headers: { Cookie: userCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ display_name: "Test" }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
