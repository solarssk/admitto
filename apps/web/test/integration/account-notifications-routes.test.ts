import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { createSession, hashPassword, SESSION_STAGE } from "@admitto/auth";
import { createApp } from "../../src/app.js";
import { InMemoryRateLimitStore } from "../../src/rate-limit/in-memory.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };

const ORG_ID = "org-account-notifications-routes-test";
const ORG_ID_2 = "org-account-notifications-routes-test-2";
const EMAIL_A = "account-notif-a@example.com";
const EMAIL_B = "account-notif-b@example.com";
const PASSWORD = "account-notif-test-pass-123";
const TYPE = "auth.login.repeated_failures";

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let rateLimitStore: InMemoryRateLimitStore;
let userAId: string;
let userBId: string;
let cookieA = "";
let cookieB = "";
let prevInstanceOrgId: string | undefined;

/** No role assignments needed - requireSession (used by every route under test) only checks for
 * a valid FULL-stage session, same as account-routes.test.ts's own lighter fixtures. */
async function seed(client: PrismaClient) {
  await client.notification.deleteMany({ where: { organization_id: { in: [ORG_ID, ORG_ID_2] } } });
  await client.notificationPreference.deleteMany({
    where: { user: { email: { in: [EMAIL_A, EMAIL_B] } } },
  });
  await client.adminAuditLog.deleteMany({ where: { organization_id: ORG_ID } });
  await client.session.deleteMany({ where: { user: { email: { in: [EMAIL_A, EMAIL_B] } } } });
  await client.user.deleteMany({ where: { email: { in: [EMAIL_A, EMAIL_B] } } });
  await client.organization.deleteMany({ where: { id: { in: [ORG_ID, ORG_ID_2] } } });

  await client.organization.create({
    data: { id: ORG_ID, name: "Account Notifications Test Org", slug: "account-notifications-routes-test" },
  });
  await client.organization.create({
    data: { id: ORG_ID_2, name: "Account Notifications Test Org 2", slug: "account-notifications-routes-test-2" },
  });

  const password_hash = await hashPassword(PASSWORD);
  const userA = await client.user.create({ data: { email: EMAIL_A, password_hash } });
  const userB = await client.user.create({ data: { email: EMAIL_B, password_hash } });
  userAId = userA.id;
  userBId = userB.id;
}

beforeAll(async () => {
  prevInstanceOrgId = process.env.INSTANCE_ORG_ID;
  process.env.INSTANCE_ORG_ID = ORG_ID;

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

  const sessionA = await createSession(prisma, { userId: userAId, stage: SESSION_STAGE.FULL, ip: "127.0.0.1" });
  cookieA = `admitto_session=${sessionA.rawToken}`;
  const sessionB = await createSession(prisma, { userId: userBId, stage: SESSION_STAGE.FULL, ip: "127.0.0.1" });
  cookieB = `admitto_session=${sessionB.rawToken}`;
});

beforeEach(async () => {
  rateLimitStore.reset();
  await prisma.notification.deleteMany({ where: { organization_id: { in: [ORG_ID, ORG_ID_2] } } });
  await prisma.notificationPreference.deleteMany({
    where: { user: { email: { in: [EMAIL_A, EMAIL_B] } } },
  });
  await prisma.adminAuditLog.deleteMany({ where: { organization_id: ORG_ID } });
});

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { organization_id: { in: [ORG_ID, ORG_ID_2] } } });
  await prisma.notificationPreference.deleteMany({
    where: { user: { email: { in: [EMAIL_A, EMAIL_B] } } },
  });
  await prisma.adminAuditLog.deleteMany({ where: { organization_id: ORG_ID } });
  await prisma.session.deleteMany({ where: { user: { email: { in: [EMAIL_A, EMAIL_B] } } } });
  await prisma.user.deleteMany({ where: { email: { in: [EMAIL_A, EMAIL_B] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [ORG_ID, ORG_ID_2] } } });
  if (prevInstanceOrgId === undefined) delete process.env.INSTANCE_ORG_ID;
  else process.env.INSTANCE_ORG_ID = prevInstanceOrgId;
  await prisma.$disconnect();
});

async function createNotification(
  userId: string,
  overrides: Partial<{ organizationId: string; readAt: Date | null; title: string }> = {},
) {
  return prisma.notification.create({
    data: {
      user_id: userId,
      organization_id: overrides.organizationId ?? ORG_ID,
      notification_type: TYPE,
      severity: "error",
      title: overrides.title ?? "5 consecutive failed sign-in attempts",
      body: "5 consecutive failed sign-in attempts on admin@example.com.",
      read_at: overrides.readAt ?? null,
    },
  });
}

describe("GET /api/account/notifications/preferences", () => {
  it("returns every userConfigurable type with both channels enabled by default", async () => {
    const res = await app.request("/api/account/notifications/preferences", {
      headers: { Cookie: cookieA },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      notification_types: Array<{ id: string; channels: Record<string, boolean> }>;
    };
    expect(body.notification_types.length).toBeGreaterThanOrEqual(4);
    const entry = body.notification_types.find((t) => t.id === TYPE)!;
    expect(entry.channels).toEqual({ email: true, in_app: true });
  });

  it("reflects an explicitly-disabled channel", async () => {
    await prisma.notificationPreference.create({
      data: { user_id: userAId, notification_type: TYPE, channel: "email", enabled: false },
    });
    const res = await app.request("/api/account/notifications/preferences", {
      headers: { Cookie: cookieA },
    });
    const body = (await res.json()) as {
      notification_types: Array<{ id: string; channels: Record<string, boolean> }>;
    };
    const entry = body.notification_types.find((t) => t.id === TYPE)!;
    expect(entry.channels).toEqual({ email: false, in_app: true });
  });
});

describe("PATCH /api/account/notifications/preferences", () => {
  it("toggles one cell and the response reflects it", async () => {
    const res = await app.request("/api/account/notifications/preferences", {
      method: "PATCH",
      headers: { Cookie: cookieA, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ notification_type: TYPE, channel: "email", enabled: false }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      notification_types: Array<{ id: string; channels: Record<string, boolean> }>;
    };
    expect(body.notification_types.find((t) => t.id === TYPE)!.channels).toEqual({
      email: false,
      in_app: true,
    });

    const stored = await prisma.notificationPreference.findUnique({
      where: { user_id_notification_type_channel: { user_id: userAId, notification_type: TYPE, channel: "email" } },
    });
    expect(stored?.enabled).toBe(false);
  });

  it("returns 400 for an unknown notification_type", async () => {
    const res = await app.request("/api/account/notifications/preferences", {
      method: "PATCH",
      headers: { Cookie: cookieA, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ notification_type: "not.real", channel: "email", enabled: false }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_notification_type");
  });

  it("rejects channel 'webhook' at the schema level", async () => {
    const res = await app.request("/api/account/notifications/preferences", {
      method: "PATCH",
      headers: { Cookie: cookieA, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ notification_type: TYPE, channel: "webhook", enabled: false }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for a malformed JSON body", async () => {
    const res = await app.request("/api/account/notifications/preferences", {
      method: "PATCH",
      headers: { Cookie: cookieA, ...sameOrigin, "Content-Type": "application/json" },
      body: "{not valid json",
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_json");
  });

  it("rejects a cross-site request with no Origin header", async () => {
    const res = await app.request("/api/account/notifications/preferences", {
      method: "PATCH",
      headers: { Cookie: cookieA, "Content-Type": "application/json" },
      body: JSON.stringify({ notification_type: TYPE, channel: "email", enabled: false }),
    });
    expect(res.status).not.toBe(200);
  });

  it("writes no AdminAuditLog row - this is a personal setting, not an administrative action", async () => {
    const before = await prisma.adminAuditLog.count({ where: { organization_id: ORG_ID } });
    const res = await app.request("/api/account/notifications/preferences", {
      method: "PATCH",
      headers: { Cookie: cookieA, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ notification_type: TYPE, channel: "in_app", enabled: false }),
    });
    expect(res.status).toBe(200);
    const after = await prisma.adminAuditLog.count({ where: { organization_id: ORG_ID } });
    expect(after).toBe(before);
  });
});

describe("GET /api/account/notifications", () => {
  it("never includes another user's notifications", async () => {
    await createNotification(userAId, { title: "userA's own alert" });
    await createNotification(userBId, { title: "userB's own alert" });

    const res = await app.request("/api/account/notifications", { headers: { Cookie: cookieA } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { notifications: Array<{ title: string }> };
    expect(body.notifications.some((n) => n.title === "userA's own alert")).toBe(true);
    expect(body.notifications.some((n) => n.title === "userB's own alert")).toBe(false);
  });

  it("resolves organization_id to a name, distinguishing alerts from different organizations", async () => {
    await createNotification(userAId, { organizationId: ORG_ID, title: "alert from org 1" });
    await createNotification(userAId, { organizationId: ORG_ID_2, title: "alert from org 2" });

    const res = await app.request("/api/account/notifications", { headers: { Cookie: cookieA } });
    const body = (await res.json()) as { notifications: Array<{ title: string; organization_name: string | null }> };
    const org1 = body.notifications.find((n) => n.title === "alert from org 1");
    const org2 = body.notifications.find((n) => n.title === "alert from org 2");
    expect(org1?.organization_name).toBe("Account Notifications Test Org");
    expect(org2?.organization_name).toBe("Account Notifications Test Org 2");
  });
});

describe("GET /api/account/notifications/unread-count", () => {
  it("counts only the caller's own unread rows", async () => {
    await createNotification(userAId);
    await createNotification(userAId, { readAt: new Date() });
    await createNotification(userBId);
    await createNotification(userBId);

    const res = await app.request("/api/account/notifications/unread-count", {
      headers: { Cookie: cookieA },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { unread_count: number }).unread_count).toBe(1);
  });
});

describe("PATCH /api/account/notifications/:id/read", () => {
  it("returns 403 for another user's notification and does not mark it read", async () => {
    const other = await createNotification(userBId);
    const res = await app.request(`/api/account/notifications/${other.id}/read`, {
      method: "PATCH",
      headers: { Cookie: cookieA, ...sameOrigin },
    });
    expect(res.status).toBe(403);
    const row = await prisma.notification.findUnique({ where: { id: other.id } });
    expect(row?.read_at).toBeNull();
  });

  it("returns 200 no-op for an id that doesn't exist", async () => {
    const res = await app.request("/api/account/notifications/not-a-real-id/read", {
      method: "PATCH",
      headers: { Cookie: cookieA, ...sameOrigin },
    });
    expect(res.status).toBe(200);
  });

  it("marks the caller's own unread notification read and returns the updated unread_count", async () => {
    const mine = await createNotification(userAId);
    const res = await app.request(`/api/account/notifications/${mine.id}/read`, {
      method: "PATCH",
      headers: { Cookie: cookieA, ...sameOrigin },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { unread_count: number }).unread_count).toBe(0);
    const row = await prisma.notification.findUnique({ where: { id: mine.id } });
    expect(row?.read_at).not.toBeNull();
  });
});

describe("POST /api/account/notifications/mark-all-read", () => {
  it("marks only the caller's own unread rows, leaving another user's unread rows untouched", async () => {
    await createNotification(userAId);
    await createNotification(userAId);
    const otherUnread = await createNotification(userBId);

    const res = await app.request("/api/account/notifications/mark-all-read", {
      method: "POST",
      headers: { Cookie: cookieA, ...sameOrigin },
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { updated_count: number; unread_count: number }).toEqual({
      updated_count: 2,
      unread_count: 0,
    });

    const countA = await app.request("/api/account/notifications/unread-count", {
      headers: { Cookie: cookieA },
    });
    expect(((await countA.json()) as { unread_count: number }).unread_count).toBe(0);

    const otherRow = await prisma.notification.findUnique({ where: { id: otherUnread.id } });
    expect(otherRow?.read_at).toBeNull();
  });
});

describe("POST /api/account/notifications/clear-all", () => {
  it("permanently deletes only the caller's own notifications, leaving another user's rows untouched", async () => {
    await createNotification(userAId);
    await createNotification(userAId, { readAt: new Date() });
    const otherNotification = await createNotification(userBId);

    const res = await app.request("/api/account/notifications/clear-all", {
      method: "POST",
      headers: { Cookie: cookieA, ...sameOrigin },
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { cleared_count: number; unread_count: number }).toEqual({
      cleared_count: 2,
      unread_count: 0,
    });

    const remainingForA = await prisma.notification.count({ where: { user_id: userAId } });
    expect(remainingForA).toBe(0);

    const otherRow = await prisma.notification.findUnique({ where: { id: otherNotification.id } });
    expect(otherRow).not.toBeNull();
  });

  it("is idempotent when the caller already has nothing to clear", async () => {
    const res = await app.request("/api/account/notifications/clear-all", {
      method: "POST",
      headers: { Cookie: cookieA, ...sameOrigin },
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { cleared_count: number; unread_count: number }).toEqual({
      cleared_count: 0,
      unread_count: 0,
    });
  });
});
