import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { createSession, hashPassword, SESSION_STAGE } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { createApp } from "../../src/app.js";
import { InMemoryRateLimitStore } from "../../src/rate-limit/in-memory.js";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";

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
  resetSystemLogBufferForTest();
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
      sessions: {
        id: string;
        isCurrent: boolean;
        userId: string;
        country: { kind: string; countryCode?: string };
      }[];
    };

    const superEntry = body.sessions.find((s) => s.id === superSessionId);
    expect(superEntry?.isCurrent).toBe(true);
    // Seeded with ip: "127.0.0.1" (loopback) - resolves to internal, not a live geo lookup.
    expect(superEntry?.country.kind).toBe("internal");

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

    const securityLogs = querySystemLogs({ source: "security" });
    expect(
      securityLogs.some(
        (entry) => entry.message === "session_revoked" && entry.fields?.sessionId === target.session.id,
      ),
    ).toBe(true);
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

  it("returns 200 for a session id that doesn't exist at all (idempotent no-op)", async () => {
    const res = await app.request("/api/admin/sessions/does-not-exist/revoke", {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin },
    });
    expect(res.status).toBe(200);
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

describe("POST /api/admin/sessions/:id/device-label", () => {
  it("corrects a mistyped device label and audits previous/new values", async () => {
    const target = await createSession(prisma, {
      userId: operatorId,
      stage: SESSION_STAGE.FULL,
      deviceLabel: "Tabelt 1 - mian entrance",
    });

    const res = await app.request(`/api/admin/sessions/${target.session.id}/device-label`, {
      method: "POST",
      headers: { Cookie: superCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ deviceLabel: "Tablet 1 — main entrance" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deviceLabel: string | null };
    expect(body.deviceLabel).toBe("Tablet 1 — main entrance");

    const updated = await prisma.session.findUnique({ where: { id: target.session.id } });
    expect(updated?.device_label).toBe("Tablet 1 — main entrance");

    const log = await prisma.adminAuditLog.findFirst({
      where: { organization_id: ORG_SESSIONS, action_type: "session_device_label_updated" },
      orderBy: { id: "desc" },
    });
    expect(log).not.toBeNull();
    const meta = log?.metadata as Record<string, unknown>;
    expect(meta?.session_id).toBe(target.session.id);
    expect(meta?.target_user_id).toBe(operatorId);
    expect(meta?.previous_label).toBe("Tabelt 1 - mian entrance");
    expect(meta?.new_label).toBe("Tablet 1 — main entrance");

    const securityLogs = querySystemLogs({ source: "security" });
    expect(
      securityLogs.some(
        (entry) =>
          entry.message === "session_device_label_updated" &&
          entry.fields?.sessionId === target.session.id,
      ),
    ).toBe(true);

    await prisma.session.delete({ where: { id: target.session.id } });
  });

  it("clears the label when given an empty string", async () => {
    const target = await createSession(prisma, {
      userId: operatorId,
      stage: SESSION_STAGE.FULL,
      deviceLabel: "Some Label",
    });

    const res = await app.request(`/api/admin/sessions/${target.session.id}/device-label`, {
      method: "POST",
      headers: { Cookie: superCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ deviceLabel: "" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deviceLabel: string | null };
    expect(body.deviceLabel).toBeNull();

    const updated = await prisma.session.findUnique({ where: { id: target.session.id } });
    expect(updated?.device_label).toBeNull();

    await prisma.session.delete({ where: { id: target.session.id } });
  });

  it("returns 400 for a label longer than 120 characters, leaving it unchanged", async () => {
    const target = await createSession(prisma, {
      userId: operatorId,
      stage: SESSION_STAGE.FULL,
      deviceLabel: "Original",
    });

    const res = await app.request(`/api/admin/sessions/${target.session.id}/device-label`, {
      method: "POST",
      headers: { Cookie: superCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ deviceLabel: "x".repeat(150) }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("device_label_too_long");

    const unchanged = await prisma.session.findUnique({ where: { id: target.session.id } });
    expect(unchanged?.device_label).toBe("Original");

    await prisma.session.delete({ where: { id: target.session.id } });
  });

  it("returns 409 and leaves the label unchanged when the session is revoked", async () => {
    const target = await createSession(prisma, {
      userId: operatorId,
      stage: SESSION_STAGE.FULL,
      deviceLabel: "Still Here",
    });
    await prisma.session.update({
      where: { id: target.session.id },
      data: { revoked_at: new Date() },
    });

    const res = await app.request(`/api/admin/sessions/${target.session.id}/device-label`, {
      method: "POST",
      headers: { Cookie: superCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ deviceLabel: "New Label" }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("session_not_editable");

    const unchanged = await prisma.session.findUnique({ where: { id: target.session.id } });
    expect(unchanged?.device_label).toBe("Still Here");

    await prisma.session.delete({ where: { id: target.session.id } });
  });

  it("returns 404 for a session id that doesn't exist", async () => {
    const res = await app.request("/api/admin/sessions/does-not-exist/device-label", {
      method: "POST",
      headers: { Cookie: superCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ deviceLabel: "x" }),
    });
    expect(res.status).toBe(404);
  });

  it("rejects missing CSRF header", async () => {
    const target = await createSession(prisma, { userId: operatorId, stage: SESSION_STAGE.FULL });
    const res = await app.request(`/api/admin/sessions/${target.session.id}/device-label`, {
      method: "POST",
      headers: { Cookie: superCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ deviceLabel: "x" }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    await prisma.session.delete({ where: { id: target.session.id } });
  });

  it("rejects non-superadmin with 403", async () => {
    const target = await createSession(prisma, { userId: operatorId, stage: SESSION_STAGE.FULL });
    const res = await app.request(`/api/admin/sessions/${target.session.id}/device-label`, {
      method: "POST",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ deviceLabel: "x" }),
    });
    expect(res.status).toBe(403);
    await prisma.session.delete({ where: { id: target.session.id } });
  });

  it("returns 400 for a malformed JSON body", async () => {
    const target = await createSession(prisma, { userId: operatorId, stage: SESSION_STAGE.FULL });
    const res = await app.request(`/api/admin/sessions/${target.session.id}/device-label`, {
      method: "POST",
      headers: { Cookie: superCookie, "Content-Type": "application/json", ...sameOrigin },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_json");
    await prisma.session.delete({ where: { id: target.session.id } });
  });

  it("returns 400 when deviceLabel is not a string", async () => {
    const target = await createSession(prisma, { userId: operatorId, stage: SESSION_STAGE.FULL });
    const res = await app.request(`/api/admin/sessions/${target.session.id}/device-label`, {
      method: "POST",
      headers: { Cookie: superCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ deviceLabel: 123 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_device_label");
    await prisma.session.delete({ where: { id: target.session.id } });
  });

  it("treats an explicit null deviceLabel the same as clearing it", async () => {
    const target = await createSession(prisma, {
      userId: operatorId,
      stage: SESSION_STAGE.FULL,
      deviceLabel: "Some Label",
    });
    const res = await app.request(`/api/admin/sessions/${target.session.id}/device-label`, {
      method: "POST",
      headers: { Cookie: superCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ deviceLabel: null }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deviceLabel: string | null };
    expect(body.deviceLabel).toBeNull();
    await prisma.session.delete({ where: { id: target.session.id } });
  });

  it("treats a body with no deviceLabel key as clearing it", async () => {
    const target = await createSession(prisma, {
      userId: operatorId,
      stage: SESSION_STAGE.FULL,
      deviceLabel: "Some Label",
    });
    const res = await app.request(`/api/admin/sessions/${target.session.id}/device-label`, {
      method: "POST",
      headers: { Cookie: superCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deviceLabel: string | null };
    expect(body.deviceLabel).toBeNull();
    await prisma.session.delete({ where: { id: target.session.id } });
  });

  it("records an accurate previous_label chain when two edits race, instead of both auditing the same stale starting value", async () => {
    const target = await createSession(prisma, {
      userId: operatorId,
      stage: SESSION_STAGE.FULL,
      deviceLabel: "Original",
    });
    const post = (deviceLabel: string) =>
      app.request(`/api/admin/sessions/${target.session.id}/device-label`, {
        method: "POST",
        headers: { Cookie: superCookie, "Content-Type": "application/json", ...sameOrigin },
        body: JSON.stringify({ deviceLabel }),
      });

    const [resA, resB] = await Promise.all([post("Edit A"), post("Edit B")]);
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const logs = await prisma.adminAuditLog.findMany({
      where: {
        organization_id: ORG_SESSIONS,
        action_type: "session_device_label_updated",
        metadata: { path: ["session_id"], equals: target.session.id },
      },
      orderBy: { id: "asc" },
    });
    expect(logs).toHaveLength(2);
    const [first, second] = logs.map((l) => l.metadata as Record<string, unknown>);

    // Whichever request's transaction committed first, it must have read the real starting
    // label - and the second must chain from the first's result, not repeat that same starting
    // value (the bug FOR UPDATE fixes: both reading "Original" as their own previous_label).
    expect(first?.previous_label).toBe("Original");
    expect(second?.previous_label).toBe(first?.new_label);
    expect(new Set([first?.new_label, second?.new_label])).toEqual(new Set(["Edit A", "Edit B"]));

    const finalSession = await prisma.session.findUnique({ where: { id: target.session.id } });
    expect(finalSession?.device_label).toBe(second?.new_label);

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

    const securityLogs = querySystemLogs({ source: "security" });
    expect(
      securityLogs.some((entry) => entry.message === "operator_sessions_bulk_revoked" && entry.fields?.eventId === eventId),
    ).toBe(true);
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
