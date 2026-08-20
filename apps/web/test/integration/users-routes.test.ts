import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { AUTH_METHOD, createSession, hashPassword, SESSION_STAGE, verifyPassword } from "@admitto/auth";
import { encryptTotpSecret, generateTotpCode, generateTotpSecret } from "@admitto/auth/testing";
import * as tickets from "@admitto/tickets";
import { createApp } from "../../src/app.js";
import {
  assertLastSuperadminDeactivationAllowed,
  assertLastSuperadminDeleteAllowed,
  LastSuperadminError,
} from "../../src/admin/users-lockout-guards.js";
import { InMemoryRateLimitStore } from "../../src/rate-limit/in-memory.js";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };

const ORG_USERS = "org-users-test";
const PROVIDER_ID = "iam-users-test-provider";
const EMAIL_SUPER = "users-super@example.com";
const EMAIL_ADMIN = "users-admin@example.com";
const EMAIL_OPERATOR = "users-operator@example.com";
const EMAIL_TARGET = "users-target@example.com";
const PASSWORD = "users-pass-123";
const NEW_PASSWORD = "new-temp-pass-99";

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;

let superId = "";
let adminId = "";
let operatorId = "";
let targetId = "";
let superCookie = "";
let adminCookie = "";
let operatorCookie = "";
let superSessionId = "";
let adminSessionId = "";
let operatorSessionId = "";
let superAssignmentId = "";
let targetAssignmentId = "";
let eventId = "";
let prevInstanceOrgId: string | undefined;
let rateLimitStore: InMemoryRateLimitStore;

/**
 * One-shot hook for simulating a concurrent SSO link racing the admin-assisted reset endpoints'
 * own `tx.externalIdentity.findFirst` mid-transaction (TOCTOU tests below). Query extensions run
 * for queries issued inside `$transaction` callbacks too (same technique as
 * admin-attendees.test.ts's `onAttendeeFindMany`), so this still intercepts the route handlers'
 * in-transaction re-check - armed to fire *before* the hooked query runs (unlike
 * onAttendeeFindMany, which fires after), so the concurrent link commits before the handler's
 * own read, matching the "SSO link completed after the pre-check" scenario being tested.
 */
let onExternalIdentityFindFirst: (() => Promise<void>) | null = null;

async function seed(client: PrismaClient) {
  await client.adminAuditLog.deleteMany({ where: { organization_id: ORG_USERS } });
  await client.oidcRoleGrant.deleteMany({ where: { provider_id: PROVIDER_ID } });
  await client.identityProvider.deleteMany({ where: { id: PROVIDER_ID } });
  await client.session.deleteMany({
    where: {
      user: {
        email: { in: [EMAIL_SUPER, EMAIL_ADMIN, EMAIL_OPERATOR, EMAIL_TARGET] },
      },
    },
  });
  await client.userMfaMethod.deleteMany({
    where: {
      user: {
        email: { in: [EMAIL_SUPER, EMAIL_ADMIN, EMAIL_OPERATOR, EMAIL_TARGET] },
      },
    },
  });
  await client.roleAssignment.deleteMany({ where: { scope_id: ORG_USERS } });
  await client.roleAssignment.deleteMany({
    where: {
      role: "superadmin",
      scope_type: "instance",
      scope_id: null,
      user: {
        email: { notIn: [EMAIL_SUPER, EMAIL_ADMIN, EMAIL_OPERATOR, EMAIL_TARGET] },
      },
    },
  });
  await client.roleAssignment.deleteMany({
    where: {
      user: {
        email: { in: [EMAIL_SUPER, EMAIL_ADMIN, EMAIL_OPERATOR, EMAIL_TARGET] },
      },
    },
  });
  await client.event.deleteMany({ where: { organization_id: ORG_USERS } });
  await client.user.deleteMany({
    where: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN, EMAIL_OPERATOR, EMAIL_TARGET] } },
  });
  await client.organization.deleteMany({ where: { id: ORG_USERS } });

  const password_hash = await hashPassword(PASSWORD);

  await client.organization.create({
    data: { id: ORG_USERS, name: "Users Test Org", slug: "users-test" },
  });

  const event = await client.event.create({
    data: {
      title: "Users Test Event",
      slug: "users-test-event",
      organization_id: ORG_USERS,
      date: new Date("2025-01-01"),
    },
  });
  eventId = event.id;

  const superUser = await client.user.create({ data: { email: EMAIL_SUPER, password_hash } });
  const adminUser = await client.user.create({ data: { email: EMAIL_ADMIN, password_hash } });
  const operatorUser = await client.user.create({ data: { email: EMAIL_OPERATOR, password_hash } });
  const targetUser = await client.user.create({ data: { email: EMAIL_TARGET, password_hash } });
  superId = superUser.id;
  adminId = adminUser.id;
  operatorId = operatorUser.id;
  targetId = targetUser.id;

  const superAssignment = await client.roleAssignment.create({
    data: { user_id: superId, role: "superadmin", scope_type: "instance", scope_id: null },
  });
  superAssignmentId = superAssignment.id;

  await client.roleAssignment.createMany({
    data: [
      { user_id: adminId, role: "admin", scope_type: "organization", scope_id: ORG_USERS },
      { user_id: operatorId, role: "operator", scope_type: "event", scope_id: eventId },
    ],
  });

  const targetAssignment = await client.roleAssignment.create({
    data: { user_id: targetId, role: "operator", scope_type: "event", scope_id: eventId },
  });
  targetAssignmentId = targetAssignment.id;

  for (const userId of [superId, adminId, operatorId, targetId]) {
    await client.userMfaMethod.create({
      data: {
        user_id: userId,
        type: "totp",
        secret_enc: encryptTotpSecret(generateTotpSecret()),
        confirmed_at: new Date(),
      },
    });
  }

  await client.identityProvider.create({
    data: {
      id: PROVIDER_ID,
      provider_type: "oidc",
      issuer: "https://iam-users.example.com/",
      client_id: "test-client",
      authorization_endpoint: "https://iam-users.example.com/a",
      token_endpoint: "https://iam-users.example.com/t",
      jwks_uri: "https://iam-users.example.com/j",
      display_name: "IAM Users Test IdP",
    },
  });
}

beforeAll(async () => {
  prevInstanceOrgId = process.env.INSTANCE_ORG_ID;
  process.env.INSTANCE_ORG_ID = ORG_USERS;

  // `$on`/`$connect` aren't preserved on extended clients' types (Prisma's client-extensions
  // docs: "client-level methods do not necessarily exist on extended clients") - this file never
  // calls those on `prisma`, so the cast back to `PrismaClient` is safe.
  prisma = createTestPrismaClient().$extends({
    query: {
      externalIdentity: {
        async findFirst({ args, query }) {
          if (onExternalIdentityFindFirst) {
            const hook = onExternalIdentityFindFirst;
            onExternalIdentityFindFirst = null;
            await hook();
          }
          return query(args);
        },
      },
    },
  }) as PrismaClient;
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

  const superSession = await createSession(prisma, {
    userId: superId,
    stage: SESSION_STAGE.FULL,
    ip: "127.0.0.1",
  });
  const adminSession = await createSession(prisma, {
    userId: adminId,
    stage: SESSION_STAGE.FULL,
    ip: "127.0.0.2",
  });
  const operatorSession = await createSession(prisma, {
    userId: operatorId,
    stage: SESSION_STAGE.FULL,
    ip: "127.0.0.3",
  });
  superCookie = `admitto_session=${superSession.rawToken}`;
  adminCookie = `admitto_session=${adminSession.rawToken}`;
  operatorCookie = `admitto_session=${operatorSession.rawToken}`;
  superSessionId = superSession.session.id;
  adminSessionId = adminSession.session.id;
  operatorSessionId = operatorSession.session.id;
});

afterEach(async () => {
  await prisma.adminAuditLog.deleteMany({ where: { organization_id: ORG_USERS } });
  await prisma.oidcRoleGrant.deleteMany({ where: { provider_id: PROVIDER_ID } });
  await prisma.user.updateMany({
    where: { email: EMAIL_TARGET },
    data: { is_active: true, must_change_password: false },
  });
  await prisma.session.deleteMany({
    where: {
      user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN, EMAIL_OPERATOR, EMAIL_TARGET] } },
      id: { notIn: [superSessionId, adminSessionId, operatorSessionId] },
    },
  });
  const superAssignment = await prisma.roleAssignment.findFirst({
    where: { user_id: superId, role: "superadmin", scope_type: "instance", scope_id: null },
  });
  if (!superAssignment) {
    const created = await prisma.roleAssignment.create({
      data: { user_id: superId, role: "superadmin", scope_type: "instance", scope_id: null },
    });
    superAssignmentId = created.id;
  } else {
    superAssignmentId = superAssignment.id;
  }
  await prisma.user.update({
    where: { id: superId },
    data: { must_change_password: false, is_active: true },
  });
  await prisma.userMfaMethod.deleteMany({ where: { user_id: targetId } });
  await prisma.userMfaMethod.create({
    data: {
      user_id: targetId,
      type: "totp",
      secret_enc: encryptTotpSecret(generateTotpSecret()),
      confirmed_at: new Date(),
    },
  });
});

afterAll(async () => {
  if (prevInstanceOrgId !== undefined) process.env.INSTANCE_ORG_ID = prevInstanceOrgId;
  else delete process.env.INSTANCE_ORG_ID;
  await prisma?.$disconnect();
});

describe("GET /api/admin/users security", () => {
  it("returns 401 without auth", async () => {
    const res = await app.request("/api/admin/users");
    expect(res.status).toBe(401);
  });

  it("returns 403 for operator", async () => {
    const res = await app.request("/api/admin/users", { headers: { Cookie: operatorCookie } });
    expect(res.status).toBe(403);
  });

  it("never includes password_hash in response", async () => {
    const res = await app.request("/api/admin/users", { headers: { Cookie: superCookie } });
    const raw = await res.text();
    expect(raw).not.toContain("password_hash");
    expect(raw).not.toContain("secret_enc");
  });

  it("includes has_sso on each user row", async () => {
    const res = await app.request("/api/admin/users?role=superadmin", {
      headers: { Cookie: superCookie },
    });
    const body = (await res.json()) as { users: Array<{ has_sso: boolean }> };
    expect(body.users.length).toBeGreaterThan(0);
    for (const user of body.users) {
      expect(typeof user.has_sso).toBe("boolean");
    }
  });

  it("includes each linked provider's display name in external_identities, not just has_sso", async () => {
    const created = await prisma.user.create({
      data: { email: "sso-list-identity@example.com", password_hash: await hashPassword(PASSWORD) },
    });
    await prisma.externalIdentity.create({
      data: { provider_id: PROVIDER_ID, subject: "sso-list-identity-subject", user_id: created.id },
    });

    try {
      const res = await app.request("/api/admin/users?q=sso-list-identity", {
        headers: { Cookie: superCookie },
      });
      const body = (await res.json()) as {
        users: Array<{
          id: string;
          has_sso: boolean;
          external_identities: Array<{ id: string; provider_display_name: string }>;
        }>;
      };
      expect(body.users).toHaveLength(1);
      const user = body.users[0];
      expect(user?.has_sso).toBe(true);
      expect(user?.external_identities).toHaveLength(1);
      expect(user?.external_identities[0]?.provider_display_name).toBe("IAM Users Test IdP");
    } finally {
      await prisma.externalIdentity.deleteMany({ where: { user_id: created.id } });
      await prisma.user.deleteMany({ where: { id: created.id } });
    }
  });

  it("filters by role and status query params", async () => {
    const superOnly = await app.request("/api/admin/users?role=superadmin", {
      headers: { Cookie: superCookie },
    });
    expect(superOnly.status).toBe(200);
    const superBody = (await superOnly.json()) as {
      users: Array<{ roles: Array<{ role: string }> }>;
      total: number;
    };
    expect(superBody.total).toBeGreaterThanOrEqual(1);
    for (const user of superBody.users) {
      expect(user.roles.some((r) => r.role === "superadmin")).toBe(true);
    }

    const activeOnly = await app.request("/api/admin/users?status=active", {
      headers: { Cookie: superCookie },
    });
    expect(activeOnly.status).toBe(200);
    const activeBody = (await activeOnly.json()) as {
      users: Array<{ is_active: boolean }>;
    };
    for (const user of activeBody.users) {
      expect(user.is_active).toBe(true);
    }
  });
});

describe("GET /api/admin/users/stats security", () => {
  it("returns 401 without auth", async () => {
    const res = await app.request("/api/admin/users/stats");
    expect(res.status).toBe(401);
  });

  it("returns 403 for operator", async () => {
    const res = await app.request("/api/admin/users/stats", { headers: { Cookie: operatorCookie } });
    expect(res.status).toBe(403);
  });

  it("returns instance-wide counts unaffected by pagination", async () => {
    const res = await app.request("/api/admin/users/stats", { headers: { Cookie: superCookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      total: number;
      active: number;
      mfa: number;
      password_users: number;
      sso: number;
      active_sessions: number;
      active_sessions_users: number;
    };
    expect(body.total).toBeGreaterThanOrEqual(4);
    expect(body.active).toBeGreaterThanOrEqual(1);
    expect(body.mfa).toBeGreaterThanOrEqual(0);
    expect(body.password_users).toBeGreaterThanOrEqual(0);
    expect(body.sso).toBeGreaterThanOrEqual(0);
    expect(body.active_sessions).toBeGreaterThanOrEqual(1);
    expect(body.active_sessions_users).toBeGreaterThanOrEqual(1);
  });

  it("counts a hybrid password+SSO user's unprotected password path, and excludes an SSO-only user entirely (codex review)", async () => {
    const before = (await (
      await app.request("/api/admin/users/stats", { headers: { Cookie: superCookie } })
    ).json()) as { mfa: number; password_users: number; sso: number };

    const hybridUser = await prisma.user.create({
      data: { email: "stats-hybrid-no-mfa@example.com", password_hash: await hashPassword(PASSWORD) },
    });
    const ssoOnlyUser = await prisma.user.create({
      data: { email: "stats-sso-only@example.com", password_hash: null },
    });
    await prisma.externalIdentity.createMany({
      data: [
        { provider_id: PROVIDER_ID, subject: "stats-hybrid-subject", user_id: hybridUser.id },
        { provider_id: PROVIDER_ID, subject: "stats-sso-only-subject", user_id: ssoOnlyUser.id },
      ],
    });

    try {
      const res = await app.request("/api/admin/users/stats", { headers: { Cookie: superCookie } });
      const body = (await res.json()) as { mfa: number; password_users: number; sso: number };

      // Both new users are SSO-linked (sso +2), but only the hybrid one still has a password
      // to protect (password_users +1) - and since it has no confirmed MFA, mfa must NOT
      // increase, leaving that hybrid account's password path visibly uncovered.
      expect(body.sso).toBe(before.sso + 2);
      expect(body.password_users).toBe(before.password_users + 1);
      expect(body.mfa).toBe(before.mfa);
    } finally {
      await prisma.externalIdentity.deleteMany({ where: { user_id: { in: [hybridUser.id, ssoOnlyUser.id] } } });
      await prisma.user.deleteMany({ where: { id: { in: [hybridUser.id, ssoOnlyUser.id] } } });
    }
  });
});

describe("POST /api/admin/users security", () => {
  it("returns 403 for non-superadmin admin", async () => {
    const res = await app.request("/api/admin/users", {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "blocked-create@example.com",
        password: "long-enough",
      }),
    });
    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/admin/users/:id anti-lockout", () => {
  it("returns 409 cannot_deactivate_self", async () => {
    const res = await app.request(`/api/admin/users/${superId}`, {
      method: "PATCH",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: false }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("cannot_deactivate_self");
  });

  it("blocks deactivating the sole active superadmin in the PATCH guard", async () => {
    await expect(
      prisma.$transaction((tx) => assertLastSuperadminDeactivationAllowed(tx, superId)),
    ).rejects.toBeInstanceOf(LastSuperadminError);
  });

  it("blocks deleting the sole active superadmin in the DELETE guard", async () => {
    await expect(
      prisma.$transaction((tx) => assertLastSuperadminDeleteAllowed(tx, superId)),
    ).rejects.toBeInstanceOf(LastSuperadminError);
  });
});

describe("PATCH /api/admin/users/:id profile", () => {
  it("normalizes a blank display name and records a profile-only update", async () => {
    const res = await app.request(`/api/admin/users/${targetId}`, {
      method: "PATCH",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ display_name: "   " }),
    });

    expect(res.status).toBe(200);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: targetId } });
    expect(user.display_name).toBeNull();
    expect(
      await prisma.adminAuditLog.findFirst({
        where: { organization_id: ORG_USERS, action_type: "user_profile_updated" },
        orderBy: { created_at: "desc" },
      }),
    ).toMatchObject({ metadata: { userId: targetId } });
  });

  it("saves and clears the phone country code and number", async () => {
    const setRes = await app.request(`/api/admin/users/${targetId}`, {
      method: "PATCH",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ phone_country_code: "+48", phone_number: "500100200" }),
    });
    expect(setRes.status).toBe(200);
    let user = await prisma.user.findUniqueOrThrow({ where: { id: targetId } });
    expect(user.phone_country_code).toBe("+48");
    expect(user.phone_number).toBe("500100200");

    const clearRes = await app.request(`/api/admin/users/${targetId}`, {
      method: "PATCH",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ phone_country_code: "", phone_number: "" }),
    });
    expect(clearRes.status).toBe(200);
    user = await prisma.user.findUniqueOrThrow({ where: { id: targetId } });
    expect(user.phone_country_code).toBeNull();
    expect(user.phone_number).toBeNull();
  });

  it("also clears the phone fields when the edit modal sends null instead of an empty string", async () => {
    // The Edit user modal always sends both phone fields, using null (not "") to mean "cleared" -
    // typeof body.phone_country_code === "string" alone silently dropped a null, so a previously
    // saved number could never actually be removed.
    const setRes = await app.request(`/api/admin/users/${targetId}`, {
      method: "PATCH",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ phone_country_code: "+48", phone_number: "500100200" }),
    });
    expect(setRes.status).toBe(200);

    const clearRes = await app.request(`/api/admin/users/${targetId}`, {
      method: "PATCH",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ phone_country_code: null, phone_number: null }),
    });
    expect(clearRes.status).toBe(200);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: targetId } });
    expect(user.phone_country_code).toBeNull();
    expect(user.phone_number).toBeNull();
  });
});

describe("PATCH /api/admin/users/:id email", () => {
  const EMAIL_PATCH_ORIGINAL = "users-patch-email@example.com";
  const EMAIL_PATCH_NEW = "users-patch-email-new@example.com";
  let patchUserId = "";

  beforeAll(async () => {
    const created = await prisma.user.create({
      data: { email: EMAIL_PATCH_ORIGINAL, password_hash: await hashPassword(PASSWORD) },
    });
    patchUserId = created.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: patchUserId } });
  });

  it("updates the email and records user_email_changed", async () => {
    const res = await app.request(`/api/admin/users/${patchUserId}`, {
      method: "PATCH",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ email: EMAIL_PATCH_NEW }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { email: string } };
    expect(body.user.email).toBe(EMAIL_PATCH_NEW);
    expect(
      await prisma.adminAuditLog.findFirst({
        where: { organization_id: ORG_USERS, action_type: "user_email_changed" },
        orderBy: { created_at: "desc" },
      }),
    ).toMatchObject({ metadata: { userId: patchUserId } });
  });

  it("resubmitting the current email alongside another field records user_profile_updated, not user_email_changed", async () => {
    // The Edit user modal always resends the current email on every save, not only when the
    // admin actually edited it - the audit action type must compare against the prior value
    // instead of treating "email present in the body" as "email changed" (bot review finding).
    const res = await app.request(`/api/admin/users/${patchUserId}`, {
      method: "PATCH",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ email: EMAIL_PATCH_NEW, display_name: "Renamed" }),
    });
    expect(res.status).toBe(200);

    const latest = await prisma.adminAuditLog.findFirst({
      where: { organization_id: ORG_USERS, metadata: { path: ["userId"], equals: patchUserId } },
      orderBy: { created_at: "desc" },
    });
    expect(latest?.action_type).toBe("user_profile_updated");
  });

  it("returns 409 email_conflict for a duplicate email", async () => {
    // A self-contained colliding pair, rather than reusing a shared fixture's current email -
    // other describe blocks in this file mutate targetId's own email over the course of the
    // suite, so asserting a collision against it here would depend on run order.
    const collision = "users-patch-email-conflict@example.com";
    const other = await prisma.user.create({
      data: { email: collision, password_hash: await hashPassword(PASSWORD) },
    });
    try {
      const res = await app.request(`/api/admin/users/${patchUserId}`, {
        method: "PATCH",
        headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ email: collision }),
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("email_conflict");
    } finally {
      await prisma.user.deleteMany({ where: { id: other.id } });
    }
  });

  it("returns 400 invalid_email for a blank email", async () => {
    const res = await app.request(`/api/admin/users/${patchUserId}`, {
      method: "PATCH",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ email: "   " }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invalid_email");
  });

  it("returns 400 invalid_email for a malformed email", async () => {
    const res = await app.request(`/api/admin/users/${patchUserId}`, {
      method: "PATCH",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ email: "not-an-email" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invalid_email");
  });
});

describe("DELETE /api/admin/users/:id", () => {
  let deleteUserId = "";
  let deleteAssignmentId = "";

  beforeAll(async () => {
    const created = await prisma.user.create({
      data: { email: "users-delete-target@example.com", password_hash: await hashPassword(PASSWORD) },
    });
    deleteUserId = created.id;
    const assignment = await prisma.roleAssignment.create({
      data: { user_id: deleteUserId, role: "operator", scope_type: "event", scope_id: eventId },
    });
    deleteAssignmentId = assignment.id;
    await prisma.userMfaMethod.create({
      data: {
        user_id: deleteUserId,
        type: "totp",
        secret_enc: encryptTotpSecret(generateTotpSecret()),
        confirmed_at: new Date(),
      },
    });
    await createSession(prisma, { userId: deleteUserId, stage: SESSION_STAGE.FULL, ip: "127.0.0.9" });
    await prisma.securityAuditLog.create({
      data: {
        event_type: "auth.login.success",
        user_id: deleteUserId,
        user_email: "users-delete-target@example.com",
        user_display_name: null,
        ip: "127.0.0.9",
        metadata: { userAgent: "vitest" },
      },
    });
  });

  it("returns 401 without auth", async () => {
    const res = await app.request(`/api/admin/users/${deleteUserId}`, {
      method: "DELETE",
      headers: { ...sameOrigin },
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 for operator", async () => {
    const res = await app.request(`/api/admin/users/${deleteUserId}`, {
      method: "DELETE",
      headers: { Cookie: operatorCookie, ...sameOrigin },
    });
    expect(res.status).toBe(403);
  });

  it("returns 409 cannot_delete_self", async () => {
    const res = await app.request(`/api/admin/users/${superId}`, {
      method: "DELETE",
      headers: { Cookie: superCookie, ...sameOrigin },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("cannot_delete_self");
  });

  it("deletes the user and cascades sessions, roles, and MFA methods", async () => {
    const res = await app.request(`/api/admin/users/${deleteUserId}`, {
      method: "DELETE",
      headers: { Cookie: superCookie, ...sameOrigin },
    });
    expect(res.status).toBe(200);

    expect(await prisma.user.findUnique({ where: { id: deleteUserId } })).toBeNull();
    expect(await prisma.roleAssignment.findUnique({ where: { id: deleteAssignmentId } })).toBeNull();
    expect(await prisma.session.findMany({ where: { user_id: deleteUserId } })).toHaveLength(0);
    expect(await prisma.userMfaMethod.findMany({ where: { user_id: deleteUserId } })).toHaveLength(0);

    expect(
      await prisma.adminAuditLog.findFirst({
        where: { organization_id: ORG_USERS, action_type: "user_deleted" },
        orderBy: { created_at: "desc" },
      }),
    ).toMatchObject({
      metadata: { userId: deleteUserId },
      actor_email: EMAIL_SUPER,
    });

    expect(
      await prisma.securityAuditLog.findFirst({ where: { user_id: deleteUserId } }),
    ).toMatchObject({
      user_email: "users-delete-target@example.com",
    });
  });

  it("returns 404 for an unknown user", async () => {
    const res = await app.request(`/api/admin/users/${deleteUserId}`, {
      method: "DELETE",
      headers: { Cookie: superCookie, ...sameOrigin },
    });
    expect(res.status).toBe(404);
  });

  it("deletes an already-inactive superadmin without tripping the last-active-superadmin guard", async () => {
    // Deleting an inactive superadmin can never reduce the ACTIVE superadmin count - they
    // weren't counted in it to begin with - so this must succeed even with only one active
    // superadmin (superId) instance-wide. The delete path previously reused the deactivation
    // guard, which only checks "is the target a superadmin" and not whether they're already
    // inactive, wrongly blocking this (bot review finding on #722).
    const created = await prisma.user.create({
      data: { email: "users-delete-inactive-superadmin@example.com", password_hash: await hashPassword(PASSWORD), is_active: false },
    });
    await prisma.roleAssignment.create({
      data: { user_id: created.id, role: "superadmin", scope_type: "instance", scope_id: null },
    });

    try {
      const res = await app.request(`/api/admin/users/${created.id}`, {
        method: "DELETE",
        headers: { Cookie: superCookie, ...sameOrigin },
      });
      expect(res.status).toBe(200);
      expect(await prisma.user.findUnique({ where: { id: created.id } })).toBeNull();
    } finally {
      await prisma.roleAssignment.deleteMany({ where: { user_id: created.id } });
      await prisma.user.deleteMany({ where: { id: created.id } });
    }
  });
});

describe("DELETE /api/admin/users/:id/roles/:assignmentId anti-lockout", () => {
  // Revoking a superadmin-role assignment is only ever permitted when the actor is themselves
  // a superadmin (assertRoleGrantAllowed forbids everyone else outright) - so with only one
  // global superadmin in the fixtures, the *only* reachable actor for this call is that same
  // superadmin, making self-revoke and "last superadmin" the same scenario. The self-check below
  // now catches it first (a more specific, correct reason); last_superadmin stays in place as
  // defense-in-depth for this path but isn't independently reachable via this route today.
  it("returns 409 cannot_remove_own_role when a superadmin revokes their own assignment", async () => {
    const globalSuperadmins = await prisma.roleAssignment.count({
      where: { role: "superadmin", scope_type: "instance", scope_id: null },
    });
    expect(globalSuperadmins).toBe(1);

    const res = await app.request(`/api/admin/users/${superId}/roles/${superAssignmentId}`, {
      method: "DELETE",
      headers: { Cookie: superCookie, ...sameOrigin },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("cannot_remove_own_role");
  });

  it("returns 409 managed_by_idp for OIDC-managed assignment", async () => {
    await prisma.oidcRoleGrant.create({
      data: {
        user_id: targetId,
        provider_id: PROVIDER_ID,
        role: "operator",
        scope_type: "event",
        scope_id: eventId,
        role_assignment_id: targetAssignmentId,
      },
    });

    const res = await app.request(
      `/api/admin/users/${targetId}/roles/${targetAssignmentId}`,
      {
        method: "DELETE",
        headers: { Cookie: superCookie, ...sameOrigin },
      },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("managed_by_idp");
  });

  it("returns 403 for org admin when assignment does not exist", async () => {
    const res = await app.request(`/api/admin/users/${targetId}/roles/does-not-exist`, {
      method: "DELETE",
      headers: { Cookie: adminCookie, ...sameOrigin },
    });
    expect(res.status).toBe(403);
  });

  it("returns 404 for superadmin when assignment belongs to another user", async () => {
    const res = await app.request(`/api/admin/users/${superId}/roles/${targetAssignmentId}`, {
      method: "DELETE",
      headers: { Cookie: superCookie, ...sameOrigin },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });

  it("returns 204 when superadmin deletes an already-removed assignment", async () => {
    const email = "double-delete-role@example.com";
    const created = await prisma.user.create({
      data: { email, password_hash: await hashPassword(PASSWORD) },
    });
    const assignment = await prisma.roleAssignment.create({
      data: {
        user_id: created.id,
        role: "operator",
        scope_type: "event",
        scope_id: eventId,
      },
    });

    try {
      const first = await app.request(`/api/admin/users/${created.id}/roles/${assignment.id}`, {
        method: "DELETE",
        headers: { Cookie: superCookie, ...sameOrigin },
      });
      expect(first.status).toBe(204);

      const second = await app.request(`/api/admin/users/${created.id}/roles/${assignment.id}`, {
        method: "DELETE",
        headers: { Cookie: superCookie, ...sameOrigin },
      });
      expect(second.status).toBe(204);
    } finally {
      await prisma.roleAssignment.deleteMany({ where: { user_id: created.id } });
      await prisma.user.deleteMany({ where: { id: created.id } });
    }
  });
});

describe("POST /api/admin/users/:id/roles - exclusive role types", () => {
  it("replaces an existing role type when granting a different one", async () => {
    const created = await prisma.user.create({
      data: { email: "role-switch@example.com", password_hash: await hashPassword(PASSWORD) },
    });
    const oldAssignment = await prisma.roleAssignment.create({
      data: { user_id: created.id, role: "operator", scope_type: "event", scope_id: eventId },
    });

    try {
      const res = await app.request(`/api/admin/users/${created.id}/roles`, {
        method: "POST",
        headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ role: "admin", scope_type: "organization", scope_id: ORG_USERS }),
      });
      expect(res.status).toBe(201);

      const remaining = await prisma.roleAssignment.findMany({ where: { user_id: created.id } });
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.role).toBe("admin");
      expect(remaining[0]?.id).not.toBe(oldAssignment.id);
    } finally {
      await prisma.roleAssignment.deleteMany({ where: { user_id: created.id } });
      await prisma.user.deleteMany({ where: { id: created.id } });
    }
  });

  it("returns 409 managed_by_idp instead of silently deleting an OIDC-managed assignment on an implicit switch", async () => {
    // Same guard the explicit DELETE .../roles/:assignmentId revoke already enforces
    // (managed_by_idp), applied to the implicit revoke a role-type switch performs - otherwise
    // granting an unrelated new role type is a back door around that guard.
    const created = await prisma.user.create({
      data: { email: "oidc-role-switch@example.com", password_hash: await hashPassword(PASSWORD) },
    });
    const oldAssignment = await prisma.roleAssignment.create({
      data: { user_id: created.id, role: "operator", scope_type: "event", scope_id: eventId },
    });
    await prisma.oidcRoleGrant.create({
      data: {
        user_id: created.id,
        provider_id: PROVIDER_ID,
        role: "operator",
        scope_type: "event",
        scope_id: eventId,
        role_assignment_id: oldAssignment.id,
      },
    });

    try {
      const res = await app.request(`/api/admin/users/${created.id}/roles`, {
        method: "POST",
        headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ role: "admin", scope_type: "organization", scope_id: ORG_USERS }),
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("managed_by_idp");

      const stillThere = await prisma.roleAssignment.findUnique({ where: { id: oldAssignment.id } });
      expect(stillThere).toBeTruthy();
    } finally {
      await prisma.oidcRoleGrant.deleteMany({ where: { user_id: created.id } });
      await prisma.roleAssignment.deleteMany({ where: { user_id: created.id } });
      await prisma.user.deleteMany({ where: { id: created.id } });
    }
  });

  it("adds another scope without removing existing ones when the role type is unchanged", async () => {
    const created = await prisma.user.create({
      data: { email: "role-add-scope@example.com", password_hash: await hashPassword(PASSWORD) },
    });
    await prisma.roleAssignment.create({
      data: { user_id: created.id, role: "admin", scope_type: "organization", scope_id: ORG_USERS },
    });

    const secondOrg = await prisma.organization.create({
      data: { name: "Second Org", slug: "second-org-role-test" },
    });

    try {
      const res = await app.request(`/api/admin/users/${created.id}/roles`, {
        method: "POST",
        headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ role: "admin", scope_type: "organization", scope_id: secondOrg.id }),
      });
      expect(res.status).toBe(201);

      const remaining = await prisma.roleAssignment.findMany({ where: { user_id: created.id } });
      expect(remaining).toHaveLength(2);
    } finally {
      await prisma.roleAssignment.deleteMany({ where: { user_id: created.id } });
      await prisma.user.deleteMany({ where: { id: created.id } });
      await prisma.organization.deleteMany({ where: { id: secondOrg.id } });
    }
  });

  it("returns 409 cannot_change_own_role when a superadmin tries to change their own role type", async () => {
    const res = await app.request(`/api/admin/users/${superId}/roles`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ role: "admin", scope_type: "organization", scope_id: ORG_USERS }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("cannot_change_own_role");

    const stillSuperadmin = await prisma.roleAssignment.findFirst({
      where: { user_id: superId, role: "superadmin", scope_type: "instance" },
    });
    expect(stillSuperadmin).toBeTruthy();
  });

  // No "last_superadmin via role switch" test here, deliberately: only a superadmin can grant or
  // revoke a superadmin-scoped assignment (assertRoleGrantAllowed, and now assertRoleRevokeAllowed
  // below), so reaching that guard with exactly one global superadmin means the acting superadmin
  // *is* the target - the same structural argument as the DELETE .../roles/:assignmentId
  // anti-lockout suite above. That case is caught earlier, by cannot_change_own_role.

  it("returns 403 instead of silently replacing a target's unrelated admin/superadmin assignment", async () => {
    // A role-type switch implicitly revokes the target's OLD-type assignment(s) -
    // assertRoleGrantAllowed only authorizes the NEW grant, so this must independently confirm
    // the actor is also allowed to revoke whatever it's about to replace. Without that check, an
    // org-scoped admin's own event-grant authority (legitimate on its own) could silently strip
    // a target's admin role over a completely different, unrelated organization.
    const otherOrg = await prisma.organization.create({
      data: { name: "Unrelated Org", slug: "unrelated-org-role-test" },
    });
    const created = await prisma.user.create({
      data: { email: "cross-org-role-switch@example.com", password_hash: await hashPassword(PASSWORD) },
    });
    const otherOrgAssignment = await prisma.roleAssignment.create({
      data: { user_id: created.id, role: "admin", scope_type: "organization", scope_id: otherOrg.id },
    });

    try {
      // adminCookie is only ever authorized over ORG_USERS/eventId - it has no relationship to
      // otherOrg or the target's admin assignment there.
      const res = await app.request(`/api/admin/users/${created.id}/roles`, {
        method: "POST",
        headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ role: "operator", scope_type: "event", scope_id: eventId }),
      });
      expect(res.status).toBe(403);

      const remaining = await prisma.roleAssignment.findMany({ where: { user_id: created.id } });
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.id).toBe(otherOrgAssignment.id);
      expect(remaining[0]?.role).toBe("admin");
    } finally {
      await prisma.roleAssignment.deleteMany({ where: { user_id: created.id } });
      await prisma.user.deleteMany({ where: { id: created.id } });
      await prisma.organization.deleteMany({ where: { id: otherOrg.id } });
    }
  });
});

describe("DELETE /api/admin/users/:id/external-identity", () => {
  it("unlinks SSO for another user and sets the new password in the same request", async () => {
    const created = await prisma.user.create({
      data: { email: "sso-unlink@example.com", password_hash: await hashPassword(PASSWORD) },
    });
    await prisma.externalIdentity.create({
      data: { provider_id: PROVIDER_ID, subject: "sso-unlink-subject", user_id: created.id },
    });
    const session = await createSession(prisma, { userId: created.id, stage: SESSION_STAGE.FULL });

    try {
      const res = await app.request(`/api/admin/users/${created.id}/external-identity`, {
        method: "DELETE",
        headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ new_password: NEW_PASSWORD }),
      });
      expect(res.status).toBe(200);

      const linked = await prisma.externalIdentity.findMany({ where: { user_id: created.id } });
      expect(linked).toHaveLength(0);

      const user = await prisma.user.findUnique({ where: { id: created.id } });
      expect(user?.must_change_password).toBe(true);
      expect(await verifyPassword(NEW_PASSWORD, user!.password_hash!)).toBe(true);

      const revoked = await prisma.session.findUnique({ where: { id: session.session.id } });
      expect(revoked?.revoked_at).not.toBeNull();
    } finally {
      await prisma.externalIdentity.deleteMany({ where: { user_id: created.id } });
      await prisma.session.deleteMany({ where: { user_id: created.id } });
      await prisma.user.deleteMany({ where: { id: created.id } });
    }
  });

  it("clears OIDC-owned role grants (converting retained roles to manual ownership) when unlinking SSO", async () => {
    const created = await prisma.user.create({
      data: { email: "sso-unlink-oidc-role@example.com", password_hash: await hashPassword(PASSWORD) },
    });
    await prisma.externalIdentity.create({
      data: { provider_id: PROVIDER_ID, subject: "sso-unlink-oidc-role-subject", user_id: created.id },
    });
    const assignment = await prisma.roleAssignment.create({
      data: { user_id: created.id, role: "operator", scope_type: "event", scope_id: eventId },
    });
    await prisma.oidcRoleGrant.create({
      data: {
        user_id: created.id,
        provider_id: PROVIDER_ID,
        role: "operator",
        scope_type: "event",
        scope_id: eventId,
        role_assignment_id: assignment.id,
      },
    });

    try {
      const res = await app.request(`/api/admin/users/${created.id}/external-identity`, {
        method: "DELETE",
        headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ new_password: NEW_PASSWORD }),
      });
      expect(res.status).toBe(200);

      expect(await prisma.oidcRoleGrant.count({ where: { user_id: created.id } })).toBe(0);
      const remaining = await prisma.roleAssignment.findUnique({ where: { id: assignment.id } });
      expect(remaining).not.toBeNull();
      expect(remaining?.role).toBe("operator");
    } finally {
      await prisma.oidcRoleGrant.deleteMany({ where: { user_id: created.id } });
      await prisma.roleAssignment.deleteMany({ where: { user_id: created.id } });
      await prisma.externalIdentity.deleteMany({ where: { user_id: created.id } });
      await prisma.session.deleteMany({ where: { user_id: created.id } });
      await prisma.user.deleteMany({ where: { id: created.id } });
    }
  });

  it("returns 400 invalid_request when unlinking without a new password", async () => {
    const created = await prisma.user.create({
      data: { email: "sso-unlink-no-pass@example.com", password_hash: await hashPassword(PASSWORD) },
    });
    await prisma.externalIdentity.create({
      data: { provider_id: PROVIDER_ID, subject: "sso-unlink-no-pass-subject", user_id: created.id },
    });

    try {
      const res = await app.request(`/api/admin/users/${created.id}/external-identity`, {
        method: "DELETE",
        headers: { Cookie: superCookie, ...sameOrigin },
      });
      expect(res.status).toBe(400);

      const linked = await prisma.externalIdentity.findMany({ where: { user_id: created.id } });
      expect(linked).toHaveLength(1);
    } finally {
      await prisma.externalIdentity.deleteMany({ where: { user_id: created.id } });
      await prisma.user.deleteMany({ where: { id: created.id } });
    }
  });

  it("returns 409 cannot_unlink_own_sso for your own account", async () => {
    const res = await app.request(`/api/admin/users/${superId}/external-identity`, {
      method: "DELETE",
      headers: { Cookie: superCookie, ...sameOrigin },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("cannot_unlink_own_sso");
  });

  it("returns 404 for a user with no linked SSO identity", async () => {
    const res = await app.request(`/api/admin/users/${targetId}/external-identity`, {
      method: "DELETE",
      headers: { Cookie: superCookie, ...sameOrigin },
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 for a user id that doesn't exist at all", async () => {
    const res = await app.request("/api/admin/users/nonexistent-user-id/external-identity", {
      method: "DELETE",
      headers: { Cookie: superCookie, ...sameOrigin },
    });
    expect(res.status).toBe(404);
  });

  it("returns 400 password_too_common for a blocklisted new password", async () => {
    const created = await prisma.user.create({
      data: { email: "sso-unlink-common-pass@example.com", password_hash: await hashPassword(PASSWORD) },
    });
    await prisma.externalIdentity.create({
      data: { provider_id: PROVIDER_ID, subject: "sso-unlink-common-pass-subject", user_id: created.id },
    });

    try {
      const res = await app.request(`/api/admin/users/${created.id}/external-identity`, {
        method: "DELETE",
        headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ new_password: "aaaaaaaaaaaa" }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("password_too_common");

      const linked = await prisma.externalIdentity.findMany({ where: { user_id: created.id } });
      expect(linked).toHaveLength(1);
    } finally {
      await prisma.externalIdentity.deleteMany({ where: { user_id: created.id } });
      await prisma.user.deleteMany({ where: { id: created.id } });
    }
  });

  it("returns 403 for a non-superadmin", async () => {
    const res = await app.request(`/api/admin/users/${targetId}/external-identity`, {
      method: "DELETE",
      headers: { Cookie: adminCookie, ...sameOrigin },
    });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/admin/users functional", () => {
  it("creates user without auto role assignment", async () => {
    const email = "created-user@example.com";
    const res = await app.request("/api/admin/users", {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "created-pass-1", must_change_password: true }),
    });
    expect(res.status).toBe(201);

    const row = await prisma.user.findUnique({ where: { email } });
    expect(row).not.toBeNull();
    expect(row?.must_change_password).toBe(true);
    const roles = await prisma.roleAssignment.count({ where: { user_id: row!.id } });
    expect(roles).toBe(0);

    const audit = await prisma.adminAuditLog.findFirst({
      where: { organization_id: ORG_USERS, action_type: "user_created" },
      orderBy: { created_at: "desc" },
    });
    expect(audit?.metadata).toMatchObject({ userId: row!.id, email });

    await prisma.user.delete({ where: { email } });
  });

  it("saves an optional phone number given at creation", async () => {
    const email = "created-user-phone@example.com";
    try {
      const res = await app.request("/api/admin/users", {
        method: "POST",
        headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password: "created-pass-1",
          phone_country_code: "+48",
          phone_number: "500100200",
        }),
      });
      expect(res.status).toBe(201);

      const row = await prisma.user.findUnique({ where: { email } });
      expect(row?.phone_country_code).toBe("+48");
      expect(row?.phone_number).toBe("500100200");
    } finally {
      await prisma.user.deleteMany({ where: { email } });
    }
  });

  it("leaves phone fields unset when given as blank strings at creation", async () => {
    const email = "created-user-blank-phone@example.com";
    try {
      const res = await app.request("/api/admin/users", {
        method: "POST",
        headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password: "created-pass-1",
          phone_country_code: "",
          phone_number: "",
        }),
      });
      expect(res.status).toBe(201);

      const row = await prisma.user.findUnique({ where: { email } });
      expect(row?.phone_country_code).toBeNull();
      expect(row?.phone_number).toBeNull();
    } finally {
      await prisma.user.deleteMany({ where: { email } });
    }
  });

  it("returns 400 invalid_email for a malformed email", async () => {
    const res = await app.request("/api/admin/users", {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ email: "not-an-email", password: "created-pass-1" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invalid_email");

    const row = await prisma.user.findUnique({ where: { email: "not-an-email" } });
    expect(row).toBeNull();
  });

  it("returns 409 email_conflict for duplicate email", async () => {
    const res = await app.request("/api/admin/users", {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ email: EMAIL_TARGET, password: "duplicate-pass-1" }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; error: string };
    expect(body.code).toBe("email_conflict");
    expect(body.error).toBe("email_taken");
  });

  it("returns 400 password_too_common for a blocklisted password", async () => {
    const res = await app.request("/api/admin/users", {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ email: "blocked-user@example.com", password: "aaaaaaaaaaaa" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("password_too_common");
  });
});

describe("POST /api/admin/users/:id/revoke-sessions", () => {
  it("preserves last_login_at while clearing active session count", async () => {
    await createSession(prisma, { userId: targetId, stage: SESSION_STAGE.FULL });

    // Scoped with ?q= to this test's own user - the list endpoint is paginated (25/page, sorted
    // by email) across the whole shared test database, so an unscoped request can silently return
    // a page that doesn't include targetId depending on how many other users other test files
    // have created by the time this one runs.
    const listBefore = await app.request(
      `/api/admin/users?q=${encodeURIComponent(EMAIL_TARGET)}`,
      { headers: { Cookie: superCookie } },
    );
    const beforeBody = (await listBefore.json()) as {
      users: Array<{ id: string; last_login_at: string | null; active_sessions_count: number }>;
    };
    const targetBefore = beforeBody.users.find((u) => u.id === targetId);
    expect(targetBefore?.last_login_at).not.toBeNull();
    expect(targetBefore?.active_sessions_count).toBeGreaterThan(0);

    const revokeRes = await app.request(`/api/admin/users/${targetId}/revoke-sessions`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin },
    });
    expect(revokeRes.status).toBe(200);

    const listAfter = await app.request(
      `/api/admin/users?q=${encodeURIComponent(EMAIL_TARGET)}`,
      { headers: { Cookie: superCookie } },
    );
    const afterBody = (await listAfter.json()) as {
      users: Array<{ id: string; last_login_at: string | null; active_sessions_count: number }>;
    };
    const targetAfter = afterBody.users.find((u) => u.id === targetId);
    expect(targetAfter?.last_login_at).toBe(targetBefore?.last_login_at);
    expect(targetAfter?.active_sessions_count).toBe(0);
  });
});

describe("POST /api/admin/users/:id/reset-2fa", () => {
  it("clears MFA methods for target user", async () => {
    const res = await app.request(`/api/admin/users/${targetId}/reset-2fa`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin },
    });
    expect(res.status).toBe(200);
    expect(await prisma.userMfaMethod.count({ where: { user_id: targetId } })).toBe(0);
  });

  it("returns 403 for a non-superadmin", async () => {
    const res = await app.request(`/api/admin/users/${targetId}/reset-2fa`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin },
    });
    expect(res.status).toBe(403);
  });

  it("returns 404 for a user id that doesn't exist", async () => {
    const res = await app.request("/api/admin/users/nonexistent-user-id/reset-2fa", {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin },
    });
    expect(res.status).toBe(404);
  });

  it("returns 409 cannot_reset_mfa_sso_managed and leaves MFA methods untouched for an SSO-managed account", async () => {
    const created = await prisma.user.create({
      data: { email: "sso-reset-mfa@example.com", password_hash: await hashPassword(PASSWORD) },
    });
    await prisma.externalIdentity.create({
      data: { provider_id: PROVIDER_ID, subject: "sso-reset-mfa-subject", user_id: created.id },
    });
    await prisma.userMfaMethod.create({
      data: { user_id: created.id, type: "totp", secret_enc: "enc", confirmed_at: new Date() },
    });

    try {
      const res = await app.request(`/api/admin/users/${created.id}/reset-2fa`, {
        method: "POST",
        headers: { Cookie: superCookie, ...sameOrigin },
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("cannot_reset_mfa_sso_managed");
      expect(await prisma.userMfaMethod.count({ where: { user_id: created.id } })).toBe(1);
    } finally {
      await prisma.userMfaMethod.deleteMany({ where: { user_id: created.id } });
      await prisma.externalIdentity.deleteMany({ where: { user_id: created.id } });
      await prisma.user.deleteMany({ where: { id: created.id } });
    }
  });
});

describe("POST /api/admin/users/:id/reset-password", () => {
  it("updates hash, sets must_change_password, revokes sessions", async () => {
    const session = await createSession(prisma, { userId: targetId, stage: SESSION_STAGE.FULL });

    const res = await app.request(`/api/admin/users/${targetId}/reset-password`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ new_password: NEW_PASSWORD }),
    });
    expect(res.status).toBe(200);

    const user = await prisma.user.findUnique({ where: { id: targetId } });
    expect(user?.must_change_password).toBe(true);
    expect(user?.password_hash).toBeTruthy();
    expect(await verifyPassword(NEW_PASSWORD, user!.password_hash!)).toBe(true);

    const revoked = await prisma.session.findUnique({ where: { id: session.session.id } });
    expect(revoked?.revoked_at).not.toBeNull();
  });

  it("returns 400 password_too_common for a blocklisted password", async () => {
    const res = await app.request(`/api/admin/users/${targetId}/reset-password`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ new_password: "aaaaaaaaaaaa" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("password_too_common");
  });

  it("returns 409 cannot_reset_password_sso_managed and leaves the hash untouched for an SSO-managed account", async () => {
    const created = await prisma.user.create({
      data: { email: "sso-reset-password@example.com", password_hash: null },
    });
    await prisma.externalIdentity.create({
      data: { provider_id: PROVIDER_ID, subject: "sso-reset-password-subject", user_id: created.id },
    });

    try {
      const res = await app.request(`/api/admin/users/${created.id}/reset-password`, {
        method: "POST",
        headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ new_password: NEW_PASSWORD }),
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("cannot_reset_password_sso_managed");

      const user = await prisma.user.findUnique({ where: { id: created.id } });
      expect(user?.password_hash).toBeNull();
      expect(user?.must_change_password).toBe(false);
    } finally {
      await prisma.externalIdentity.deleteMany({ where: { user_id: created.id } });
      await prisma.user.deleteMany({ where: { id: created.id } });
    }
  });
});

describe("POST /api/admin/users/:id/reset-2fa and reset-password — superadmin-on-superadmin step-up", () => {
  const SUPER_TARGET_EMAIL = "users-super-target@example.com";
  let superTargetId = "";
  let actorSecret: string;

  beforeEach(async () => {
    rateLimitStore.reset();
    // Replace superId's seeded (random, untracked-secret) confirmed TOTP with one whose secret
    // this block controls, so it can generate a valid step-up code for the acting superadmin.
    actorSecret = generateTotpSecret();
    await prisma.userMfaMethod.deleteMany({ where: { user_id: superId } });
    await prisma.userMfaMethod.create({
      data: { user_id: superId, type: "totp", secret_enc: encryptTotpSecret(actorSecret), confirmed_at: new Date() },
    });

    const created = await prisma.user.create({
      data: { email: SUPER_TARGET_EMAIL, password_hash: await hashPassword(PASSWORD) },
    });
    superTargetId = created.id;
    await prisma.roleAssignment.create({
      data: { user_id: superTargetId, role: "superadmin", scope_type: "instance", scope_id: null },
    });
    await prisma.userMfaMethod.create({
      data: {
        user_id: superTargetId,
        type: "totp",
        secret_enc: encryptTotpSecret(generateTotpSecret()),
        confirmed_at: new Date(),
      },
    });
  });

  afterEach(async () => {
    await prisma.session.deleteMany({ where: { user_id: superTargetId } });
    await prisma.roleAssignment.deleteMany({ where: { user_id: superTargetId } });
    await prisma.userMfaMethod.deleteMany({ where: { user_id: superTargetId } });
    await prisma.user.deleteMany({ where: { id: superTargetId } });
    // Restore superId's MFA method to a fresh random-secret fixture, matching what the rest of
    // this file (and its own top-level afterEach) assumes: superId always has *a* confirmed
    // TOTP method, just not one whose secret is known outside this describe block.
    await prisma.userMfaMethod.deleteMany({ where: { user_id: superId } });
    await prisma.userMfaMethod.create({
      data: { user_id: superId, type: "totp", secret_enc: encryptTotpSecret(generateTotpSecret()), confirmed_at: new Date() },
    });
  });

  it("reset-2fa: returns 400 totp_required without a step-up code and leaves the target's MFA untouched", async () => {
    const res = await app.request(`/api/admin/users/${superTargetId}/reset-2fa`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("totp_required");
    expect(await prisma.userMfaMethod.count({ where: { user_id: superTargetId } })).toBeGreaterThan(0);
  });

  it("reset-2fa: returns 401 invalid_totp for a wrong step-up code and leaves the target's MFA untouched", async () => {
    const res = await app.request(`/api/admin/users/${superTargetId}/reset-2fa`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ code: "000000" }),
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe("invalid_totp");
    expect(await prisma.userMfaMethod.count({ where: { user_id: superTargetId } })).toBeGreaterThan(0);
  });

  it("reset-2fa: succeeds with a correct step-up code and flags the audit log as a superadmin-target reset", async () => {
    const res = await app.request(`/api/admin/users/${superTargetId}/reset-2fa`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ code: generateTotpCode(actorSecret) }),
    });
    expect(res.status).toBe(200);
    expect(await prisma.userMfaMethod.count({ where: { user_id: superTargetId } })).toBe(0);

    const audit = await prisma.adminAuditLog.findFirst({
      where: { organization_id: ORG_USERS, action_type: "user_mfa_reset", actor_user_id: superId },
      orderBy: { created_at: "desc" },
    });
    expect(audit?.metadata).toMatchObject({ userId: superTargetId, superadminTarget: true });
  });

  it("reset-password: returns 400 totp_required without a step-up code and leaves the target's password untouched", async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: superTargetId } });
    const res = await app.request(`/api/admin/users/${superTargetId}/reset-password`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ new_password: NEW_PASSWORD }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("totp_required");
    const after = await prisma.user.findUniqueOrThrow({ where: { id: superTargetId } });
    expect(after.password_hash).toBe(before.password_hash);
  });

  it("reset-password: returns 401 invalid_totp for a wrong step-up code and leaves the target's password untouched", async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: superTargetId } });
    const res = await app.request(`/api/admin/users/${superTargetId}/reset-password`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ new_password: NEW_PASSWORD, code: "000000" }),
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe("invalid_totp");
    const after = await prisma.user.findUniqueOrThrow({ where: { id: superTargetId } });
    expect(after.password_hash).toBe(before.password_hash);
  });

  it("reset-password: succeeds with a correct step-up code and flags the audit log as a superadmin-target reset", async () => {
    const res = await app.request(`/api/admin/users/${superTargetId}/reset-password`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ new_password: NEW_PASSWORD, code: generateTotpCode(actorSecret) }),
    });
    expect(res.status).toBe(200);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: superTargetId } });
    expect(await verifyPassword(NEW_PASSWORD, after.password_hash!)).toBe(true);

    const audit = await prisma.adminAuditLog.findFirst({
      where: { organization_id: ORG_USERS, action_type: "user_password_reset", actor_user_id: superId },
      orderBy: { created_at: "desc" },
    });
    expect(audit?.metadata).toMatchObject({ userId: superTargetId, superadminTarget: true });
  });

  it("reset-2fa: returns 403 actor_mfa_required (not a silent skip) when the actor has no confirmed local TOTP, and leaves the target's MFA untouched", async () => {
    // Simulates a superadmin role granted purely through OIDC group mapping, who has never
    // enrolled a local TOTP method. A LOCAL session for such a user would already be rejected
    // by validateSession's assertFullSessionMfaPolicy (packages/auth/src/session.ts) - but an
    // OIDC session is exempt from that check entirely (auth_method === AUTH_METHOD.OIDC always
    // returns true there), so this actor reaches a fully-privileged SESSION_STAGE.FULL session
    // with nothing to step up with, exactly the gap actorMustStepUpForReset must fail closed on.
    await prisma.userMfaMethod.deleteMany({ where: { user_id: superId } });
    const oidcActorSession = await createSession(prisma, {
      userId: superId,
      stage: SESSION_STAGE.FULL,
      authMethod: AUTH_METHOD.OIDC,
    });
    const oidcActorCookie = `admitto_session=${oidcActorSession.rawToken}`;

    const res = await app.request(`/api/admin/users/${superTargetId}/reset-2fa`, {
      method: "POST",
      headers: { Cookie: oidcActorCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("actor_mfa_required");
    expect(await prisma.userMfaMethod.count({ where: { user_id: superTargetId } })).toBeGreaterThan(0);
  });

  it("reset-password: returns 403 actor_mfa_required (not a silent skip) when the actor has no confirmed local TOTP, and leaves the target's password untouched", async () => {
    await prisma.userMfaMethod.deleteMany({ where: { user_id: superId } });
    const oidcActorSession = await createSession(prisma, {
      userId: superId,
      stage: SESSION_STAGE.FULL,
      authMethod: AUTH_METHOD.OIDC,
    });
    const oidcActorCookie = `admitto_session=${oidcActorSession.rawToken}`;
    const before = await prisma.user.findUniqueOrThrow({ where: { id: superTargetId } });

    const res = await app.request(`/api/admin/users/${superTargetId}/reset-password`, {
      method: "POST",
      headers: { Cookie: oidcActorCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ new_password: NEW_PASSWORD }),
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("actor_mfa_required");
    const after = await prisma.user.findUniqueOrThrow({ where: { id: superTargetId } });
    expect(after.password_hash).toBe(before.password_hash);
  });

  it("reset-2fa: still demands and validates the actor's code even when the instance's mfa_required_roles setting excludes superadmin", async () => {
    // withStepUpGate's own default behavior re-derives "is step-up needed" via
    // userRequiresMfaStepUp (userRequiresMfa && userHasConfirmedTotp) - userRequiresMfa alone
    // depends on this configurable policy, so without runAdminResetWithActorStepUp's
    // forceRequired: true, an instance that scoped mfa_required_roles down to just "admin" would
    // make this whole check silently no-op for a superadmin actor, even one with confirmed TOTP.
    await prisma.systemSettings.upsert({
      where: { key: "mfa_required_roles" },
      create: { key: "mfa_required_roles", value_json: JSON.stringify(["admin"]) },
      update: { value_json: JSON.stringify(["admin"]) },
    });
    try {
      const noCode = await app.request(`/api/admin/users/${superTargetId}/reset-2fa`, {
        method: "POST",
        headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(noCode.status).toBe(400);
      expect(((await noCode.json()) as { code: string }).code).toBe("totp_required");
      expect(await prisma.userMfaMethod.count({ where: { user_id: superTargetId } })).toBeGreaterThan(0);

      const withCode = await app.request(`/api/admin/users/${superTargetId}/reset-2fa`, {
        method: "POST",
        headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ code: generateTotpCode(actorSecret) }),
      });
      expect(withCode.status).toBe(200);
      expect(await prisma.userMfaMethod.count({ where: { user_id: superTargetId } })).toBe(0);
    } finally {
      await prisma.systemSettings.deleteMany({ where: { key: "mfa_required_roles" } });
    }
  });

  it("does not require step-up when a superadmin resets their OWN MFA via the admin endpoint", async () => {
    // resetUserMfa revokes every session for the target, with no "except current" exemption
    // (unlike the self-service /api/account/mfa/reset flow) - since actor === target here, that
    // includes whichever session made this very request. Use a throwaway session so the
    // file-wide superCookie/superSessionId fixture other describe blocks depend on isn't left
    // pointing at a revoked session afterward.
    const tempSession = await createSession(prisma, { userId: superId, stage: SESSION_STAGE.FULL });
    const res = await app.request(`/api/admin/users/${superId}/reset-2fa`, {
      method: "POST",
      headers: { Cookie: `admitto_session=${tempSession.rawToken}`, ...sameOrigin },
    });
    expect(res.status).toBe(200);
    expect(await prisma.userMfaMethod.count({ where: { user_id: superId } })).toBe(0);

    const audit = await prisma.adminAuditLog.findFirst({
      where: { organization_id: ORG_USERS, action_type: "user_mfa_reset", actor_user_id: superId },
      orderBy: { created_at: "desc" },
    });
    expect(audit?.metadata).not.toHaveProperty("superadminTarget");

    // The reset above revoked superSessionId too (same user, no exemption) - replace the shared
    // fixture so every test after this one keeps a working superadmin session.
    const fresh = await createSession(prisma, { userId: superId, stage: SESSION_STAGE.FULL });
    superCookie = `admitto_session=${fresh.rawToken}`;
    superSessionId = fresh.session.id;
  });

  it("does not require step-up when resetting a non-superadmin target, even though the actor is a superadmin", async () => {
    const res = await app.request(`/api/admin/users/${targetId}/reset-2fa`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin },
    });
    expect(res.status).toBe(200);
  });
});

describe("POST /api/admin/users/:id/reset-2fa and reset-password — SSO-link TOCTOU", () => {
  afterEach(() => {
    onExternalIdentityFindFirst = null;
  });

  it("reset-2fa: an SSO link created after the pre-check still blocks the in-transaction write", async () => {
    const created = await prisma.user.create({
      data: { email: "toctou-reset-mfa@example.com", password_hash: await hashPassword(PASSWORD) },
    });
    await prisma.userMfaMethod.create({
      data: { user_id: created.id, type: "totp", secret_enc: "enc", confirmed_at: new Date() },
    });

    try {
      let armed = true;
      onExternalIdentityFindFirst = async () => {
        armed = false;
        await prisma.externalIdentity.create({
          data: { provider_id: PROVIDER_ID, subject: "toctou-reset-mfa-subject", user_id: created.id },
        });
      };

      const res = await app.request(`/api/admin/users/${created.id}/reset-2fa`, {
        method: "POST",
        headers: { Cookie: superCookie, ...sameOrigin },
      });

      expect(armed).toBe(false); // sanity check: the injected concurrent link actually ran
      expect(res.status).toBe(409);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("cannot_reset_mfa_sso_managed");
      expect(await prisma.userMfaMethod.count({ where: { user_id: created.id } })).toBe(1);
    } finally {
      await prisma.userMfaMethod.deleteMany({ where: { user_id: created.id } });
      await prisma.externalIdentity.deleteMany({ where: { user_id: created.id } });
      await prisma.user.deleteMany({ where: { id: created.id } });
    }
  });

  it("reset-password: an SSO link created after the pre-check still blocks the in-transaction write", async () => {
    const created = await prisma.user.create({
      data: { email: "toctou-reset-password@example.com", password_hash: await hashPassword(PASSWORD) },
    });
    const before = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });

    try {
      let armed = true;
      onExternalIdentityFindFirst = async () => {
        armed = false;
        await prisma.externalIdentity.create({
          data: { provider_id: PROVIDER_ID, subject: "toctou-reset-password-subject", user_id: created.id },
        });
      };

      const res = await app.request(`/api/admin/users/${created.id}/reset-password`, {
        method: "POST",
        headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ new_password: NEW_PASSWORD }),
      });

      expect(armed).toBe(false); // sanity check: the injected concurrent link actually ran
      expect(res.status).toBe(409);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("cannot_reset_password_sso_managed");
      const after = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
      expect(after.password_hash).toBe(before.password_hash);
    } finally {
      await prisma.externalIdentity.deleteMany({ where: { user_id: created.id } });
      await prisma.user.deleteMany({ where: { id: created.id } });
    }
  });
});

describe("staff-accountability System logs", () => {
  it("records account and role actions with verified actor and target email only", async () => {
    resetSystemLogBufferForTest();
    const createdEmail = "system-log-created-staff@example.com";
    let createdId = "";

    try {
      const create = await app.request("/api/admin/users", {
        method: "POST",
        headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ email: createdEmail, password: "created-staff-pass-1" }),
      });
      expect(create.status).toBe(201);
      const createBody = (await create.json()) as { user: { id: string } };
      createdId = createBody.user.id;

      const grant = await app.request(`/api/admin/users/${createdId}/roles`, {
        method: "POST",
        headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ role: "operator", scope_type: "event", scope_id: eventId }),
      });
      expect(grant.status).toBe(201);
      const grantBody = (await grant.json()) as { assignment: { id: string } };

      const revoke = await app.request(
        `/api/admin/users/${createdId}/roles/${grantBody.assignment.id}`,
        { method: "DELETE", headers: { Cookie: superCookie, ...sameOrigin } },
      );
      expect(revoke.status).toBe(204);

      const mfa = await app.request(`/api/admin/users/${targetId}/reset-2fa`, {
        method: "POST",
        headers: { Cookie: superCookie, ...sameOrigin },
      });
      expect(mfa.status).toBe(200);

      const password = await app.request(`/api/admin/users/${targetId}/reset-password`, {
        method: "POST",
        headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ new_password: NEW_PASSWORD }),
      });
      expect(password.status).toBe(200);

      const deactivate = await app.request(`/api/admin/users/${targetId}`, {
        method: "PATCH",
        headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: false }),
      });
      expect(deactivate.status).toBe(200);

      const reactivate = await app.request(`/api/admin/users/${targetId}`, {
        method: "PATCH",
        headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: true }),
      });
      expect(reactivate.status).toBe(200);

      const sessions = await app.request(`/api/admin/users/${targetId}/revoke-sessions`, {
        method: "POST",
        headers: { Cookie: superCookie, ...sameOrigin },
      });
      expect(sessions.status).toBe(200);

      const byMessage = new Map(querySystemLogs().map((entry) => [entry.message, entry]));
      expect(byMessage.get("user_created")).toMatchObject({
        level: "info",
        source: "security",
        fields: {
          targetUserId: createdId,
          targetEmail: createdEmail,
          actorUserId: superId,
          actorEmail: EMAIL_SUPER,
        },
      });
      expect(byMessage.get("role_granted")).toMatchObject({
        fields: { targetUserId: createdId, targetEmail: createdEmail, role: "operator" },
      });
      expect(byMessage.get("role_revoked")).toMatchObject({
        fields: { targetUserId: createdId, targetEmail: createdEmail, role: "operator" },
      });
      for (const message of [
        "user_mfa_reset",
        "user_password_reset",
        "user_deactivated",
        "user_reactivated",
        "user_sessions_revoked",
      ]) {
        expect(byMessage.get(message)).toMatchObject({
          level: "info",
          source: "security",
          fields: {
            targetUserId: targetId,
            targetEmail: EMAIL_TARGET,
            actorUserId: superId,
            actorEmail: EMAIL_SUPER,
          },
        });
      }
      expect(JSON.stringify([...byMessage.values()])).not.toContain(NEW_PASSWORD);
    } finally {
      if (createdId) {
        await prisma.roleAssignment.deleteMany({ where: { user_id: createdId } });
        await prisma.user.deleteMany({ where: { id: createdId } });
      }
      await prisma.user.update({
        where: { id: targetId },
        data: { password_hash: await hashPassword(PASSWORD), must_change_password: false, is_active: true },
      });
    }
  });
});

describe("PATCH /api/admin/users/:id deactivate", () => {
  it("sets inactive and revokes sessions", async () => {
    const session = await createSession(prisma, { userId: targetId, stage: SESSION_STAGE.FULL });

    const res = await app.request(`/api/admin/users/${targetId}`, {
      method: "PATCH",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: false }),
    });
    expect(res.status).toBe(200);

    const user = await prisma.user.findUnique({ where: { id: targetId } });
    expect(user?.is_active).toBe(false);

    const revoked = await prisma.session.findUnique({ where: { id: session.session.id } });
    expect(revoked?.revoked_at).not.toBeNull();
  });
});

describe("POST /api/admin/users/:id/roles separation of duties", () => {
  it("allows admin to grant operator on own org event", async () => {
    const email = "op-grant@example.com";
    const created = await prisma.user.create({
      data: { email, password_hash: await hashPassword(PASSWORD) },
    });

    const res = await app.request(`/api/admin/users/${created.id}/roles`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ role: "operator", scope_type: "event", scope_id: eventId }),
    });
    expect(res.status).toBe(201);

    await prisma.roleAssignment.deleteMany({ where: { user_id: created.id } });
    await prisma.user.delete({ where: { id: created.id } });
  });

  it("forbids admin from granting admin role", async () => {
    const res = await app.request(`/api/admin/users/${targetId}/roles`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        role: "admin",
        scope_type: "organization",
        scope_id: ORG_USERS,
      }),
    });
    expect(res.status).toBe(403);
  });
});

describe("must_change_password migration", () => {
  it("column exists with default false for existing users", async () => {
    const user = await prisma.user.findUnique({ where: { id: superId } });
    expect(user?.must_change_password).toBe(false);
  });
});

describe("GET /change-password", () => {
  it("redirects away when must_change_password is false", async () => {
    const res = await app.request("/change-password", {
      headers: { Cookie: superCookie },
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).not.toBe("/change-password");
  });

  it("renders form when must_change_password is true", async () => {
    await prisma.user.update({
      where: { id: superId },
      data: { must_change_password: true },
    });

    const forcedSession = await createSession(prisma, {
      userId: superId,
      stage: SESSION_STAGE.CHANGE_PASSWORD_REQUIRED,
      ip: "127.0.0.6",
    });

    const res = await app.request("/change-password", {
      headers: { Cookie: `admitto_session=${forcedSession.rawToken}` },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Change password");

    await prisma.user.update({
      where: { id: superId },
      data: { must_change_password: false },
    });
    await prisma.session.update({
      where: { id: forcedSession.session.id },
      data: { revoked_at: new Date() },
    });
  });
});

describe("POST /change-password", () => {
  it("updates password atomically, clears flag, and revokes other sessions", async () => {
    await prisma.user.update({
      where: { id: targetId },
      data: { must_change_password: true },
    });

    const keepSession = await createSession(prisma, {
      userId: targetId,
      stage: SESSION_STAGE.CHANGE_PASSWORD_REQUIRED,
      ip: "127.0.0.4",
    });
    const otherSession = await createSession(prisma, {
      userId: targetId,
      stage: SESSION_STAGE.FULL,
      ip: "127.0.0.5",
    });

    const res = await app.request("/change-password", {
      method: "POST",
      headers: {
        Cookie: `admitto_session=${keepSession.rawToken}`,
        ...sameOrigin,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        password: NEW_PASSWORD,
        password_confirm: NEW_PASSWORD,
      }).toString(),
    });
    expect(res.status).toBe(302);

    const user = await prisma.user.findUnique({ where: { id: targetId } });
    expect(user?.must_change_password).toBe(false);
    expect(await verifyPassword(NEW_PASSWORD, user!.password_hash!)).toBe(true);

    const kept = await prisma.session.findUnique({ where: { id: keepSession.session.id } });
    const other = await prisma.session.findUnique({ where: { id: otherSession.session.id } });
    expect(kept?.revoked_at).toBeNull();
    expect(other?.revoked_at).not.toBeNull();

    await prisma.user.update({
      where: { id: targetId },
      data: { password_hash: await hashPassword(PASSWORD) },
    });
  });

  it("re-renders the blocklist rejection when the password is too common", async () => {
    await prisma.user.update({
      where: { id: targetId },
      data: { must_change_password: true },
    });

    const keepSession = await createSession(prisma, {
      userId: targetId,
      stage: SESSION_STAGE.CHANGE_PASSWORD_REQUIRED,
      ip: "127.0.0.4",
    });

    const res = await app.request("/change-password", {
      method: "POST",
      headers: {
        Cookie: `admitto_session=${keepSession.rawToken}`,
        ...sameOrigin,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        password: "aaaaaaaaaaaa",
        password_confirm: "aaaaaaaaaaaa",
      }).toString(),
    });
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain("too common or predictable");
  });
});

describe("v0.4.10: unlimited instance superadmins", () => {
  it("allows granting superadmin to second, third, and fourth users", async () => {
    const thirdEmail = "super-third@example.com";
    const fourthEmail = "super-fourth@example.com";
    const thirdUser = await prisma.user.create({
      data: { email: thirdEmail, password_hash: await hashPassword(PASSWORD) },
    });
    const fourthUser = await prisma.user.create({
      data: { email: fourthEmail, password_hash: await hashPassword(PASSWORD) },
    });

    try {
      const grant = async (userId: string) => {
        const res = await app.request(`/api/admin/users/${userId}/roles`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...sameOrigin, Cookie: superCookie },
          body: JSON.stringify({ role: "superadmin", scope_type: "instance" }),
        });
        expect(res.status).toBe(201);
      };

      await grant(targetId);
      await grant(thirdUser.id);
      await grant(fourthUser.id);

      const count = await prisma.roleAssignment.count({
        where: { role: "superadmin", scope_type: "instance", scope_id: null },
      });
      expect(count).toBeGreaterThanOrEqual(4);
    } finally {
      await prisma.roleAssignment.deleteMany({
        where: { user_id: { in: [targetId, thirdUser.id, fourthUser.id] } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: [thirdUser.id, fourthUser.id] } },
      });
    }
  });

  it("returns 409 already_assigned for duplicate superadmin grant on same user", async () => {
    const res = await app.request(`/api/admin/users/${superId}/roles`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sameOrigin, Cookie: superCookie },
      body: JSON.stringify({ role: "superadmin", scope_type: "instance" }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("already_assigned");
  });

  it("returns 400 invalid_request for a malformed JSON body", async () => {
    const res = await app.request(`/api/admin/users/${superId}/roles`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sameOrigin, Cookie: superCookie },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("invalid_request");
  });

  it("returns 400 invalid_request for an unrecognized role value", async () => {
    const res = await app.request(`/api/admin/users/${superId}/roles`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sameOrigin, Cookie: superCookie },
      body: JSON.stringify({ role: "bogus", scope_type: "instance" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("invalid_request");
  });

  it("returns 404 for a user id that doesn't exist", async () => {
    const res = await app.request("/api/admin/users/nonexistent-user-id/roles", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sameOrigin, Cookie: superCookie },
      body: JSON.stringify({ role: "operator", scope_type: "event", scope_id: eventId }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("not_found");
  });
});

describe("admin audit atomicity (BE-002)", () => {
  it("rolls back user creation when audit log write fails", async () => {
    const email = "audit-rollback@example.com";
    const spy = vi
      .spyOn(tickets, "writeAdminAuditLog")
      .mockRejectedValueOnce(new Error("audit failed"));

    const res = await app.request("/api/admin/users", {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "audit-rollback-1" }),
    });
    expect(res.status).toBe(500);

    const row = await prisma.user.findUnique({ where: { email } });
    expect(row).toBeNull();

    spy.mockRestore();
  });
});

describe("GET /api/admin/role-assignments search", () => {
  // Own user/assignment (not the shared targetId/targetAssignmentId fixtures, which other
  // describe blocks earlier in this file mutate/delete over the course of the suite) so this
  // search assertion doesn't depend on what's left of them by the time it runs.
  const searchEmail = "role-assignments-search-target@example.com";
  let searchUserId = "";
  let searchAssignmentId = "";

  beforeAll(async () => {
    const password_hash = await hashPassword(PASSWORD);
    const user = await prisma.user.create({ data: { email: searchEmail, password_hash } });
    searchUserId = user.id;
    const assignment = await prisma.roleAssignment.create({
      data: { user_id: searchUserId, role: "operator", scope_type: "event", scope_id: eventId },
    });
    searchAssignmentId = assignment.id;
  });

  afterAll(async () => {
    await prisma.roleAssignment.deleteMany({ where: { user_id: searchUserId } });
    await prisma.user.delete({ where: { id: searchUserId } });
  });

  it("filters by the assigned user's email substring", async () => {
    const res = await app.request("/api/admin/role-assignments?q=role-assignments-search-target", {
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { assignments: Array<{ id: string; user_email: string }>; total: number };
    expect(body.assignments.map((a) => a.id)).toEqual([searchAssignmentId]);
    expect(body.assignments[0]?.user_email).toBe(searchEmail);
  });

  it("returns no rows for a search term matching nobody", async () => {
    const res = await app.request("/api/admin/role-assignments?q=nobody-matches-this", {
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { assignments: unknown[]; total: number };
    expect(body.assignments).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  it("filters by eventId", async () => {
    const res = await app.request(
      `/api/admin/role-assignments?eventId=${eventId}&q=role-assignments-search-target`,
      { headers: { Cookie: superCookie } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { assignments: Array<{ id: string }>; total: number };
    expect(body.assignments.map((a) => a.id)).toEqual([searchAssignmentId]);
  });

  it("returns no rows for an eventId matching nobody", async () => {
    const res = await app.request("/api/admin/role-assignments?eventId=nonexistent-event-id", {
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { assignments: unknown[]; total: number };
    expect(body.assignments).toHaveLength(0);
    expect(body.total).toBe(0);
  });
});
