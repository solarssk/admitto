import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { createSession, hashPassword, SESSION_STAGE, verifyPassword } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import * as tickets from "@admitto/tickets";
import { createApp } from "../../src/app.js";
import {
  assertLastSuperadminDeactivationAllowed,
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

  prisma = createTestPrismaClient();
  await seed(prisma);

  app = createApp({
    prisma,
    baseUrl: "https://admitto.example.com",
    rateLimitStore: new InMemoryRateLimitStore(),
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
});

describe("DELETE /api/admin/users/:id/roles/:assignmentId anti-lockout", () => {
  it("returns 409 last_superadmin for final superadmin assignment", async () => {
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
    expect(body.code).toBe("last_superadmin");
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
