import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createSession, hashPassword, SESSION_STAGE } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { encryptToString } from "@admitto/crypto";
import { generateToken, hashToken } from "@admitto/tickets";
import { createApp } from "../../src/app.js";
import { createRateLimitStore } from "../../src/rate-limit/index.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };

const ORG_ARCH = "org-event-archiving";
const ORG_OTHER = "org-event-archiving-other";
const EVENT_ARCH = "evt-event-archiving";
const EVENT_OTHER = "evt-event-archiving-other";
const ATT_ARCH = "att-event-archiving-1";

const EMAIL_SUPER = "event-archiving-super@example.com";
const EMAIL_ADMIN = "event-archiving-admin@example.com";
const EMAIL_OP = "event-archiving-op@example.com";
const PASSWORD = "event-archiving-pass-123";

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let superId: string;
let adminId: string;
let opId: string;
let superCookie = "";
let adminCookie = "";
let opCookie = "";

async function seed(client: PrismaClient) {
  await client.adminAuditLog.deleteMany({ where: { organization_id: ORG_ARCH } });
  await client.attendee.deleteMany({ where: { event_id: EVENT_ARCH } });
  await client.roleAssignment.deleteMany({
    where: { OR: [{ scope_id: { in: [ORG_ARCH, ORG_OTHER, EVENT_ARCH, EVENT_OTHER] } }] },
  });
  await client.session.deleteMany({
    where: { user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN, EMAIL_OP] } } },
  });
  await client.userMfaMethod.deleteMany({
    where: { user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN] } } },
  });
  await client.user.deleteMany({ where: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN, EMAIL_OP] } } });
  await client.event.deleteMany({ where: { id: { in: [EVENT_ARCH, EVENT_OTHER] } } });
  await client.organization.deleteMany({ where: { id: { in: [ORG_ARCH, ORG_OTHER] } } });

  const password_hash = await hashPassword(PASSWORD);

  await client.organization.createMany({
    data: [
      { id: ORG_ARCH, name: "Archiving Org", slug: "event-archiving-org" },
      { id: ORG_OTHER, name: "Other Org", slug: "event-archiving-other" },
    ],
  });

  await client.event.createMany({
    data: [
      {
        id: EVENT_ARCH,
        title: "Archiving Event",
        slug: "event-archiving",
        date: new Date("2026-10-01"),
        organization_id: ORG_ARCH,
      },
      {
        id: EVENT_OTHER,
        title: "Other Org Archived Event",
        slug: "event-archiving-other",
        date: new Date("2026-11-01"),
        organization_id: ORG_OTHER,
        archived_at: new Date(),
      },
    ],
  });

  const superUser = await client.user.create({ data: { email: EMAIL_SUPER, password_hash } });
  const adminUser = await client.user.create({ data: { email: EMAIL_ADMIN, password_hash } });
  const opUser = await client.user.create({ data: { email: EMAIL_OP, password_hash } });
  superId = superUser.id;
  adminId = adminUser.id;
  opId = opUser.id;

  await client.roleAssignment.createMany({
    data: [
      { user_id: superId, role: "superadmin", scope_type: "instance", scope_id: null },
      { user_id: adminId, role: "admin", scope_type: "organization", scope_id: ORG_ARCH },
      { user_id: opId, role: "operator", scope_type: "event", scope_id: EVENT_ARCH },
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

  const token = generateToken();
  await client.attendee.create({
    data: {
      id: ATT_ARCH,
      event_id: EVENT_ARCH,
      email: "guest@example.com",
      name: "Guest",
      token_hash: hashToken(token),
      token_enc: encryptToString(token),
      status: "registered",
    },
  });
}

beforeAll(async () => {
  prisma = new PrismaClient();
  await seed(prisma);
  app = createApp({
    prisma,
    rateLimitStore: createRateLimitStore(),
    skipCheckinBootValidation: true,
    adminDistRoot,
  });

  const superSession = await createSession(prisma, { userId: superId, stage: SESSION_STAGE.FULL });
  const adminSession = await createSession(prisma, { userId: adminId, stage: SESSION_STAGE.FULL });
  const opSession = await createSession(prisma, { userId: opId, stage: SESSION_STAGE.FULL });
  superCookie = `admitto_session=${superSession.rawToken}`;
  adminCookie = `admitto_session=${adminSession.rawToken}`;
  opCookie = `admitto_session=${opSession.rawToken}`;
});

afterEach(async () => {
  await prisma.adminAuditLog.deleteMany({ where: { organization_id: ORG_ARCH } });
  await prisma.event.update({
    where: { id: EVENT_ARCH },
    data: { archived_at: null },
  });
});

afterAll(async () => {
  await prisma?.$disconnect();
});

describe("event archiving schema", () => {
  it("has nullable archived_at on existing events", async () => {
    const event = await prisma.event.findUniqueOrThrow({ where: { id: EVENT_ARCH } });
    expect(event.archived_at).toBeNull();
  });
});

describe("POST /api/admin/events/:eventId/archive", () => {
  it("archives event and writes AdminAuditLog", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_ARCH}/archive`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(200);

    const event = await prisma.event.findUniqueOrThrow({ where: { id: EVENT_ARCH } });
    expect(event.archived_at).not.toBeNull();

    const audit = await prisma.adminAuditLog.findFirst({
      where: { organization_id: ORG_ARCH, action_type: "event_archived" },
    });
    expect(audit).not.toBeNull();
    expect(audit!.actor_user_id).toBe(superId);
    const meta = audit!.metadata as { eventId?: string };
    expect(meta.eventId).toBe(EVENT_ARCH);
  });

  it("returns 409 when already archived", async () => {
    await prisma.event.update({
      where: { id: EVENT_ARCH },
      data: { archived_at: new Date() },
    });

    const res = await app.request(`/api/admin/events/${EVENT_ARCH}/archive`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("already_archived");

    const auditCount = await prisma.adminAuditLog.count({
      where: { organization_id: ORG_ARCH, action_type: "event_archived" },
    });
    expect(auditCount).toBe(0);
  });

  it("rejects org admin", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_ARCH}/archive`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(403);
  });

  it("rejects missing CSRF origin", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_ARCH}/archive`, {
      method: "POST",
      headers: { Cookie: superCookie, "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/admin/events/:eventId/unarchive", () => {
  it("clears archived_at and writes AdminAuditLog", async () => {
    await prisma.event.update({
      where: { id: EVENT_ARCH },
      data: { archived_at: new Date() },
    });

    const res = await app.request(`/api/admin/events/${EVENT_ARCH}/unarchive`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(200);

    const event = await prisma.event.findUniqueOrThrow({ where: { id: EVENT_ARCH } });
    expect(event.archived_at).toBeNull();

    const audit = await prisma.adminAuditLog.findFirst({
      where: { organization_id: ORG_ARCH, action_type: "event_unarchived" },
    });
    expect(audit).not.toBeNull();
    expect(audit!.actor_user_id).toBe(superId);
    const meta = audit!.metadata as { eventId?: string };
    expect(meta.eventId).toBe(EVENT_ARCH);
  });

  it("rejects org admin", async () => {
    await prisma.event.update({
      where: { id: EVENT_ARCH },
      data: { archived_at: new Date() },
    });

    const res = await app.request(`/api/admin/events/${EVENT_ARCH}/unarchive`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(403);
  });

  it("rejects missing CSRF origin", async () => {
    await prisma.event.update({
      where: { id: EVENT_ARCH },
      data: { archived_at: new Date() },
    });

    const res = await app.request(`/api/admin/events/${EVENT_ARCH}/unarchive`, {
      method: "POST",
      headers: { Cookie: superCookie, "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(403);
  });

  it("returns 409 not_archived without audit when event is already active", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_ARCH}/unarchive`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("not_archived");

    const audit = await prisma.adminAuditLog.findFirst({
      where: { organization_id: ORG_ARCH, action_type: "event_unarchived" },
    });
    expect(audit).toBeNull();
  });
});

describe("check-in on archived events (intentional, ADR 0022)", () => {
  it("still lists archived event for operator check-in picker", async () => {
    await prisma.event.update({
      where: { id: EVENT_ARCH },
      data: { archived_at: new Date() },
    });

    const res = await app.request("/api/checkin/events", {
      headers: { Cookie: opCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: Array<{ id: string }> };
    expect(body.events.map((e) => e.id)).toContain(EVENT_ARCH);
  });
});

describe("GET /api/admin/events includeArchived", () => {
  it("excludes archived events by default", async () => {
    await prisma.event.update({
      where: { id: EVENT_ARCH },
      data: { archived_at: new Date() },
    });

    const res = await app.request("/api/admin/events", {
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: Array<{ id: string }> };
    expect(body.events.some((e) => e.id === EVENT_ARCH)).toBe(false);
  });

  it("includes archived events with archived_at when includeArchived=true", async () => {
    const archivedAt = new Date("2026-06-01T12:00:00.000Z");
    await prisma.event.update({
      where: { id: EVENT_ARCH },
      data: { archived_at: archivedAt },
    });

    const res = await app.request("/api/admin/events?includeArchived=true", {
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      events: Array<{ id: string; archived_at: string | null }>;
    };
    const found = body.events.find((e) => e.id === EVENT_ARCH);
    expect(found).toBeDefined();
    expect(found!.archived_at).toBe(archivedAt.toISOString());
  });
});

describe("read-only guard on archived events", () => {
  beforeEach(async () => {
    await prisma.event.update({
      where: { id: EVENT_ARCH },
      data: { archived_at: new Date() },
    });
  });

  it("blocks PATCH attendee with event_archived", async () => {
    const before = await prisma.attendee.findUniqueOrThrow({ where: { id: ATT_ARCH } });
    const res = await app.request(`/api/admin/events/${EVENT_ARCH}/attendees/${ATT_ARCH}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Blocked",
        expected_updated_at: before.updated_at.toISOString(),
      }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("event_archived");

    const after = await prisma.attendee.findUniqueOrThrow({ where: { id: ATT_ARCH } });
    expect(after.name).toBe(before.name);
    expect(after.updated_at.getTime()).toBe(before.updated_at.getTime());
  });

  it("blocks POST items with event_archived", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_ARCH}/items`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        key: "blocked_item",
        label: "Blocked",
      }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("event_archived");
  });

  it("returns forbidden (not event_archived) for cross-org archived event probe", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_OTHER}/items`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        key: "probe_item",
        label: "Probe",
      }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: string; code?: string };
    expect(body.error).toBe("forbidden");
    expect(body.code).toBeUndefined();
  });
});
