import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createSession, hashPassword, SESSION_STAGE } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { encryptToString } from "@admitto/crypto";
import { generateToken, hashToken } from "@admitto/tickets";
import { createApp } from "../../src/app.js";
import { createRateLimitStore } from "../../src/rate-limit/index.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };

const ORG_SET = "org-event-settings";
const EVENT_SET = "evt-event-settings";
const EVENT_ARCHIVED = "evt-event-settings-archived";
const ATT_SET = "att-event-settings-1";
const ITEM_SET = "item-event-settings-1";

const EMAIL_SUPER = "event-settings-super@example.com";
const EMAIL_ADMIN = "event-settings-admin@example.com";
const EMAIL_OP = "event-settings-op@example.com";
const PASSWORD = "event-settings-pass-123";

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let superId: string;
let adminId: string;
let opId: string;
let superCookie = "";
let adminCookie = "";
let opCookie = "";

async function seed(client: PrismaClient) {
  await client.adminAuditLog.deleteMany({ where: { organization_id: ORG_SET } });
  await client.attendeeActionLog.deleteMany({ where: { event_id: { in: [EVENT_SET, EVENT_ARCHIVED] } } });
  await client.attendee.deleteMany({ where: { event_id: { in: [EVENT_SET, EVENT_ARCHIVED] } } });
  await client.eventItem.deleteMany({ where: { event_id: { in: [EVENT_SET, EVENT_ARCHIVED] } } });
  await client.roleAssignment.deleteMany({
    where: { OR: [{ scope_id: { in: [ORG_SET, EVENT_SET, EVENT_ARCHIVED] } }] },
  });
  await client.session.deleteMany({
    where: { user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN, EMAIL_OP] } } },
  });
  await client.userMfaMethod.deleteMany({
    where: { user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN] } } },
  });
  await client.user.deleteMany({ where: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN, EMAIL_OP] } } });
  await client.event.deleteMany({ where: { id: { in: [EVENT_SET, EVENT_ARCHIVED] } } });
  await client.organization.deleteMany({ where: { id: ORG_SET } });

  const password_hash = await hashPassword(PASSWORD);

  await client.organization.create({
    data: { id: ORG_SET, name: "Settings Org", slug: "event-settings-org" },
  });

  await client.event.createMany({
    data: [
      {
        id: EVENT_SET,
        title: "Settings Event",
        slug: "event-settings",
        date: new Date("2026-10-01T12:00:00.000Z"),
        location: "Warsaw",
        organization_id: ORG_SET,
      },
      {
        id: EVENT_ARCHIVED,
        title: "Archived Settings Event",
        slug: "event-settings-archived",
        date: new Date("2026-11-01T12:00:00.000Z"),
        organization_id: ORG_SET,
        archived_at: new Date(),
      },
    ],
  });

  await client.eventItem.create({
    data: {
      id: ITEM_SET,
      event_id: EVENT_SET,
      key: "badge",
      label: "Badge",
      enabled: true,
    },
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
      { user_id: adminId, role: "admin", scope_type: "organization", scope_id: ORG_SET },
      { user_id: opId, role: "operator", scope_type: "event", scope_id: EVENT_SET },
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
      id: ATT_SET,
      event_id: EVENT_SET,
      email: "pii-guest@example.com",
      name: "PII Guest",
      company: "Acme",
      token_hash: hashToken(token),
      token_enc: encryptToString(token),
      status: "active",
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
  await prisma.adminAuditLog.deleteMany({ where: { organization_id: ORG_SET } });
  await prisma.event.update({
    where: { id: EVENT_SET },
    data: {
      title: "Settings Event",
      date: new Date("2026-10-01T12:00:00.000Z"),
      location: "Warsaw",
      capacity: null,
      archived_at: null,
    },
  });
});

afterAll(async () => {
  await prisma?.$disconnect();
});

describe("event settings schema", () => {
  it("has nullable capacity on existing events", async () => {
    const event = await prisma.event.findUniqueOrThrow({ where: { id: EVENT_SET } });
    expect(event.capacity).toBeNull();
  });
});

describe("GET /api/admin/events/:eventId/settings", () => {
  it("returns 401 without auth", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_SET}/settings`);
    expect(res.status).toBe(401);
  });

  it("returns 403 for operator", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_SET}/settings`, {
      headers: { Cookie: opCookie },
    });
    expect(res.status).toBe(403);
  });

  it("returns 200 with full settings shape for org admin", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_SET}/settings`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      title: string;
      slug: string;
      date: string;
      location: string | null;
      capacity: number | null;
      status: string;
      organization_name: string;
      active_items: { id: string; name: string; enabled: boolean }[];
    };
    expect(body.id).toBe(EVENT_SET);
    expect(body.title).toBe("Settings Event");
    expect(body.slug).toBe("event-settings");
    expect(body.location).toBe("Warsaw");
    expect(body.capacity).toBeNull();
    expect(body.status).toBe("active");
    expect(body.organization_name).toBe("Settings Org");
    expect(body.active_items.some((i) => i.id === ITEM_SET && i.name === "Badge")).toBe(true);
  });
});

describe("PATCH /api/admin/events/:eventId", () => {
  it("returns 401 without auth", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_SET}`, {
      method: "PATCH",
      headers: { ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Hack" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 for operator", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_SET}`, {
      method: "PATCH",
      headers: { Cookie: opCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Hack" }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 403 event_archived when event is archived", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_ARCHIVED}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New title" }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("event_archived");
  });

  it("updates title and writes AdminAuditLog", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_SET}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Renamed Event" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { event: { title: string; slug: string } };
    expect(body.event.title).toBe("Renamed Event");
    expect(body.event.slug).toBe("event-settings");

    const audit = await prisma.adminAuditLog.findFirst({
      where: { organization_id: ORG_SET, action_type: "event_updated" },
    });
    expect(audit).not.toBeNull();
    const meta = audit!.metadata as { eventId?: string; fields?: string[] };
    expect(meta.eventId).toBe(EVENT_SET);
    expect(meta.fields).toContain("title");
  });

  it("updates capacity and clears capacity with null", async () => {
    const setRes = await app.request(`/api/admin/events/${EVENT_SET}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ capacity: 500 }),
    });
    expect(setRes.status).toBe(200);
    const setBody = (await setRes.json()) as { event: { capacity: number | null } };
    expect(setBody.event.capacity).toBe(500);

    const clearRes = await app.request(`/api/admin/events/${EVENT_SET}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ capacity: null }),
    });
    expect(clearRes.status).toBe(200);
    const clearBody = (await clearRes.json()) as { event: { capacity: number | null } };
    expect(clearBody.event.capacity).toBeNull();
  });

  it("returns 400 when slug is sent (strict schema)", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_SET}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ slug: "hacked-slug" }),
    });
    expect(res.status).toBe(400);

    const event = await prisma.event.findUniqueOrThrow({ where: { id: EVENT_SET } });
    expect(event.slug).toBe("event-settings");
  });
});

describe("GET /api/admin/events/:eventId/export-pii", () => {
  it("returns 403 for org admin", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_SET}/export-pii`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(403);
  });

  it("returns CSV attachment for superadmin and writes audit log", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_SET}/export-pii`, {
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
    expect(res.headers.get("Content-Disposition")).toContain("pii-export-event-settings");

    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    expect(bytes[0]).toBe(0xef);
    expect(bytes[1]).toBe(0xbb);
    expect(bytes[2]).toBe(0xbf);

    const text = new TextDecoder("utf-8").decode(buf);
    expect(text).toContain("pii-guest@example.com");
    expect(text).toContain("PII Guest");

    const audit = await prisma.adminAuditLog.findFirst({
      where: { organization_id: ORG_SET, action_type: "event_pii_exported" },
    });
    expect(audit).not.toBeNull();
    const meta = audit!.metadata as { eventId?: string; rowCount?: number };
    expect(meta.eventId).toBe(EVENT_SET);
    expect(meta.rowCount).toBeGreaterThan(0);
  });
});
