import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createSession, hashPassword, SESSION_STAGE } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { createApp } from "../../src/app.js";
import { InMemoryRateLimitStore } from "../../src/rate-limit/index.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };

const ORG_REVOKE = "org-event-revoke";
const EVENT_REVOKE = "evt-event-revoke";
const EVENT_REVOKE_ARCHIVED = "evt-event-revoke-archived";
const ITEM_REVOKE = "item-event-revoke";

const EMAIL_SUPER = "event-revoke-super@example.com";
const EMAIL_ADMIN = "event-revoke-admin@example.com";
const PASSWORD = "event-revoke-pass-123";

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let rateLimitStore: InMemoryRateLimitStore;
let superId: string;
let adminId: string;
let superCookie = "";
let adminCookie = "";
let prevInstanceOrgId: string | undefined;

async function seed(client: PrismaClient) {
  await client.adminAuditLog.deleteMany({ where: { organization_id: ORG_REVOKE } });
  await client.attendeeActionLog.deleteMany({
    where: { event_id: { in: [EVENT_REVOKE, EVENT_REVOKE_ARCHIVED] } },
  });
  await client.attendeeItemState.deleteMany({
    where: { event_item: { event_id: { in: [EVENT_REVOKE, EVENT_REVOKE_ARCHIVED] } } },
  });
  await client.checkIn.deleteMany({ where: { event_id: { in: [EVENT_REVOKE, EVENT_REVOKE_ARCHIVED] } } });
  await client.attendee.deleteMany({ where: { event_id: { in: [EVENT_REVOKE, EVENT_REVOKE_ARCHIVED] } } });
  await client.eventItem.deleteMany({ where: { event_id: { in: [EVENT_REVOKE, EVENT_REVOKE_ARCHIVED] } } });
  await client.roleAssignment.deleteMany({ where: { scope_id: ORG_REVOKE } });
  await client.session.deleteMany({
    where: { user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN] } } },
  });
  await client.userMfaMethod.deleteMany({
    where: { user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN] } } },
  });
  await client.user.deleteMany({ where: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN] } } });
  await client.event.deleteMany({ where: { id: { in: [EVENT_REVOKE, EVENT_REVOKE_ARCHIVED] } } });
  await client.organization.deleteMany({ where: { id: ORG_REVOKE } });

  const password_hash = await hashPassword(PASSWORD);

  await client.organization.create({
    data: { id: ORG_REVOKE, name: "Revoke Test Org", slug: "event-revoke-org" },
  });

  await client.event.createMany({
    data: [
      {
        id: EVENT_REVOKE,
        title: "Revoke Test Event",
        slug: "event-revoke-test",
        date: new Date("2026-10-01T12:00:00.000Z"),
        organization_id: ORG_REVOKE,
      },
      {
        id: EVENT_REVOKE_ARCHIVED,
        title: "Archived Revoke Test Event",
        slug: "event-revoke-archived",
        date: new Date("2026-11-01T12:00:00.000Z"),
        organization_id: ORG_REVOKE,
        archived_at: new Date(),
      },
    ],
  });

  await client.eventItem.create({
    data: { id: ITEM_REVOKE, event_id: EVENT_REVOKE, key: "badge", label: "Badge", enabled: true },
  });

  const superUser = await client.user.create({ data: { email: EMAIL_SUPER, password_hash } });
  const adminUser = await client.user.create({ data: { email: EMAIL_ADMIN, password_hash } });
  superId = superUser.id;
  adminId = adminUser.id;

  await client.roleAssignment.createMany({
    data: [
      { user_id: superId, role: "superadmin", scope_type: "instance", scope_id: null },
      { user_id: adminId, role: "admin", scope_type: "organization", scope_id: ORG_REVOKE },
    ],
  });

  for (const userId of [superId, adminId]) {
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
  process.env.INSTANCE_ORG_ID = ORG_REVOKE;

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

  const superSession = await createSession(prisma, { userId: superId, stage: SESSION_STAGE.FULL });
  const adminSession = await createSession(prisma, { userId: adminId, stage: SESSION_STAGE.FULL });
  superCookie = `admitto_session=${superSession.rawToken}`;
  adminCookie = `admitto_session=${adminSession.rawToken}`;
});

afterEach(async () => {
  await prisma.adminAuditLog.deleteMany({ where: { organization_id: ORG_REVOKE } });
  await prisma.attendeeActionLog.deleteMany({ where: { event_id: EVENT_REVOKE } });
  await prisma.attendeeItemState.deleteMany({ where: { event_item: { event_id: EVENT_REVOKE } } });
  await prisma.checkIn.deleteMany({ where: { event_id: EVENT_REVOKE } });
  await prisma.attendee.deleteMany({ where: { event_id: EVENT_REVOKE } });
});

afterAll(async () => {
  if (prevInstanceOrgId !== undefined) process.env.INSTANCE_ORG_ID = prevInstanceOrgId;
  else delete process.env.INSTANCE_ORG_ID;
  await prisma?.$disconnect();
});

describe("POST /api/admin/events/:eventId/revoke-all-checkins", () => {
  it("revokes every admitted attendee and returns revokedCount", async () => {
    const [a, b] = await Promise.all([
      prisma.attendee.create({
        data: {
          event_id: EVENT_REVOKE,
          email: "revoke-checkin-a@example.com",
          name: "Revoke Checkin A",
          admitted_at: new Date(),
        },
      }),
      prisma.attendee.create({
        data: {
          event_id: EVENT_REVOKE,
          email: "revoke-checkin-b@example.com",
          name: "Revoke Checkin B",
          admitted_at: new Date(),
        },
      }),
    ]);

    const res = await app.request(`/api/admin/events/${EVENT_REVOKE}/revoke-all-checkins`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { revokedCount: number };
    expect(body.revokedCount).toBe(2);

    const [refetchedA, refetchedB] = await Promise.all([
      prisma.attendee.findUnique({ where: { id: a.id } }),
      prisma.attendee.findUnique({ where: { id: b.id } }),
    ]);
    expect(refetchedA?.admitted_at).toBeNull();
    expect(refetchedB?.admitted_at).toBeNull();
  });

  it("writes audit log with eventId and revokedCount", async () => {
    await app.request(`/api/admin/events/${EVENT_REVOKE}/revoke-all-checkins`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin },
    });

    const log = await prisma.adminAuditLog.findFirst({
      where: { organization_id: ORG_REVOKE, action_type: "event_checkins_bulk_revoked" },
    });
    expect(log).not.toBeNull();
    const meta = log?.metadata as Record<string, unknown>;
    expect(meta?.eventId).toBe(EVENT_REVOKE);
    expect(typeof meta?.revokedCount).toBe("number");
  });

  it("rejects non-superadmin (org admin) with 403", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_REVOKE}/revoke-all-checkins`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin },
    });
    expect(res.status).toBe(403);
  });

  it("rejects missing CSRF header", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_REVOKE}/revoke-all-checkins`, {
      method: "POST",
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("returns 403 event_archived for an archived event", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_REVOKE_ARCHIVED}/revoke-all-checkins`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("event_archived");
  });

  it("returns revokedCount: 0 for a non-existent event (matches canManageEvent superadmin short-circuit)", async () => {
    const res = await app.request(`/api/admin/events/does-not-exist/revoke-all-checkins`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { revokedCount: number };
    expect(body.revokedCount).toBe(0);
  });
});

describe("POST /api/admin/events/:eventId/revoke-all-items", () => {
  it("resets every issued/returned item and returns revokedCount (item-row count)", async () => {
    const [c, d] = await Promise.all([
      prisma.attendee.create({
        data: { event_id: EVENT_REVOKE, email: "revoke-item-c@example.com", name: "Revoke Item C" },
      }),
      prisma.attendee.create({
        data: { event_id: EVENT_REVOKE, email: "revoke-item-d@example.com", name: "Revoke Item D" },
      }),
    ]);
    await prisma.attendeeItemState.createMany({
      data: [
        { attendee_id: c.id, event_item_id: ITEM_REVOKE, state: "issued" },
        { attendee_id: d.id, event_item_id: ITEM_REVOKE, state: "returned" },
      ],
    });

    const res = await app.request(`/api/admin/events/${EVENT_REVOKE}/revoke-all-items`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { revokedCount: number };
    expect(body.revokedCount).toBe(2);

    const [stateC, stateD] = await Promise.all([
      prisma.attendeeItemState.findUnique({
        where: { attendee_id_event_item_id: { attendee_id: c.id, event_item_id: ITEM_REVOKE } },
      }),
      prisma.attendeeItemState.findUnique({
        where: { attendee_id_event_item_id: { attendee_id: d.id, event_item_id: ITEM_REVOKE } },
      }),
    ]);
    expect(stateC?.state).toBe("pending");
    expect(stateD?.state).toBe("pending");
  });

  it("writes audit log with eventId and revokedCount", async () => {
    await app.request(`/api/admin/events/${EVENT_REVOKE}/revoke-all-items`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin },
    });

    const log = await prisma.adminAuditLog.findFirst({
      where: { organization_id: ORG_REVOKE, action_type: "event_items_bulk_revoked" },
    });
    expect(log).not.toBeNull();
    const meta = log?.metadata as Record<string, unknown>;
    expect(meta?.eventId).toBe(EVENT_REVOKE);
    expect(typeof meta?.revokedCount).toBe("number");
  });

  it("rejects non-superadmin (org admin) with 403", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_REVOKE}/revoke-all-items`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin },
    });
    expect(res.status).toBe(403);
  });

  it("rejects missing CSRF header", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_REVOKE}/revoke-all-items`, {
      method: "POST",
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("returns 403 event_archived for an archived event", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_REVOKE_ARCHIVED}/revoke-all-items`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("event_archived");
  });
});
