import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createSession, hashPassword, SESSION_STAGE } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { createApp } from "../../src/app.js";
import { InMemoryRateLimitStore } from "../../src/rate-limit/in-memory.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };

const ORG_SESSIONS = "org-sessions-test";
const EMAIL_SUPER = "sessions-super@example.com";
const EMAIL_ADMIN = "sessions-admin@example.com";
const EMAIL_OPERATOR = "sessions-operator@example.com";
const PASSWORD = "sessions-pass-123";

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let rateLimitStore: InMemoryRateLimitStore;

let superId: string;
let adminId: string;
let operatorId: string;
let superCookie = "";
let adminCookie = "";
let superSessionId = "";
let adminSessionId = "";
let eventId = "";
let prevInstanceOrgId: string | undefined;

async function seed(client: PrismaClient) {
  await client.adminAuditLog.deleteMany({ where: { organization_id: ORG_SESSIONS } });
  await client.session.deleteMany({
    where: { user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN, EMAIL_OPERATOR] } } },
  });
  await client.userMfaMethod.deleteMany({
    where: { user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN, EMAIL_OPERATOR] } } },
  });
  await client.roleAssignment.deleteMany({ where: { scope_id: ORG_SESSIONS } });
  await client.event.deleteMany({ where: { organization_id: ORG_SESSIONS } });
  await client.user.deleteMany({
    where: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN, EMAIL_OPERATOR] } },
  });
  await client.organization.deleteMany({ where: { id: ORG_SESSIONS } });

  const password_hash = await hashPassword(PASSWORD);

  await client.organization.create({
    data: { id: ORG_SESSIONS, name: "Sessions Test Org", slug: "sessions-test" },
  });

  const event = await client.event.create({
    data: {
      title: "Test Event",
      slug: "sessions-test-event",
      organization_id: ORG_SESSIONS,
      date: new Date("2025-01-01"),
    },
  });
  eventId = event.id;

  const superUser = await client.user.create({ data: { email: EMAIL_SUPER, password_hash } });
  const adminUser = await client.user.create({ data: { email: EMAIL_ADMIN, password_hash } });
  const operatorUser = await client.user.create({
    data: { email: EMAIL_OPERATOR, password_hash },
  });
  superId = superUser.id;
  adminId = adminUser.id;
  operatorId = operatorUser.id;

  await client.roleAssignment.createMany({
    data: [
      { user_id: superId, role: "superadmin", scope_type: "instance", scope_id: null },
      {
        user_id: adminId,
        role: "admin",
        scope_type: "organization",
        scope_id: ORG_SESSIONS,
      },
      { user_id: operatorId, role: "operator", scope_type: "event", scope_id: eventId },
    ],
  });

  for (const userId of [superId, adminId, operatorId]) {
    await client.userMfaMethod.create({
      data: {
        user_id: userId,
        type: "totp",
        secret_enc: encryptTotpSecret(generateTotpSecret()),
        confirmed_at: new Date(),
      },
    });
  }
}

beforeAll(async () => {
  prevInstanceOrgId = process.env.INSTANCE_ORG_ID;
  process.env.INSTANCE_ORG_ID = ORG_SESSIONS;

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
  superCookie = `admitto_session=${superSession.rawToken}`;
  adminCookie = `admitto_session=${adminSession.rawToken}`;
  superSessionId = superSession.session.id;
  adminSessionId = adminSession.session.id;
});

afterEach(async () => {
  await prisma.adminAuditLog.deleteMany({ where: { organization_id: ORG_SESSIONS } });
  await prisma.session.deleteMany({
    where: {
      user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN, EMAIL_OPERATOR] } },
      id: { notIn: [superSessionId, adminSessionId] },
    },
  });
});

afterAll(async () => {
  if (prevInstanceOrgId !== undefined) process.env.INSTANCE_ORG_ID = prevInstanceOrgId;
  else delete process.env.INSTANCE_ORG_ID;
  await prisma?.$disconnect();
});

describe("GET /api/admin/sessions", () => {
  it("returns only active sessions", async () => {
    const extra = await createSession(prisma, { userId: operatorId, stage: SESSION_STAGE.FULL });
    // revoke it
    await prisma.session.update({
      where: { id: extra.session.id },
      data: { revoked_at: new Date() },
    });

    const res = await app.request("/api/admin/sessions", {
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessions: { id: string }[] };
    const ids = body.sessions.map((s) => s.id);
    expect(ids).not.toContain(extra.session.id);
  });

  it("never includes token_hash in response", async () => {
    const res = await app.request("/api/admin/sessions", {
      headers: { Cookie: superCookie },
    });
    const raw = await res.text();
    expect(raw).not.toContain("token_hash");
  });

  it("marks isCurrent true for calling session only", async () => {
    const extra = await createSession(prisma, { userId: operatorId, stage: SESSION_STAGE.FULL });

    const res = await app.request("/api/admin/sessions", {
      headers: { Cookie: superCookie },
    });
    const body = (await res.json()) as {
      sessions: { id: string; isCurrent: boolean; userId: string }[];
    };

    const superEntry = body.sessions.find((s) => s.id === superSessionId);
    expect(superEntry?.isCurrent).toBe(true);

    const operatorEntry = body.sessions.find((s) => s.id === extra.session.id);
    expect(operatorEntry?.isCurrent).toBe(false);

    await prisma.session.delete({ where: { id: extra.session.id } });
  });

  it("computes role correctly (superadmin from RoleAssignment)", async () => {
    const res = await app.request("/api/admin/sessions", {
      headers: { Cookie: superCookie },
    });
    const body = (await res.json()) as { sessions: { userId: string; role: string }[] };
    const superEntry = body.sessions.find((s) => s.userId === superId);
    expect(superEntry?.role).toBe("superadmin");
  });

  it("filters by role=admin", async () => {
    const opSession = await createSession(prisma, {
      userId: operatorId,
      stage: SESSION_STAGE.FULL,
    });

    const res = await app.request("/api/admin/sessions?role=admin", {
      headers: { Cookie: superCookie },
    });
    const body = (await res.json()) as { sessions: { role: string }[] };
    for (const s of body.sessions) {
      expect(["admin", "superadmin"]).toContain(s.role);
    }

    await prisma.session.delete({ where: { id: opSession.session.id } });
  });

  it("filters by role=operator", async () => {
    const opSession = await createSession(prisma, {
      userId: operatorId,
      stage: SESSION_STAGE.FULL,
    });

    const res = await app.request("/api/admin/sessions?role=operator", {
      headers: { Cookie: superCookie },
    });
    const body = (await res.json()) as { sessions: { role: string }[] };
    for (const s of body.sessions) {
      expect(s.role).toBe("operator");
    }

    await prisma.session.delete({ where: { id: opSession.session.id } });
  });

  it("rejects non-superadmin (admin) with 403", async () => {
    const res = await app.request("/api/admin/sessions", {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/admin/sessions/:id/revoke", () => {
  it("revokes session and writes audit log", async () => {
    const target = await createSession(prisma, { userId: operatorId, stage: SESSION_STAGE.FULL });

    const res = await app.request(`/api/admin/sessions/${target.session.id}/revoke`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin },
    });
    expect(res.status).toBe(200);

    const revoked = await prisma.session.findUnique({ where: { id: target.session.id } });
    expect(revoked?.revoked_at).not.toBeNull();

    const log = await prisma.adminAuditLog.findFirst({
      where: { organization_id: ORG_SESSIONS, action_type: "session_revoked" },
    });
    expect(log).not.toBeNull();
    expect((log?.metadata as Record<string, unknown>)?.session_id).toBe(target.session.id);
    expect((log?.metadata as Record<string, unknown>)?.target_user_id).toBe(operatorId);
  });

  it("blocks self-revoke with 403", async () => {
    const res = await app.request(`/api/admin/sessions/${superSessionId}/revoke`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("cannot_revoke_own_session");
  });

  it("is idempotent — already revoked returns 200 and writes no extra audit row", async () => {
    const target = await createSession(prisma, { userId: operatorId, stage: SESSION_STAGE.FULL });
    await prisma.session.update({
      where: { id: target.session.id },
      data: { revoked_at: new Date() },
    });

    const auditCountBefore = await prisma.adminAuditLog.count({
      where: { organization_id: ORG_SESSIONS, action_type: "session_revoked" },
    });

    const res = await app.request(`/api/admin/sessions/${target.session.id}/revoke`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin },
    });
    expect(res.status).toBe(200);

    const auditCountAfter = await prisma.adminAuditLog.count({
      where: { organization_id: ORG_SESSIONS, action_type: "session_revoked" },
    });
    expect(auditCountAfter).toBe(auditCountBefore);
  });

  it("rejects missing CSRF header", async () => {
    const target = await createSession(prisma, { userId: operatorId, stage: SESSION_STAGE.FULL });
    const res = await app.request(`/api/admin/sessions/${target.session.id}/revoke`, {
      method: "POST",
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    await prisma.session.delete({ where: { id: target.session.id } });
  });

  it("rejects non-superadmin with 403", async () => {
    const target = await createSession(prisma, { userId: operatorId, stage: SESSION_STAGE.FULL });
    const res = await app.request(`/api/admin/sessions/${target.session.id}/revoke`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin },
    });
    expect(res.status).toBe(403);
    await prisma.session.delete({ where: { id: target.session.id } });
  });
});

describe("POST /api/admin/events/:eventId/revoke-all-operator-sessions", () => {
  it("revokes operator sessions and returns revokedCount", async () => {
    const op1 = await createSession(prisma, { userId: operatorId, stage: SESSION_STAGE.FULL });
    const op2 = await createSession(prisma, { userId: operatorId, stage: SESSION_STAGE.FULL });

    const res = await app.request(
      `/api/admin/events/${eventId}/revoke-all-operator-sessions`,
      {
        method: "POST",
        headers: { Cookie: superCookie, ...sameOrigin },
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { revokedCount: number };
    expect(body.revokedCount).toBeGreaterThanOrEqual(2);

    const [r1, r2] = await Promise.all([
      prisma.session.findUnique({ where: { id: op1.session.id } }),
      prisma.session.findUnique({ where: { id: op2.session.id } }),
    ]);
    expect(r1?.revoked_at).not.toBeNull();
    expect(r2?.revoked_at).not.toBeNull();
  });

  it("writes audit log with eventId and revokedCount", async () => {
    await app.request(`/api/admin/events/${eventId}/revoke-all-operator-sessions`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin },
    });

    const log = await prisma.adminAuditLog.findFirst({
      where: {
        organization_id: ORG_SESSIONS,
        action_type: "operator_sessions_bulk_revoked",
      },
    });
    expect(log).not.toBeNull();
    const meta = log?.metadata as Record<string, unknown>;
    expect(meta?.eventId).toBe(eventId);
    expect(typeof meta?.revokedCount).toBe("number");
  });

  it("rejects non-admin (operator) with 403", async () => {
    const opSession = await createSession(prisma, {
      userId: operatorId,
      stage: SESSION_STAGE.FULL,
    });
    const opCookie = `admitto_session=${opSession.rawToken}`;

    const res = await app.request(
      `/api/admin/events/${eventId}/revoke-all-operator-sessions`,
      {
        method: "POST",
        headers: { Cookie: opCookie, ...sameOrigin },
      },
    );
    expect(res.status).toBeGreaterThanOrEqual(400);

    await prisma.session.delete({ where: { id: opSession.session.id } });
  });

  it("rejects missing CSRF header", async () => {
    const res = await app.request(
      `/api/admin/events/${eventId}/revoke-all-operator-sessions`,
      {
        method: "POST",
        headers: { Cookie: superCookie },
      },
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
