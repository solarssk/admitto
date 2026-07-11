import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  bootstrapSuperadmin,
  confirmTotpEnrollment,
  createSession,
  hashPassword,
  markBackupCodesAcknowledged,
  parseTotpSecretFromOtpauthUri,
  SESSION_STAGE,
  startTotpEnrollment,
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
const EMAIL_ADMIN = "account-admin@example.com";
const PASSWORD = "account-pass-123";
const NEW_PASSWORD = "account-new-pass-456";
const ADMIN_PASSWORD = "account-admin-pass-123";

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let rateLimitStore: InMemoryRateLimitStore;
let userId = "";
let oidcUserId = "";
let otherUserId = "";
let adminUserId = "";
let userCookie = "";
let userSessionId = "";
let adminCookie = "";
let prevInstanceOrgId: string | undefined;

async function seed(client: PrismaClient) {
  await client.session.deleteMany({ where: { user: { email: { in: [EMAIL_USER, EMAIL_OIDC, EMAIL_OTHER, EMAIL_ADMIN] } } } });
  await client.userMfaMethod.deleteMany({ where: { user: { email: { in: [EMAIL_USER, EMAIL_OIDC, EMAIL_OTHER, EMAIL_ADMIN] } } } });
  await client.roleAssignment.deleteMany({ where: { OR: [{ scope_id: ORG_ACCOUNT }, { user: { email: EMAIL_ADMIN } }] } });
  await client.adminAuditLog.deleteMany({ where: { organization_id: ORG_ACCOUNT } });
  await client.user.deleteMany({ where: { email: { in: [EMAIL_USER, EMAIL_OIDC, EMAIL_OTHER, EMAIL_ADMIN] } } });
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
      { user_id: userId, role: "operator", scope_type: "event", scope_id: "evt-account" },
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

  // Superadmin role → in the default mfa_required_roles set, so this fixture exercises the
  // TOTP/recovery-code step-up gate on MFA reset (the `userId`/operator fixture above is not
  // MFA-required and continues to reset with just a password).
  const admin = await bootstrapSuperadmin(prisma, EMAIL_ADMIN, ADMIN_PASSWORD);
  adminUserId = admin.userId;
  const adminSession = await createSession(prisma, { userId: adminUserId, stage: SESSION_STAGE.FULL, ip: "127.0.0.1" });
  adminCookie = `admitto_session=${adminSession.rawToken}`;
});

afterEach(async () => {
  await prisma.userMfaMethod.deleteMany({ where: { user_id: userId } });
  await prisma.session.deleteMany({ where: { user_id: userId, id: { not: userSessionId } } });
  await prisma.user.update({ where: { id: userId }, data: { password_hash: await hashPassword(PASSWORD), must_change_password: false } });
  await prisma.userMfaMethod.deleteMany({ where: { user_id: adminUserId } });
});

afterAll(async () => {
  if (prevInstanceOrgId !== undefined) process.env.INSTANCE_ORG_ID = prevInstanceOrgId;
  else delete process.env.INSTANCE_ORG_ID;
  await prisma?.$disconnect();
});

describe("GET /api/account", () => {
  it("returns profile without password_hash", async () => {
    await prisma.user.update({ where: { id: userId }, data: { must_change_password: true } });
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

    const audit = await prisma.adminAuditLog.findFirst({
      where: { organization_id: ORG_ACCOUNT, action_type: "account_password_changed" },
      orderBy: { created_at: "desc" },
    });
    expect(audit?.actor_user_id).toBe(userId);
    expect(audit?.metadata).toMatchObject({ sessionsRevoked: 1 });
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

  it("revokes own non-current session and writes an audit row", async () => {
    const other = await createSession(prisma, { userId, stage: SESSION_STAGE.FULL });
    const res = await app.request(`/api/account/sessions/${other.session.id}`, {
      method: "DELETE",
      headers: { Cookie: userCookie, ...sameOrigin },
    });
    expect(res.status).toBe(200);
    expect((await prisma.session.findUnique({ where: { id: other.session.id } }))?.revoked_at).not.toBeNull();

    const audit = await prisma.adminAuditLog.findFirst({
      where: { organization_id: ORG_ACCOUNT, action_type: "account_session_revoked" },
      orderBy: { created_at: "desc" },
    });
    expect(audit?.actor_user_id).toBe(userId);
    expect(audit?.metadata).toMatchObject({ sessionId: other.session.id });
  });

  it("retrying a revoke on an already-revoked session is a no-op and writes no extra audit row", async () => {
    const other = await createSession(prisma, { userId, stage: SESSION_STAGE.FULL });
    await app.request(`/api/account/sessions/${other.session.id}`, {
      method: "DELETE",
      headers: { Cookie: userCookie, ...sameOrigin },
    });
    const auditCountBefore = await prisma.adminAuditLog.count({
      where: { organization_id: ORG_ACCOUNT, action_type: "account_session_revoked" },
    });

    const res = await app.request(`/api/account/sessions/${other.session.id}`, {
      method: "DELETE",
      headers: { Cookie: userCookie, ...sameOrigin },
    });
    expect(res.status).toBe(200);

    const auditCountAfter = await prisma.adminAuditLog.count({
      where: { organization_id: ORG_ACCOUNT, action_type: "account_session_revoked" },
    });
    expect(auditCountAfter).toBe(auditCountBefore);
  });

  it("two concurrent revokes of the same session write exactly one audit row", async () => {
    const other = await createSession(prisma, { userId, stage: SESSION_STAGE.FULL });
    const auditCountBefore = await prisma.adminAuditLog.count({
      where: { organization_id: ORG_ACCOUNT, action_type: "account_session_revoked" },
    });

    const request = () =>
      app.request(`/api/account/sessions/${other.session.id}`, {
        method: "DELETE",
        headers: { Cookie: userCookie, ...sameOrigin },
      });
    const [resA, resB] = await Promise.all([request(), request()]);
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const auditCountAfter = await prisma.adminAuditLog.count({
      where: { organization_id: ORG_ACCOUNT, action_type: "account_session_revoked" },
    });
    expect(auditCountAfter - auditCountBefore).toBe(1);
  });

  it("revoking a session that already expired (stale sessions-list page) writes no audit row", async () => {
    const other = await createSession(prisma, { userId, stage: SESSION_STAGE.FULL });
    await prisma.session.update({
      where: { id: other.session.id },
      data: { expires_at: new Date(Date.now() - 1000) },
    });
    const auditCountBefore = await prisma.adminAuditLog.count({
      where: { organization_id: ORG_ACCOUNT, action_type: "account_session_revoked" },
    });

    const res = await app.request(`/api/account/sessions/${other.session.id}`, {
      method: "DELETE",
      headers: { Cookie: userCookie, ...sameOrigin },
    });
    expect(res.status).toBe(200);

    const auditCountAfter = await prisma.adminAuditLog.count({
      where: { organization_id: ORG_ACCOUNT, action_type: "account_session_revoked" },
    });
    expect(auditCountAfter).toBe(auditCountBefore);
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

    const audit = await prisma.adminAuditLog.findFirst({
      where: { organization_id: ORG_ACCOUNT, action_type: "account_mfa_enrolled" },
      orderBy: { created_at: "desc" },
    });
    expect(audit?.actor_user_id).toBe(userId);

    // The already-`full` session used to confirm must stay usable for the very next
    // request — self-service enroll already showed backup codes at the /enroll step,
    // so this session must not be rejected by the backup-codes-acknowledgment gate.
    const meRes = await app.request("/api/account", { headers: { Cookie: userCookie } });
    expect(meRes.status).toBe(200);
  });

  it("two concurrent confirms of the same pending enrollment write exactly one audit row", async () => {
    // account/password, mfa/totp/confirm, and mfa/reset all share one per-IP rate-limit
    // bucket (loginRateLimitJson); reset it so this test's own requests don't trip a limit
    // exhausted by everything else that already ran in this file.
    rateLimitStore.reset();
    const enrollRes = await app.request("/api/account/mfa/totp/enroll", {
      method: "POST",
      headers: { Cookie: userCookie, ...sameOrigin },
    });
    const enroll = (await enrollRes.json()) as { otpauthUri: string };
    const secret = parseTotpSecretFromOtpauthUri(enroll.otpauthUri);
    const code = generateTotpCode(secret!);
    const auditCountBefore = await prisma.adminAuditLog.count({
      where: { organization_id: ORG_ACCOUNT, action_type: "account_mfa_enrolled" },
    });

    const confirm = () =>
      app.request("/api/account/mfa/totp/confirm", {
        method: "POST",
        headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
    const [resA, resB] = await Promise.all([confirm(), confirm()]);
    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([200, 400]);

    const auditCountAfter = await prisma.adminAuditLog.count({
      where: { organization_id: ORG_ACCOUNT, action_type: "account_mfa_enrolled" },
    });
    expect(auditCountAfter - auditCountBefore).toBe(1);
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

  it("resets MFA and revokes other sessions on valid password", async () => {
    await prisma.userMfaMethod.create({
      data: { user_id: userId, type: "totp", secret_enc: encryptTotpSecret(generateTotpSecret()), confirmed_at: new Date() },
    });
    const extra = await createSession(prisma, { userId, stage: SESSION_STAGE.FULL });
    const res = await app.request("/api/account/mfa/reset", {
      method: "POST",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ password: PASSWORD }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; sessions_revoked: number };
    expect(body.ok).toBe(true);
    expect(body.sessions_revoked).toBe(1);
    expect(await prisma.userMfaMethod.count({ where: { user_id: userId } })).toBe(0);
    expect((await prisma.session.findUnique({ where: { id: userSessionId } }))?.revoked_at).toBeNull();
    expect((await prisma.session.findUnique({ where: { id: extra.session.id } }))?.revoked_at).not.toBeNull();

    const audit = await prisma.adminAuditLog.findFirst({
      where: { organization_id: ORG_ACCOUNT, action_type: "account_mfa_reset" },
      orderBy: { created_at: "desc" },
    });
    expect(audit?.actor_user_id).toBe(userId);
    expect(audit?.metadata).toMatchObject({ sessionsRevoked: 1 });
  });

  it("two concurrent MFA resets write exactly one audit row", async () => {
    rateLimitStore.reset();
    await prisma.userMfaMethod.create({
      data: { user_id: userId, type: "totp", secret_enc: encryptTotpSecret(generateTotpSecret()), confirmed_at: new Date() },
    });
    const auditCountBefore = await prisma.adminAuditLog.count({
      where: { organization_id: ORG_ACCOUNT, action_type: "account_mfa_reset" },
    });

    const reset = () =>
      app.request("/api/account/mfa/reset", {
        method: "POST",
        headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ password: PASSWORD }),
      });
    const [resA, resB] = await Promise.all([reset(), reset()]);
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    expect(await prisma.userMfaMethod.count({ where: { user_id: userId } })).toBe(0);

    const auditCountAfter = await prisma.adminAuditLog.count({
      where: { organization_id: ORG_ACCOUNT, action_type: "account_mfa_reset" },
    });
    expect(auditCountAfter - auditCountBefore).toBe(1);
  });

  it("audits a reset that revokes other sessions even with no MFA enrolled", async () => {
    rateLimitStore.reset();
    // No userMfaMethod row at all — only a second session to be revoked.
    const extra = await createSession(prisma, { userId, stage: SESSION_STAGE.FULL });
    const auditCountBefore = await prisma.adminAuditLog.count({
      where: { organization_id: ORG_ACCOUNT, action_type: "account_mfa_reset" },
    });

    const res = await app.request("/api/account/mfa/reset", {
      method: "POST",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ password: PASSWORD }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessions_revoked: number };
    expect(body.sessions_revoked).toBe(1);
    expect((await prisma.session.findUnique({ where: { id: extra.session.id } }))?.revoked_at).not.toBeNull();

    const auditCountAfter = await prisma.adminAuditLog.count({
      where: { organization_id: ORG_ACCOUNT, action_type: "account_mfa_reset" },
    });
    expect(auditCountAfter - auditCountBefore).toBe(1);
  });

  it("does not audit a reset that changes nothing (no MFA, no other sessions, no trusted devices)", async () => {
    rateLimitStore.reset();
    const auditCountBefore = await prisma.adminAuditLog.count({
      where: { organization_id: ORG_ACCOUNT, action_type: "account_mfa_reset" },
    });

    const res = await app.request("/api/account/mfa/reset", {
      method: "POST",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ password: PASSWORD }),
    });
    expect(res.status).toBe(200);

    const auditCountAfter = await prisma.adminAuditLog.count({
      where: { organization_id: ORG_ACCOUNT, action_type: "account_mfa_reset" },
    });
    expect(auditCountAfter).toBe(auditCountBefore);
  });

  it("returns 400 no_local_password for OIDC-only TOTP enroll", async () => {
    const oidcSession = await createSession(prisma, { userId: oidcUserId, stage: SESSION_STAGE.FULL });
    const res = await app.request("/api/account/mfa/totp/enroll", {
      method: "POST",
      headers: { Cookie: `admitto_session=${oidcSession.rawToken}`, ...sameOrigin },
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("no_local_password");
    await prisma.session.delete({ where: { id: oidcSession.session.id } });
  });
});

describe("POST /api/account/mfa/reset — step-up for MFA-required roles", () => {
  // Enroll+confirm via direct function calls (not the HTTP endpoints) so these setup steps
  // don't consume the shared per-IP login rate-limit bucket that `/api/account/mfa/reset`
  // itself is gated by.
  beforeEach(() => rateLimitStore.reset());

  async function enrollConfirmedTotp(): Promise<string> {
    const enrollment = await startTotpEnrollment(prisma, adminUserId);
    const secret = parseTotpSecretFromOtpauthUri(enrollment!.otpauthUri);
    await confirmTotpEnrollment(prisma, adminUserId, generateTotpCode(secret!));
    // confirmTotpEnrollment always marks backup codes unacknowledged (IAM-002) — acknowledge
    // them here so this fixture's session stays usable, mirroring what the self-service HTTP
    // confirm handler does for a real logged-in user.
    await markBackupCodesAcknowledged(prisma, adminUserId);
    return enrollment!.backupCodes[0]!;
  }

  it("returns 400 totp_required when no code is given for an MFA-required role", async () => {
    await enrollConfirmedTotp();
    const res = await app.request("/api/account/mfa/reset", {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ password: ADMIN_PASSWORD }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("totp_required");
    expect(await prisma.userMfaMethod.count({ where: { user_id: adminUserId } })).toBeGreaterThan(0);
  });

  it("returns 401 invalid_totp for a wrong code", async () => {
    await enrollConfirmedTotp();
    const res = await app.request("/api/account/mfa/reset", {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ password: ADMIN_PASSWORD, code: "000000" }),
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe("invalid_totp");
    expect(await prisma.userMfaMethod.count({ where: { user_id: adminUserId } })).toBeGreaterThan(0);
  });

  it("returns 429 after exceeding the step-up code rate limit", async () => {
    await enrollConfirmedTotp();
    for (let i = 0; i < 10; i++) {
      const res = await app.request("/api/account/mfa/reset", {
        method: "POST",
        headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ password: ADMIN_PASSWORD, code: "000000" }),
      });
      expect(res.status).toBe(401);
    }

    const limited = await app.request("/api/account/mfa/reset", {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ password: ADMIN_PASSWORD, code: "000000" }),
    });
    expect(limited.status).toBe(429);
    const body = (await limited.json()) as { error?: string };
    expect(body.error).toBe("too many requests");
    expect(await prisma.userMfaMethod.count({ where: { user_id: adminUserId } })).toBeGreaterThan(0);
  });

  it("resets MFA with a correct TOTP code", async () => {
    // Seeded directly (not via enroll+confirm) so this is the only code ever verified against
    // this secret — verifyUserTotpCode rejects replaying the same time-step twice, which
    // confirming via HTTP first and then reset-with-a-freshly-generated-code could hit if both
    // land in the same 30s window.
    const secret = generateTotpSecret();
    await prisma.userMfaMethod.create({
      data: { user_id: adminUserId, type: "totp", secret_enc: encryptTotpSecret(secret), confirmed_at: new Date() },
    });

    const res = await app.request("/api/account/mfa/reset", {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ password: ADMIN_PASSWORD, code: generateTotpCode(secret) }),
    });
    expect(res.status).toBe(200);
    expect(await prisma.userMfaMethod.count({ where: { user_id: adminUserId } })).toBe(0);
  });

  it("resets MFA with a valid backup recovery code, and consumes it", async () => {
    const backupCode = await enrollConfirmedTotp();

    const res = await app.request("/api/account/mfa/reset", {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ password: ADMIN_PASSWORD, code: backupCode }),
    });
    expect(res.status).toBe(200);
    expect(await prisma.userMfaMethod.count({ where: { user_id: adminUserId } })).toBe(0);
  });

  it("does not require a code for the non-MFA-required operator fixture", async () => {
    await prisma.userMfaMethod.create({
      data: { user_id: userId, type: "totp", secret_enc: encryptTotpSecret(generateTotpSecret()), confirmed_at: new Date() },
    });
    const res = await app.request("/api/account/mfa/reset", {
      method: "POST",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ password: PASSWORD }),
    });
    expect(res.status).toBe(200);
  });
});

describe("DELETE /api/account/mfa/totp/enroll", () => {
  it("cancels pending enrollment and backup codes", async () => {
    const enrollRes = await app.request("/api/account/mfa/totp/enroll", {
      method: "POST",
      headers: { Cookie: userCookie, ...sameOrigin },
    });
    expect(enrollRes.status).toBe(200);

    const deleteRes = await app.request("/api/account/mfa/totp/enroll", {
      method: "DELETE",
      headers: { Cookie: userCookie, ...sameOrigin },
    });
    expect(deleteRes.status).toBe(200);
    expect(((await deleteRes.json()) as { ok: boolean }).ok).toBe(true);
    expect(await prisma.userMfaMethod.count({ where: { user_id: userId, type: "totp" } })).toBe(0);
    expect(await prisma.userMfaMethod.count({ where: { user_id: userId, type: "recovery" } })).toBe(0);
  });

  it("does not remove confirmed TOTP or saved recovery codes when nothing is pending", async () => {
    await prisma.userMfaMethod.create({
      data: {
        user_id: userId,
        type: "totp",
        secret_enc: encryptTotpSecret(generateTotpSecret()),
        confirmed_at: new Date(),
      },
    });
    await prisma.userMfaMethod.createMany({
      data: [
        { user_id: userId, type: "recovery", secret_enc: "hash-1", confirmed_at: new Date() },
        { user_id: userId, type: "recovery", secret_enc: "hash-2", confirmed_at: new Date() },
      ],
    });

    const deleteRes = await app.request("/api/account/mfa/totp/enroll", {
      method: "DELETE",
      headers: { Cookie: userCookie, ...sameOrigin },
    });
    expect(deleteRes.status).toBe(200);

    expect(await prisma.userMfaMethod.count({ where: { user_id: userId, type: "totp", confirmed_at: { not: null } } })).toBe(1);
    expect(await prisma.userMfaMethod.count({ where: { user_id: userId, type: "recovery" } })).toBe(2);
  });
});

describe("PATCH /api/account/profile — preferred_locale", () => {
  it("GET /api/account returns null preferred_locale before user sets one", async () => {
    await prisma.user.update({ where: { id: userId }, data: { preferred_locale: null } });
    const res = await app.request("/api/account", {
      headers: { Cookie: userCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { preferred_locale: string | null };
    expect(body.preferred_locale).toBeNull();
  });

  it("sets preferred_locale to a supported locale", async () => {
    const res = await app.request("/api/account/profile", {
      method: "PATCH",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ preferred_locale: "pl-PL" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { preferred_locale: string | null };
    expect(body.preferred_locale).toBe("pl-PL");

    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row.preferred_locale).toBe("pl-PL");
  });

  it("PATCH profile response sanitizes legacy invalid preferred_locale", async () => {
    await prisma.user.update({
      where: { id: userId },
      data: { preferred_locale: " xx-ZZ " },
    });
    const res = await app.request("/api/account/profile", {
      method: "PATCH",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ display_name: "Sanitize Test" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { preferred_locale: string | null };
    expect(body.preferred_locale).toBeNull();
  });

  it("clears preferred_locale with null", async () => {
    await app.request("/api/account/profile", {
      method: "PATCH",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ preferred_locale: "de-DE" }),
    });
    const res = await app.request("/api/account/profile", {
      method: "PATCH",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ preferred_locale: null }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { preferred_locale: string | null };
    expect(body.preferred_locale).toBeNull();
  });

  it("returns 400 for unsupported locale string", async () => {
    const res = await app.request("/api/account/profile", {
      method: "PATCH",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ preferred_locale: "xx-ZZ" }),
    });
    expect(res.status).toBe(400);
  });

  it("GET /api/account returns preferred_locale", async () => {
    await app.request("/api/account/profile", {
      method: "PATCH",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ preferred_locale: "ja-JP" }),
    });
    const res = await app.request("/api/account", { headers: { Cookie: userCookie } });
    const body = (await res.json()) as { preferred_locale: string | null };
    expect(body.preferred_locale).toBe("ja-JP");
  });

  it("returns 400 when body is empty object (nothing to update)", async () => {
    const res = await app.request("/api/account/profile", {
      method: "PATCH",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
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
