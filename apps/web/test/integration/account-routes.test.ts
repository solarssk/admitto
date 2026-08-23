import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import {
  BACKUP_RECOVERY_CODE_COUNT,
  beginWebauthnRegistration,
  bootstrapSuperadmin,
  confirmTotpEnrollment,
  createSession,
  finishWebauthnRegistration,
  hashPassword,
  markBackupCodesAcknowledged,
  parseTotpSecretFromOtpauthUri,
  regenerateBackupRecoveryCodes,
  SESSION_STAGE,
  startTotpEnrollment,
  verifyPassword,
} from "@admitto/auth";
import { encryptTotpSecret, generateTotpCode, generateTotpSecret } from "@admitto/auth/testing";
import { createVirtualAuthenticator } from "@admitto/auth/webauthn-testing";
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
const WEBAUTHN_RP = { rpName: "Admitto", rpID: "admitto.example.com", origin: "https://admitto.example.com" };

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
let adminSessionId = "";
let prevInstanceOrgId: string | undefined;

const PROVIDER_ID = "idp-account-test";

async function seed(client: PrismaClient) {
  await client.session.deleteMany({ where: { user: { email: { in: [EMAIL_USER, EMAIL_OIDC, EMAIL_OTHER, EMAIL_ADMIN] } } } });
  await client.userMfaMethod.deleteMany({ where: { user: { email: { in: [EMAIL_USER, EMAIL_OIDC, EMAIL_OTHER, EMAIL_ADMIN] } } } });
  await client.roleAssignment.deleteMany({ where: { OR: [{ scope_id: ORG_ACCOUNT }, { user: { email: EMAIL_ADMIN } }] } });
  await client.adminAuditLog.deleteMany({ where: { organization_id: ORG_ACCOUNT } });
  await client.user.deleteMany({ where: { email: { in: [EMAIL_USER, EMAIL_OIDC, EMAIL_OTHER, EMAIL_ADMIN] } } });
  await client.event.deleteMany({ where: { id: "evt-account" } });
  await client.organization.deleteMany({ where: { id: ORG_ACCOUNT } });
  await client.identityProvider.deleteMany({ where: { id: PROVIDER_ID } });

  const password_hash = await hashPassword(PASSWORD);
  await client.organization.create({ data: { id: ORG_ACCOUNT, name: "Account Test Org", slug: "account-test" } });
  await client.event.create({
    data: { id: "evt-account", title: "Account Test Event", slug: "account-test-event", organization_id: ORG_ACCOUNT, date: new Date("2026-01-01") },
  });
  await client.identityProvider.create({
    data: {
      id: PROVIDER_ID,
      provider_type: "oidc",
      issuer: "https://iam-account.example.com/",
      client_id: "test-client",
      authorization_endpoint: "https://iam-account.example.com/a",
      token_endpoint: "https://iam-account.example.com/t",
      jwks_uri: "https://iam-account.example.com/j",
      display_name: "Account Test IdP",
      enabled: true,
    },
  });

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
  prisma = createTestPrismaClient();
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
  adminSessionId = adminSession.session.id;
});

// The whole /api/account/* route group now shares one auth:account-ip per-IP bucket (see
// policies.ts); every request in this file resolves to the same effective test-harness IP, so
// without a reset here the group bucket would accumulate across unrelated `it()`s and start
// rejecting otherwise-valid requests partway through the file. Tests that specifically exercise
// rate-limit-exceeded behavior pre-fill their own target bucket after this reset runs.
beforeEach(() => rateLimitStore.reset());

afterEach(async () => {
  await prisma.userMfaMethod.deleteMany({ where: { user_id: userId } });
  await prisma.externalIdentity.deleteMany({ where: { user_id: userId } });
  await prisma.oidcRoleGrant.deleteMany({ where: { user_id: userId } });
  await prisma.roleAssignment.deleteMany({ where: { user_id: userId, NOT: { scope_id: "evt-account" } } });
  await prisma.session.deleteMany({ where: { user_id: userId, id: { not: userSessionId } } });
  await prisma.user.update({ where: { id: userId }, data: { password_hash: await hashPassword(PASSWORD), must_change_password: false } });
  await prisma.userMfaMethod.deleteMany({ where: { user_id: adminUserId } });
  await prisma.externalIdentity.deleteMany({ where: { user_id: adminUserId } });
  await prisma.oidcRoleGrant.deleteMany({ where: { user_id: adminUserId } });
  await prisma.session.deleteMany({ where: { user_id: adminUserId, id: { not: adminSessionId } } });
  await prisma.user.update({ where: { id: adminUserId }, data: { password_hash: await hashPassword(ADMIN_PASSWORD) } });
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

  it("returns has_local_password: false for an SSO-linked account with no local password", async () => {
    await prisma.externalIdentity.create({
      data: { provider_id: PROVIDER_ID, subject: "account-get-no-password-subject", user_id: oidcUserId },
    });
    const oidcSession = await createSession(prisma, { userId: oidcUserId, stage: SESSION_STAGE.FULL });

    const res = await app.request("/api/account", {
      headers: { Cookie: `admitto_session=${oidcSession.rawToken}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.has_local_password).toBe(false);

    await prisma.session.delete({ where: { id: oidcSession.session.id } });
    await prisma.externalIdentity.deleteMany({ where: { user_id: oidcUserId } });
  });

  it("resolves an event-scoped role's scope_id to the event's title", async () => {
    const res = await app.request("/api/account", { headers: { Cookie: userCookie } });
    const body = (await res.json()) as { roles: Array<{ scope_type: string; scope_id: string | null; scope_label: string | null }> };
    const eventRole = body.roles.find((r) => r.scope_type === "event");
    expect(eventRole?.scope_id).toBe("evt-account");
    expect(eventRole?.scope_label).toBe("Account Test Event");
  });

  it("returns a null scope_label for a role pointing at a since-deleted scope", async () => {
    // operator/event, not admin/organization: this fixture's session isn't MFA-completed, and
    // admin is in the default mfa_required_roles set - granting it here would make requireSession
    // reject the existing session instead of exercising the scope_label resolution this test is
    // actually about.
    const created = await prisma.roleAssignment.create({
      data: { user_id: userId, role: "operator", scope_type: "event", scope_id: "evt-does-not-exist" },
    });
    try {
      const res = await app.request("/api/account", { headers: { Cookie: userCookie } });
      const body = (await res.json()) as { roles: Array<{ id: string; scope_label: string | null }> };
      expect(body.roles.find((r) => r.id === created.id)?.scope_label).toBeNull();
    } finally {
      await prisma.roleAssignment.delete({ where: { id: created.id } });
    }
  });

  it("resolves an organization-scoped role's scope_id to the organization's name", async () => {
    // "operator", not "admin": same MFA reasoning as the deleted-scope test above.
    const created = await prisma.roleAssignment.create({
      data: { user_id: userId, role: "operator", scope_type: "organization", scope_id: ORG_ACCOUNT },
    });
    try {
      const res = await app.request("/api/account", { headers: { Cookie: userCookie } });
      const body = (await res.json()) as { roles: Array<{ id: string; scope_label: string | null }> };
      expect(body.roles.find((r) => r.id === created.id)?.scope_label).toBe("Account Test Org");
    } finally {
      await prisma.roleAssignment.delete({ where: { id: created.id } });
    }
  });

  it("returns a null scope_label for an organization-scoped role pointing at a since-deleted org", async () => {
    const created = await prisma.roleAssignment.create({
      data: { user_id: userId, role: "operator", scope_type: "organization", scope_id: "org-does-not-exist" },
    });
    try {
      const res = await app.request("/api/account", { headers: { Cookie: userCookie } });
      const body = (await res.json()) as { roles: Array<{ id: string; scope_label: string | null }> };
      expect(body.roles.find((r) => r.id === created.id)?.scope_label).toBeNull();
    } finally {
      await prisma.roleAssignment.delete({ where: { id: created.id } });
    }
  });

  it("returns a null scope_label for an instance-scoped role (neither event nor organization)", async () => {
    // adminUserId is bootstrapped as instance-scoped superadmin (see beforeAll) - the one seeded
    // fixture whose role assignment is neither "event" nor "organization" scoped. Superadmin is
    // in the default mfa_required_roles set, so the session's own full-session MFA policy check
    // (assertFullSessionMfaPolicy) rejects it as unauthorized until TOTP is confirmed.
    await enrollConfirmedTotp();
    const res = await app.request("/api/account", { headers: { Cookie: adminCookie } });
    const body = (await res.json()) as { roles: Array<{ scope_type: string; scope_label: string | null }> };
    const superadminRole = body.roles.find((r) => r.scope_type === "instance");
    expect(superadminRole).toBeDefined();
    expect(superadminRole?.scope_label).toBeNull();
  });

  it("returns an empty external_identities array when nothing is linked", async () => {
    const res = await app.request("/api/account", { headers: { Cookie: userCookie } });
    const body = (await res.json()) as { external_identities: unknown[] };
    expect(body.external_identities).toEqual([]);
  });

  it("returns the linked provider's display name, not its raw id", async () => {
    await prisma.externalIdentity.create({
      data: { provider_id: PROVIDER_ID, subject: "account-get-subject", user_id: userId },
    });
    const res = await app.request("/api/account", { headers: { Cookie: userCookie } });
    const body = (await res.json()) as { external_identities: Array<{ provider_id: string; provider_display_name: string }> };
    expect(body.external_identities).toHaveLength(1);
    expect(body.external_identities[0]?.provider_id).toBe(PROVIDER_ID);
    expect(body.external_identities[0]?.provider_display_name).toBe("Account Test IdP");
  });

  it("lists an enabled provider as available to connect when nothing is linked", async () => {
    const res = await app.request("/api/account", { headers: { Cookie: userCookie } });
    const body = (await res.json()) as { available_identity_providers: Array<{ id: string; display_name: string }> };
    expect(body.available_identity_providers).toEqual([{ id: PROVIDER_ID, display_name: "Account Test IdP" }]);
  });

  it("excludes an already-linked provider from available_identity_providers", async () => {
    await prisma.externalIdentity.create({
      data: { provider_id: PROVIDER_ID, subject: "account-get-available-subject", user_id: userId },
    });
    const res = await app.request("/api/account", { headers: { Cookie: userCookie } });
    const body = (await res.json()) as { available_identity_providers: unknown[] };
    expect(body.available_identity_providers).toEqual([]);
  });

  it("excludes a disabled provider from available_identity_providers", async () => {
    await prisma.identityProvider.update({ where: { id: PROVIDER_ID }, data: { enabled: false } });
    try {
      const res = await app.request("/api/account", { headers: { Cookie: userCookie } });
      const body = (await res.json()) as { available_identity_providers: unknown[] };
      expect(body.available_identity_providers).toEqual([]);
    } finally {
      await prisma.identityProvider.update({ where: { id: PROVIDER_ID }, data: { enabled: true } });
    }
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

  it("returns 401 wrong_password for bad current password even when new password is blocklisted", async () => {
    const res = await app.request("/api/account/password", {
      method: "PATCH",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        current_password: "wrong",
        new_password: "aaaaaaaaaaaa",
        new_password_confirm: "aaaaaaaaaaaa",
      }),
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe("wrong_password");
  });

  it("returns 429 after exceeding the password-check rate limit, independent of the per-IP bucket", async () => {
    rateLimitStore.reset();
    // Pre-fill only this endpoint's own user-scoped password-check bucket directly, instead of
    // looping HTTP requests: /api/account/password also sits behind the auth:account-ip per-IP
    // bucket (applied group-wide in app.ts to the whole /api/account/* route group, max 10/min),
    // which would trip at the same threshold on repeated real requests and mask whether this
    // handler's own password-check rate limit is actually the thing returning 429.
    const bucketKey = `account:password-check:user:${userId}`;
    for (let i = 0; i < 10; i++) {
      await rateLimitStore.hit(bucketKey, 60_000, 10);
    }

    const res = await app.request("/api/account/password", {
      method: "PATCH",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ current_password: PASSWORD, new_password: NEW_PASSWORD, new_password_confirm: NEW_PASSWORD }),
    });
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("too many requests");
    rateLimitStore.reset();
  });

  it("returns 400 password_too_common for a blocklisted new password", async () => {
    const res = await app.request("/api/account/password", {
      method: "PATCH",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        current_password: PASSWORD,
        new_password: "aaaaaaaaaaaa",
        new_password_confirm: "aaaaaaaaaaaa",
      }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("password_too_common");
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

describe("GET /api/account/sessions", () => {
  it("includes the resolved country for each session", async () => {
    const res = await app.request("/api/account/sessions", {
      headers: { Cookie: userCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      sessions: { id: string; ip: string | null; country: { kind: string; countryCode?: string } }[];
    };
    const current = body.sessions.find((s) => s.id === userSessionId);
    // Seeded with ip: "127.0.0.1" (loopback) in beforeAll.
    expect(current?.country).toEqual({ kind: "internal" });
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
    // The whole /api/account/* route group shares one per-IP rate-limit bucket
    // (auth:account-ip); reset it so this test's own requests don't trip a limit exhausted
    // by everything else that already ran in this file.
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

  it("returns 429 on MFA reset after exceeding the password-check rate limit, independent of the per-IP bucket", async () => {
    rateLimitStore.reset();
    await prisma.userMfaMethod.create({
      data: { user_id: userId, type: "totp", secret_enc: encryptTotpSecret(generateTotpSecret()), confirmed_at: new Date() },
    });
    // Pre-fill only this endpoint's own user-scoped password-check bucket directly, instead of
    // looping HTTP requests: /api/account/mfa/reset also sits behind the group-wide
    // auth:account-ip per-IP bucket (applied to all of /api/account/* in app.ts, max 10/min),
    // which would trip at the same threshold on repeated real requests and mask whether this
    // handler's own password-check rate limit is actually the thing returning 429.
    const bucketKey = `account:password-check:user:${userId}`;
    for (let i = 0; i < 10; i++) {
      await rateLimitStore.hit(bucketKey, 60_000, 10);
    }

    const res = await app.request("/api/account/mfa/reset", {
      method: "POST",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ password: PASSWORD }),
    });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error?: string }).error).toBe("too many requests");
    expect(await prisma.userMfaMethod.count({ where: { user_id: userId } })).toBeGreaterThan(0);
    rateLimitStore.reset();
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

/** Register + acknowledge a confirmed WebAuthn credential directly against `prisma` (bypassing
 * the HTTP ceremony), so a test can prove a TOTP-only action leaves it untouched. Also returns the
 * virtual authenticator itself so a step-up test can later produce a valid assertion against this
 * same credential (see `webauthnStepUpProof`). */
async function registerConfirmedWebauthnCredential(uid: string, label = "Seeded key") {
  const authenticator = createVirtualAuthenticator();
  const begin = await beginWebauthnRegistration(prisma, uid, "platform", WEBAUTHN_RP);
  if (!begin) throw new Error("beginWebauthnRegistration failed");
  const response = authenticator.register({ challenge: begin.challenge, rpID: WEBAUTHN_RP.rpID, origin: WEBAUTHN_RP.origin });
  const result = await finishWebauthnRegistration(prisma, uid, response, begin.challenge, "platform", label, WEBAUTHN_RP);
  if (!result) throw new Error("finishWebauthnRegistration failed");
  await markBackupCodesAcknowledged(prisma, uid);
  return { ...result, authenticator };
}

/** Drive `POST /api/account/mfa/webauthn/assert/begin` over the given session, then sign the
 * returned challenge with `authenticator`: the `{ webauthn }` fragment a step-up-gated action
 * accepts alongside (or instead of) a `code`. */
async function webauthnStepUpProof(
  cookie: string,
  authenticator: ReturnType<typeof createVirtualAuthenticator>,
) {
  const beginRes = await app.request("/api/account/mfa/webauthn/assert/begin", {
    method: "POST",
    headers: { Cookie: cookie, ...sameOrigin, "Content-Type": "application/json" },
    body: "{}",
  });
  const { options } = (await beginRes.json()) as { options: { challenge: string } };
  const response = authenticator.authenticate({
    challenge: options.challenge,
    rpID: WEBAUTHN_RP.rpID,
    origin: WEBAUTHN_RP.origin,
  });
  return { webauthn: { response } };
}

// Enroll+confirm via direct function calls (not the HTTP endpoints) so these setup steps
// don't consume the shared per-IP auth:account-ip bucket that both `/api/account/mfa/reset`
// and `/api/account/password` (and the rest of /api/account/*) are gated by. Shared by both
// step-up describe blocks below.
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

describe("POST /api/account/mfa/reset — step-up for MFA-required roles", () => {
  beforeEach(() => rateLimitStore.reset());

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
    // Pre-fill only this endpoint's own session bucket directly, instead of looping HTTP
    // requests: /api/account/mfa/reset also sits behind the group-wide auth:account-ip per-IP
    // bucket (applied to all of /api/account/* in app.ts, max 10/min), which would trip first
    // on repeated real requests and mask whether this handler's own step-up rate limit is
    // actually the thing returning 429.
    const bucketKey = `mfa:totp:session:mfa-reset:${adminSessionId}`;
    for (let i = 0; i < 10; i++) {
      await rateLimitStore.hit(bucketKey, 15 * 60_000, 10);
    }

    const res = await app.request("/api/account/mfa/reset", {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ password: ADMIN_PASSWORD, code: "000000" }),
    });
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error?: string };
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

  it("resets MFA with a valid WebAuthn assertion, including the credential it was proven with", async () => {
    const credential = await registerConfirmedWebauthnCredential(adminUserId);
    const proof = await webauthnStepUpProof(adminCookie, credential.authenticator);

    const res = await app.request("/api/account/mfa/reset", {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ password: ADMIN_PASSWORD, ...proof }),
    });
    expect(res.status).toBe(200);
    expect(await prisma.userMfaMethod.count({ where: { user_id: adminUserId } })).toBe(0);
  });

  it("returns 401 invalid_webauthn for an assertion signed by the wrong authenticator", async () => {
    await registerConfirmedWebauthnCredential(adminUserId);
    const wrongAuthenticator = createVirtualAuthenticator();
    const beginRes = await app.request("/api/account/mfa/webauthn/assert/begin", {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: "{}",
    });
    const { options } = (await beginRes.json()) as { options: { challenge: string } };
    const response = wrongAuthenticator.authenticate({
      challenge: options.challenge,
      rpID: WEBAUTHN_RP.rpID,
      origin: WEBAUTHN_RP.origin,
    });

    const res = await app.request("/api/account/mfa/reset", {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ password: ADMIN_PASSWORD, webauthn: { response } }),
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe("invalid_webauthn");
    expect(await prisma.userMfaMethod.count({ where: { user_id: adminUserId, type: "webauthn" } })).toBe(1);
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

describe("PATCH /api/account/password — step-up for MFA-required roles", () => {
  beforeEach(() => rateLimitStore.reset());

  it("returns 400 totp_required when no code is given for an MFA-required role", async () => {
    await enrollConfirmedTotp();
    const res = await app.request("/api/account/password", {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        current_password: ADMIN_PASSWORD,
        new_password: NEW_PASSWORD,
        new_password_confirm: NEW_PASSWORD,
      }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("totp_required");
    expect(await verifyPassword(ADMIN_PASSWORD, (await prisma.user.findUniqueOrThrow({ where: { id: adminUserId } })).password_hash!)).toBe(true);
  });

  it("returns 401 invalid_totp for a wrong code", async () => {
    await enrollConfirmedTotp();
    const res = await app.request("/api/account/password", {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        current_password: ADMIN_PASSWORD,
        new_password: NEW_PASSWORD,
        new_password_confirm: NEW_PASSWORD,
        code: "000000",
      }),
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe("invalid_totp");
    expect(await verifyPassword(ADMIN_PASSWORD, (await prisma.user.findUniqueOrThrow({ where: { id: adminUserId } })).password_hash!)).toBe(true);
  });

  it("returns 429 after exceeding the step-up code rate limit", async () => {
    await enrollConfirmedTotp();
    // Pre-fill only this endpoint's own session bucket directly, instead of looping HTTP
    // requests: /api/account/password also sits behind the group-wide auth:account-ip per-IP
    // bucket (applied to all of /api/account/* in app.ts, max 10/min), which would trip first
    // on repeated real requests and mask whether this handler's own step-up rate limit is
    // actually the thing returning 429.
    const bucketKey = `mfa:totp:session:account-password:${adminSessionId}`;
    for (let i = 0; i < 10; i++) {
      await rateLimitStore.hit(bucketKey, 15 * 60_000, 10);
    }

    const res = await app.request("/api/account/password", {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        current_password: ADMIN_PASSWORD,
        new_password: NEW_PASSWORD,
        new_password_confirm: NEW_PASSWORD,
        code: "000000",
      }),
    });
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("too many requests");
  });

  it("changes the password with a correct TOTP code, and writes an audit row", async () => {
    // Seeded directly (not via enroll+confirm) so this is the only code ever verified against
    // this secret — see the equivalent mfa/reset test above for why. `backup_codes_acknowledged_at`
    // is left unset deliberately: it defaults to row-creation time (schema.prisma), so this row
    // reads as already-acknowledged — the enroll+confirm flow is the one that explicitly nulls it
    // to force that step, which isn't what this test is exercising.
    const secret = generateTotpSecret();
    await prisma.userMfaMethod.create({
      data: { user_id: adminUserId, type: "totp", secret_enc: encryptTotpSecret(secret), confirmed_at: new Date() },
    });

    const res = await app.request("/api/account/password", {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        current_password: ADMIN_PASSWORD,
        new_password: NEW_PASSWORD,
        new_password_confirm: NEW_PASSWORD,
        code: generateTotpCode(secret),
      }),
    });
    expect(res.status).toBe(200);
    expect(await verifyPassword(NEW_PASSWORD, (await prisma.user.findUniqueOrThrow({ where: { id: adminUserId } })).password_hash!)).toBe(true);

    const audit = await prisma.adminAuditLog.findFirst({
      where: { organization_id: ORG_ACCOUNT, action_type: "account_password_changed", actor_user_id: adminUserId },
      orderBy: { created_at: "desc" },
    });
    expect(audit?.actor_user_id).toBe(adminUserId);
  });

  it("changes the password with a valid backup recovery code, and consumes it", async () => {
    const backupCode = await enrollConfirmedTotp();

    const res = await app.request("/api/account/password", {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        current_password: ADMIN_PASSWORD,
        new_password: NEW_PASSWORD,
        new_password_confirm: NEW_PASSWORD,
        code: backupCode,
      }),
    });
    expect(res.status).toBe(200);
    expect(await verifyPassword(NEW_PASSWORD, (await prisma.user.findUniqueOrThrow({ where: { id: adminUserId } })).password_hash!)).toBe(true);

    // The same backup code must not work again.
    const other = await createSession(prisma, { userId: adminUserId, stage: SESSION_STAGE.FULL });
    const replay = await app.request("/api/account/mfa/reset", {
      method: "POST",
      headers: { Cookie: `admitto_session=${other.rawToken}`, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ password: NEW_PASSWORD, code: backupCode }),
    });
    expect(replay.status).toBe(401);
  });

  it("changes the password with a valid WebAuthn assertion", async () => {
    const credential = await registerConfirmedWebauthnCredential(adminUserId);
    const proof = await webauthnStepUpProof(adminCookie, credential.authenticator);

    const res = await app.request("/api/account/password", {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        current_password: ADMIN_PASSWORD,
        new_password: NEW_PASSWORD,
        new_password_confirm: NEW_PASSWORD,
        ...proof,
      }),
    });
    expect(res.status).toBe(200);
    expect(await verifyPassword(NEW_PASSWORD, (await prisma.user.findUniqueOrThrow({ where: { id: adminUserId } })).password_hash!)).toBe(true);
  });

  it("does not require a code for the non-MFA-required operator fixture", async () => {
    await prisma.userMfaMethod.create({
      data: { user_id: userId, type: "totp", secret_enc: encryptTotpSecret(generateTotpSecret()), confirmed_at: new Date() },
    });
    const res = await app.request("/api/account/password", {
      method: "PATCH",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        current_password: PASSWORD,
        new_password: NEW_PASSWORD,
        new_password_confirm: NEW_PASSWORD,
      }),
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

describe("DELETE /api/account/mfa/totp", () => {
  it("removes TOTP for the non-MFA-required operator fixture, leaving WebAuthn credentials untouched", async () => {
    await prisma.userMfaMethod.create({
      data: { user_id: userId, type: "totp", secret_enc: encryptTotpSecret(generateTotpSecret()), confirmed_at: new Date() },
    });
    const credential = await registerConfirmedWebauthnCredential(userId);

    const res = await app.request("/api/account/mfa/totp", {
      method: "DELETE",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
    expect(await prisma.userMfaMethod.count({ where: { user_id: userId, type: "totp" } })).toBe(0);
    expect(await prisma.userMfaMethod.count({ where: { id: credential.credentialRowId } })).toBe(1);

    const audit = await prisma.adminAuditLog.findFirst({
      where: { organization_id: ORG_ACCOUNT, action_type: "account_mfa_totp_removed" },
      orderBy: { created_at: "desc" },
    });
    expect(audit?.actor_user_id).toBe(userId);
  });

  it("removes TOTP even when it is the user's only confirmed MFA method (no server-side last-method block)", async () => {
    await prisma.userMfaMethod.create({
      data: { user_id: userId, type: "totp", secret_enc: encryptTotpSecret(generateTotpSecret()), confirmed_at: new Date() },
    });

    const res = await app.request("/api/account/mfa/totp", {
      method: "DELETE",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect(await prisma.userMfaMethod.count({ where: { user_id: userId } })).toBe(0);
  });

  it("returns 404 when there is no TOTP row to remove", async () => {
    const res = await app.request("/api/account/mfa/totp", {
      method: "DELETE",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });

  it("treats a malformed JSON body the same as no body (no step-up code supplied)", async () => {
    await prisma.userMfaMethod.create({
      data: { user_id: userId, type: "totp", secret_enc: encryptTotpSecret(generateTotpSecret()), confirmed_at: new Date() },
    });

    const res = await app.request("/api/account/mfa/totp", {
      method: "DELETE",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(200);
    expect(await prisma.userMfaMethod.count({ where: { user_id: userId, type: "totp" } })).toBe(0);
  });

  it("returns 400 for a body that fails schema validation", async () => {
    await prisma.userMfaMethod.create({
      data: { user_id: userId, type: "totp", secret_enc: encryptTotpSecret(generateTotpSecret()), confirmed_at: new Date() },
    });

    const res = await app.request("/api/account/mfa/totp", {
      method: "DELETE",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ code: 123456 }), // must be a string
    });
    expect(res.status).toBe(400);
    expect(await prisma.userMfaMethod.count({ where: { user_id: userId, type: "totp" } })).toBe(1);
  });
});

describe("DELETE /api/account/mfa/totp — step-up for MFA-required roles", () => {
  beforeEach(() => rateLimitStore.reset());

  it("returns 400 totp_required when no code is given for an MFA-required role", async () => {
    await enrollConfirmedTotp();
    const res = await app.request("/api/account/mfa/totp", {
      method: "DELETE",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("totp_required");
    expect(await prisma.userMfaMethod.count({ where: { user_id: adminUserId, type: "totp" } })).toBe(1);
  });

  it("returns 401 invalid_totp for a wrong code", async () => {
    await enrollConfirmedTotp();
    const res = await app.request("/api/account/mfa/totp", {
      method: "DELETE",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ code: "000000" }),
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe("invalid_totp");
    expect(await prisma.userMfaMethod.count({ where: { user_id: adminUserId, type: "totp" } })).toBe(1);
  });

  it("returns 429 after exceeding the step-up code rate limit", async () => {
    await enrollConfirmedTotp();
    const bucketKey = `mfa:totp:session:account-totp-remove:${adminSessionId}`;
    for (let i = 0; i < 10; i++) {
      await rateLimitStore.hit(bucketKey, 15 * 60_000, 10);
    }

    const res = await app.request("/api/account/mfa/totp", {
      method: "DELETE",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ code: "000000" }),
    });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error?: string }).error).toBe("too many requests");
    expect(await prisma.userMfaMethod.count({ where: { user_id: adminUserId, type: "totp" } })).toBe(1);
  });

  it("removes TOTP with a correct TOTP code, and writes an audit row", async () => {
    // Seeded directly (not via enroll+confirm) so this is the only code ever verified against
    // this secret — see the equivalent mfa/reset test above for why.
    const secret = generateTotpSecret();
    await prisma.userMfaMethod.create({
      data: { user_id: adminUserId, type: "totp", secret_enc: encryptTotpSecret(secret), confirmed_at: new Date() },
    });

    const res = await app.request("/api/account/mfa/totp", {
      method: "DELETE",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ code: generateTotpCode(secret) }),
    });
    expect(res.status).toBe(200);
    expect(await prisma.userMfaMethod.count({ where: { user_id: adminUserId, type: "totp" } })).toBe(0);

    const audit = await prisma.adminAuditLog.findFirst({
      where: { organization_id: ORG_ACCOUNT, action_type: "account_mfa_totp_removed", actor_user_id: adminUserId },
      orderBy: { created_at: "desc" },
    });
    expect(audit?.actor_user_id).toBe(adminUserId);
  });

  it("removes TOTP with a valid backup recovery code, and consumes it", async () => {
    const backupCode = await enrollConfirmedTotp();

    const res = await app.request("/api/account/mfa/totp", {
      method: "DELETE",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ code: backupCode }),
    });
    expect(res.status).toBe(200);
    expect(await prisma.userMfaMethod.count({ where: { user_id: adminUserId, type: "totp" } })).toBe(0);

    // The same backup code must not work again.
    const other = await createSession(prisma, { userId: adminUserId, stage: SESSION_STAGE.FULL });
    const replay = await app.request("/api/account/mfa/reset", {
      method: "POST",
      headers: { Cookie: `admitto_session=${other.rawToken}`, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ password: ADMIN_PASSWORD, code: backupCode }),
    });
    expect(replay.status).toBe(401);
  });

  it("removes TOTP using a WebAuthn assertion as step-up, leaving the WebAuthn credential itself untouched", async () => {
    await prisma.userMfaMethod.create({
      data: { user_id: adminUserId, type: "totp", secret_enc: encryptTotpSecret(generateTotpSecret()), confirmed_at: new Date() },
    });
    const credential = await registerConfirmedWebauthnCredential(adminUserId);
    const proof = await webauthnStepUpProof(adminCookie, credential.authenticator);

    const res = await app.request("/api/account/mfa/totp", {
      method: "DELETE",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify(proof),
    });
    expect(res.status).toBe(200);
    expect(await prisma.userMfaMethod.count({ where: { user_id: adminUserId, type: "totp" } })).toBe(0);
    expect(await prisma.userMfaMethod.count({ where: { user_id: adminUserId, type: "webauthn" } })).toBe(1);
  });
});

describe("GET /api/account/mfa/backup-codes", () => {
  it("returns 0/0 before any codes have been generated", async () => {
    const res = await app.request("/api/account/mfa/backup-codes", { headers: { Cookie: userCookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ total: 0, remaining: 0 });
  });

  it("reflects the current batch's usage — some codes used, some not", async () => {
    await regenerateBackupRecoveryCodes(prisma, userId);
    const rows = await prisma.userMfaMethod.findMany({ where: { user_id: userId, type: "recovery" } });
    expect(rows).toHaveLength(BACKUP_RECOVERY_CODE_COUNT);
    // Directly mark 3 of the 10 rows as consumed - exercises the same "some used, some not"
    // status the UI's "x of y remaining" copy reads, without needing an MFA-required fixture
    // just to run a code through the step-up consumption path.
    await prisma.userMfaMethod.updateMany({
      where: { id: { in: rows.slice(0, 3).map((r) => r.id) } },
      data: { last_used_at: new Date() },
    });

    const res = await app.request("/api/account/mfa/backup-codes", { headers: { Cookie: userCookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ total: BACKUP_RECOVERY_CODE_COUNT, remaining: BACKUP_RECOVERY_CODE_COUNT - 3 });
  });
});

describe("POST /api/account/mfa/backup-codes/regenerate", () => {
  it("mints a fresh batch of plaintext codes that replaces the old one, and writes an audit row", async () => {
    const { codes: oldCodes } = await regenerateBackupRecoveryCodes(prisma, userId);

    const res = await app.request("/api/account/mfa/backup-codes/regenerate", {
      method: "POST",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; codes: string[] };
    expect(body.ok).toBe(true);
    expect(body.codes).toHaveLength(BACKUP_RECOVERY_CODE_COUNT);
    expect(body.codes).not.toEqual(expect.arrayContaining(oldCodes));

    const audit = await prisma.adminAuditLog.findFirst({
      where: { organization_id: ORG_ACCOUNT, action_type: "account_mfa_backup_codes_regenerated" },
      orderBy: { created_at: "desc" },
    });
    expect(audit?.actor_user_id).toBe(userId);
  });

  it("returns 400 for a body that fails schema validation", async () => {
    const res = await app.request("/api/account/mfa/backup-codes/regenerate", {
      method: "POST",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ code: 123456 }), // must be a string
    });
    expect(res.status).toBe(400);
  });

  it("treats a malformed JSON body the same as no body (no step-up code supplied)", async () => {
    const res = await app.request("/api/account/mfa/backup-codes/regenerate", {
      method: "POST",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(200);
  });
});

describe("POST /api/account/mfa/backup-codes/regenerate — step-up for MFA-required roles", () => {
  beforeEach(() => rateLimitStore.reset());

  it("returns 400 totp_required when no code is given for an MFA-required role", async () => {
    await enrollConfirmedTotp();
    const res = await app.request("/api/account/mfa/backup-codes/regenerate", {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("totp_required");
  });

  it("returns 401 invalid_totp for a wrong code", async () => {
    await enrollConfirmedTotp();
    const res = await app.request("/api/account/mfa/backup-codes/regenerate", {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ code: "000000" }),
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe("invalid_totp");
  });

  it("returns 429 after exceeding the step-up code rate limit", async () => {
    await enrollConfirmedTotp();
    const bucketKey = `mfa:totp:session:account-backup-codes-regenerate:${adminSessionId}`;
    for (let i = 0; i < 10; i++) {
      await rateLimitStore.hit(bucketKey, 15 * 60_000, 10);
    }

    const res = await app.request("/api/account/mfa/backup-codes/regenerate", {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ code: "000000" }),
    });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error?: string }).error).toBe("too many requests");
  });

  it("regenerates with a correct TOTP code, invalidating every old code", async () => {
    // Seeded directly (not via enroll+confirm) so this is the only code ever verified against
    // this secret — see the equivalent mfa/reset test above for why.
    const secret = generateTotpSecret();
    await prisma.userMfaMethod.create({
      data: { user_id: adminUserId, type: "totp", secret_enc: encryptTotpSecret(secret), confirmed_at: new Date() },
    });
    const { codes: oldCodes } = await regenerateBackupRecoveryCodes(prisma, adminUserId);

    const res = await app.request("/api/account/mfa/backup-codes/regenerate", {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ code: generateTotpCode(secret) }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; codes: string[] };
    expect(body.codes).toHaveLength(BACKUP_RECOVERY_CODE_COUNT);
    expect(body.codes).not.toEqual(expect.arrayContaining(oldCodes));

    const statusRes = await app.request("/api/account/mfa/backup-codes", { headers: { Cookie: adminCookie } });
    expect(await statusRes.json()).toEqual({ total: BACKUP_RECOVERY_CODE_COUNT, remaining: BACKUP_RECOVERY_CODE_COUNT });

    // An old code (from before regeneration) no longer verifies as step-up proof.
    const other = await createSession(prisma, { userId: adminUserId, stage: SESSION_STAGE.FULL });
    const replay = await app.request("/api/account/mfa/reset", {
      method: "POST",
      headers: { Cookie: `admitto_session=${other.rawToken}`, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ password: ADMIN_PASSWORD, code: oldCodes[0] }),
    });
    expect(replay.status).toBe(401);

    const audit = await prisma.adminAuditLog.findFirst({
      where: { organization_id: ORG_ACCOUNT, action_type: "account_mfa_backup_codes_regenerated", actor_user_id: adminUserId },
      orderBy: { created_at: "desc" },
    });
    expect(audit?.actor_user_id).toBe(adminUserId);
  });

  it("regenerates backup codes with a valid WebAuthn assertion", async () => {
    const credential = await registerConfirmedWebauthnCredential(adminUserId);
    const proof = await webauthnStepUpProof(adminCookie, credential.authenticator);

    const res = await app.request("/api/account/mfa/backup-codes/regenerate", {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify(proof),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; codes: string[] };
    expect(body.codes).toHaveLength(BACKUP_RECOVERY_CODE_COUNT);
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

describe("PATCH /api/account/profile — preferred_time_format", () => {
  afterEach(async () => {
    await prisma.user.update({ where: { id: userId }, data: { preferred_time_format: null } });
  });

  it("stores an explicit 12-hour preference and returns it from the profile", async () => {
    const patch = await app.request("/api/account/profile", {
      method: "PATCH",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ preferred_time_format: "12h" }),
    });
    expect(patch.status).toBe(200);
    expect((await patch.json()) as { preferred_time_format: string | null }).toEqual(
      expect.objectContaining({ preferred_time_format: "12h" }),
    );

    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row.preferred_time_format).toBe("12h");

    const get = await app.request("/api/account", { headers: { Cookie: userCookie } });
    expect((await get.json()) as { preferred_time_format: string | null }).toEqual(
      expect.objectContaining({ preferred_time_format: "12h" }),
    );
  });

  it("clears the time preference with null", async () => {
    const set = await app.request("/api/account/profile", {
      method: "PATCH",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ preferred_time_format: "24h" }),
    });
    expect(set.status).toBe(200);
    expect((await set.json()) as { preferred_time_format: string | null }).toEqual(
      expect.objectContaining({ preferred_time_format: "24h" }),
    );

    const res = await app.request("/api/account/profile", {
      method: "PATCH",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ preferred_time_format: null }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { preferred_time_format: string | null }).toEqual(
      expect.objectContaining({ preferred_time_format: null }),
    );
  });

  it("rejects unsupported time formats", async () => {
    const res = await app.request("/api/account/profile", {
      method: "PATCH",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ preferred_time_format: "13h" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/account/profile — phone", () => {
  afterEach(async () => {
    await prisma.user.update({ where: { id: userId }, data: { phone_country_code: null, phone_number: null } });
  });

  it("GET /api/account returns null phone fields before the user sets any", async () => {
    const res = await app.request("/api/account", { headers: { Cookie: userCookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { phone_country_code: string | null; phone_number: string | null };
    expect(body.phone_country_code).toBeNull();
    expect(body.phone_number).toBeNull();
  });

  it("sets phone_country_code and phone_number", async () => {
    const res = await app.request("/api/account/profile", {
      method: "PATCH",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ phone_country_code: "+48", phone_number: "600123456" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { phone_country_code: string | null; phone_number: string | null };
    expect(body.phone_country_code).toBe("+48");
    expect(body.phone_number).toBe("600123456");

    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row.phone_country_code).toBe("+48");
    expect(row.phone_number).toBe("600123456");
  });

  it("trims whitespace around phone_number", async () => {
    const res = await app.request("/api/account/profile", {
      method: "PATCH",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ phone_number: "  600123456  " }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { phone_number: string | null };
    expect(body.phone_number).toBe("600123456");
  });

  it("clears phone_number via an empty string", async () => {
    await app.request("/api/account/profile", {
      method: "PATCH",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ phone_country_code: "+48", phone_number: "600123456" }),
    });
    const res = await app.request("/api/account/profile", {
      method: "PATCH",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ phone_number: "" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { phone_number: string | null };
    expect(body.phone_number).toBeNull();

    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row.phone_number).toBeNull();
  });

  it("clears phone_country_code via explicit null", async () => {
    await app.request("/api/account/profile", {
      method: "PATCH",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ phone_country_code: "+48", phone_number: "600123456" }),
    });
    const res = await app.request("/api/account/profile", {
      method: "PATCH",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ phone_country_code: null }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { phone_country_code: string | null; phone_number: string | null };
    expect(body.phone_country_code).toBeNull();
    // Only the field present in the request is touched - phone_number stays whatever it was.
    expect(body.phone_number).toBe("600123456");

    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row.phone_country_code).toBeNull();
    expect(row.phone_number).toBe("600123456");
  });
});

describe("DELETE /api/account/external-identity", () => {
  it("unlinks SSO, sets the new password, keeps the current session, and revokes others", async () => {
    await prisma.externalIdentity.create({
      data: { provider_id: PROVIDER_ID, subject: "self-unlink-subject", user_id: userId },
    });
    const other = await createSession(prisma, { userId, stage: SESSION_STAGE.FULL, ip: "127.0.0.1" });

    const res = await app.request("/api/account/external-identity", {
      method: "DELETE",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ new_password: NEW_PASSWORD, current_password: PASSWORD }),
    });
    expect(res.status).toBe(200);

    expect(await prisma.externalIdentity.count({ where: { user_id: userId } })).toBe(0);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(await verifyPassword(NEW_PASSWORD, user.password_hash!)).toBe(true);
    // Self-service, unlike the admin route: the caller chose this password deliberately.
    expect(user.must_change_password).toBe(false);

    const currentSession = await prisma.session.findUniqueOrThrow({ where: { id: userSessionId } });
    expect(currentSession.revoked_at).toBeNull();
    const otherSession = await prisma.session.findUniqueOrThrow({ where: { id: other.session.id } });
    expect(otherSession.revoked_at).not.toBeNull();
  });

  it("unlinks a Cloudflare Access identity together with its source OIDC identity, not just the OIDC one", async () => {
    // Cloudflare Access identities are only ever auto-provisioned alongside a source OIDC
    // identity (resolveCfAccessIdentityFromValidatedJwt requires one to already exist) and get
    // silently recreated on the next Cloudflare-authenticated request as long as that source
    // identity survives - so leaving it behind here would make this "unlink" a no-op for
    // Cloudflare sign-in, and unlinking just the OIDC identity would orphan the Cloudflare one
    // (every subsequent Cloudflare-protected request then fails with source_identity_not_linked).
    const cfProvider = await prisma.identityProvider.create({
      data: {
        provider_type: "cloudflare_access",
        issuer: "https://team.cloudflareaccess.test",
        client_id: "__cloudflare_access__",
        authorization_endpoint: "https://team.cloudflareaccess.test/cdn-cgi/access/login",
        token_endpoint: "https://team.cloudflareaccess.test/cdn-cgi/access/login",
        jwks_uri: "https://team.cloudflareaccess.test/cdn-cgi/access/certs",
        display_name: "Cloudflare Access",
        enabled: true,
      },
    });
    await prisma.externalIdentity.create({
      data: { provider_id: PROVIDER_ID, subject: "hybrid-unlink-oidc-subject", user_id: userId },
    });
    await prisma.externalIdentity.create({
      data: { provider_id: cfProvider.id, subject: "hybrid-unlink-cf-subject", user_id: userId },
    });

    const res = await app.request("/api/account/external-identity", {
      method: "DELETE",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ new_password: NEW_PASSWORD, current_password: PASSWORD }),
    });
    expect(res.status).toBe(200);
    expect(await prisma.externalIdentity.count({ where: { user_id: userId } })).toBe(0);

    await prisma.identityProvider.delete({ where: { id: cfProvider.id } });
  });

  it("returns 400 current_password_required when the account has a local password and none is given", async () => {
    await prisma.externalIdentity.create({
      data: { provider_id: PROVIDER_ID, subject: "self-unlink-no-current-pass-subject", user_id: userId },
    });

    const res = await app.request("/api/account/external-identity", {
      method: "DELETE",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ new_password: NEW_PASSWORD }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("current_password_required");
    expect(await prisma.externalIdentity.count({ where: { user_id: userId } })).toBe(1);
  });

  it("returns 401 wrong_password for an incorrect current password, and the identity survives", async () => {
    await prisma.externalIdentity.create({
      data: { provider_id: PROVIDER_ID, subject: "self-unlink-wrong-current-pass-subject", user_id: userId },
    });

    const res = await app.request("/api/account/external-identity", {
      method: "DELETE",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ new_password: NEW_PASSWORD, current_password: "definitely-wrong" }),
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe("wrong_password");
    expect(await prisma.externalIdentity.count({ where: { user_id: userId } })).toBe(1);
  });

  it("returns 429 after exceeding the password-check rate limit, independent of the per-IP bucket", async () => {
    rateLimitStore.reset();
    await prisma.externalIdentity.create({
      data: { provider_id: PROVIDER_ID, subject: "self-unlink-ratelimit-subject", user_id: userId },
    });
    // Pre-fill only this endpoint's own user-scoped password-check bucket directly, instead of
    // looping HTTP requests: /api/account/external-identity also sits behind the group-wide
    // auth:account-ip per-IP bucket (applied to all of /api/account/* in app.ts, max 10/min),
    // which would trip at the same threshold on repeated real requests and mask whether this
    // handler's own password-check rate limit is actually the thing returning 429.
    const bucketKey = `account:password-check:user:${userId}`;
    for (let i = 0; i < 10; i++) {
      await rateLimitStore.hit(bucketKey, 60_000, 10);
    }

    const res = await app.request("/api/account/external-identity", {
      method: "DELETE",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ new_password: NEW_PASSWORD, current_password: PASSWORD }),
    });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error?: string }).error).toBe("too many requests");
    expect(await prisma.externalIdentity.count({ where: { user_id: userId } })).toBe(1);
    rateLimitStore.reset();
  });

  it("blocks unlink with 409 while an OIDC-owned role grant exists, leaving identity and grant untouched", async () => {
    await prisma.externalIdentity.create({
      data: { provider_id: PROVIDER_ID, subject: "self-unlink-oidc-role-subject", user_id: userId },
    });
    // Same role/scope_type as the seeded fixture assignment, different scope_id - "operator", not
    // "admin", since admin is in the default mfa_required_roles set and would make requireSession
    // reject this fixture's non-MFA session entirely, unrelated to what this test actually checks.
    const assignment = await prisma.roleAssignment.create({
      data: { user_id: userId, role: "operator", scope_type: "event", scope_id: "evt-account-2" },
    });
    await prisma.oidcRoleGrant.create({
      data: {
        user_id: userId,
        provider_id: PROVIDER_ID,
        role: "operator",
        scope_type: "event",
        scope_id: "evt-account-2",
        role_assignment_id: assignment.id,
      },
    });

    const res = await app.request("/api/account/external-identity", {
      method: "DELETE",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ new_password: NEW_PASSWORD, current_password: PASSWORD }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("provider_managed_roles_exist");

    // Blocked before any write: identity, grant, and assignment all survive untouched.
    expect(await prisma.externalIdentity.count({ where: { user_id: userId } })).toBe(1);
    expect(await prisma.oidcRoleGrant.count({ where: { user_id: userId } })).toBe(1);
    const remaining = await prisma.roleAssignment.findUnique({ where: { id: assignment.id } });
    expect(remaining).not.toBeNull();
  });

  it("returns 400 invalid_request when unlinking without a new password, and the identity survives", async () => {
    await prisma.externalIdentity.create({
      data: { provider_id: PROVIDER_ID, subject: "self-unlink-no-pass-subject", user_id: userId },
    });

    const res = await app.request("/api/account/external-identity", {
      method: "DELETE",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(await prisma.externalIdentity.count({ where: { user_id: userId } })).toBe(1);
  });

  it("returns 400 password_too_common for a blocklisted new password, and the identity survives", async () => {
    await prisma.externalIdentity.create({
      data: { provider_id: PROVIDER_ID, subject: "self-unlink-common-pass-subject", user_id: userId },
    });

    const res = await app.request("/api/account/external-identity", {
      method: "DELETE",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ new_password: "aaaaaaaaaaaa" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("password_too_common");
    expect(await prisma.externalIdentity.count({ where: { user_id: userId } })).toBe(1);
  });

  it("returns 404 when nothing is linked", async () => {
    const res = await app.request("/api/account/external-identity", {
      method: "DELETE",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ new_password: NEW_PASSWORD }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 400 insufficient_verification for an SSO-only account with no local password and no TOTP, and the identity survives", async () => {
    await prisma.externalIdentity.create({
      data: { provider_id: PROVIDER_ID, subject: "self-unlink-no-proof-subject", user_id: oidcUserId },
    });
    const oidcSession = await createSession(prisma, { userId: oidcUserId, stage: SESSION_STAGE.FULL });

    const res = await app.request("/api/account/external-identity", {
      method: "DELETE",
      headers: { Cookie: `admitto_session=${oidcSession.rawToken}`, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ new_password: NEW_PASSWORD }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("insufficient_verification");
    expect(await prisma.externalIdentity.count({ where: { user_id: oidcUserId } })).toBe(1);

    await prisma.session.delete({ where: { id: oidcSession.session.id } });
    await prisma.externalIdentity.deleteMany({ where: { user_id: oidcUserId } });
  });
});

describe("DELETE /api/account/external-identity — step-up for MFA-required roles", () => {
  beforeEach(() => rateLimitStore.reset());

  it("returns 400 totp_required when no code is given for an MFA-required role", async () => {
    await enrollConfirmedTotp();
    await prisma.externalIdentity.create({
      data: { provider_id: PROVIDER_ID, subject: "self-unlink-stepup-subject", user_id: adminUserId },
    });

    const res = await app.request("/api/account/external-identity", {
      method: "DELETE",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ new_password: NEW_PASSWORD }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("totp_required");
    expect(await prisma.externalIdentity.count({ where: { user_id: adminUserId } })).toBe(1);
  });

  it("returns 401 invalid_totp for a wrong code", async () => {
    await enrollConfirmedTotp();
    await prisma.externalIdentity.create({
      data: { provider_id: PROVIDER_ID, subject: "self-unlink-stepup-wrong-subject", user_id: adminUserId },
    });

    const res = await app.request("/api/account/external-identity", {
      method: "DELETE",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ new_password: NEW_PASSWORD, code: "000000" }),
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe("invalid_totp");
    expect(await prisma.externalIdentity.count({ where: { user_id: adminUserId } })).toBe(1);
  });

  it("returns 429 after exceeding the step-up code rate limit", async () => {
    await enrollConfirmedTotp();
    await prisma.externalIdentity.create({
      data: { provider_id: PROVIDER_ID, subject: "self-unlink-stepup-ratelimit-subject", user_id: adminUserId },
    });
    const bucketKey = `mfa:totp:session:account-external-identity:${adminSessionId}`;
    for (let i = 0; i < 10; i++) {
      await rateLimitStore.hit(bucketKey, 15 * 60_000, 10);
    }

    const res = await app.request("/api/account/external-identity", {
      method: "DELETE",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ new_password: NEW_PASSWORD, code: "000000" }),
    });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error?: string }).error).toBe("too many requests");
  });

  it("unlinks with a correct TOTP code", async () => {
    const secret = generateTotpSecret();
    await prisma.userMfaMethod.create({
      data: { user_id: adminUserId, type: "totp", secret_enc: encryptTotpSecret(secret), confirmed_at: new Date() },
    });
    await prisma.externalIdentity.create({
      data: { provider_id: PROVIDER_ID, subject: "self-unlink-stepup-ok-subject", user_id: adminUserId },
    });

    const res = await app.request("/api/account/external-identity", {
      method: "DELETE",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ new_password: NEW_PASSWORD, code: generateTotpCode(secret) }),
    });
    expect(res.status).toBe(200);
    expect(await prisma.externalIdentity.count({ where: { user_id: adminUserId } })).toBe(0);
  });

  it("unlinks with a valid WebAuthn assertion", async () => {
    const credential = await registerConfirmedWebauthnCredential(adminUserId);
    const proof = await webauthnStepUpProof(adminCookie, credential.authenticator);
    await prisma.externalIdentity.create({
      data: { provider_id: PROVIDER_ID, subject: "self-unlink-stepup-webauthn-subject", user_id: adminUserId },
    });

    const res = await app.request("/api/account/external-identity", {
      method: "DELETE",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ new_password: NEW_PASSWORD, ...proof }),
    });
    expect(res.status).toBe(200);
    expect(await prisma.externalIdentity.count({ where: { user_id: adminUserId } })).toBe(0);
  });

  it("returns 401 invalid_webauthn for a WebAuthn-only account when the assertion is wrong", async () => {
    await registerConfirmedWebauthnCredential(adminUserId);
    await prisma.externalIdentity.create({
      data: { provider_id: PROVIDER_ID, subject: "self-unlink-stepup-webauthn-wrong-subject", user_id: adminUserId },
    });
    const wrongAuthenticator = createVirtualAuthenticator();
    const beginRes = await app.request("/api/account/mfa/webauthn/assert/begin", {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: "{}",
    });
    const { options } = (await beginRes.json()) as { options: { challenge: string } };
    const response = wrongAuthenticator.authenticate({
      challenge: options.challenge,
      rpID: WEBAUTHN_RP.rpID,
      origin: WEBAUTHN_RP.origin,
    });

    const res = await app.request("/api/account/external-identity", {
      method: "DELETE",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ new_password: NEW_PASSWORD, webauthn: { response } }),
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe("invalid_webauthn");
    expect(await prisma.externalIdentity.count({ where: { user_id: adminUserId } })).toBe(1);
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
