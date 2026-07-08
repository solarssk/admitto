import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createSession, hashPassword, SESSION_STAGE } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { createApp } from "../../src/app.js";
import { createRateLimitStore } from "../../src/rate-limit/index.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };

const ORG_CREATE = "org-create-event";
const ORG_OTHER = "org-create-event-other";
const EVENT_EXISTING = "evt-create-event-existing";

const EMAIL_SUPER = "create-event-super@example.com";
const EMAIL_ADMIN = "create-event-admin@example.com";
const EMAIL_OP = "create-event-op@example.com";
const PASSWORD = "create-event-pass-123";

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let superId: string;
let adminId: string;
let opId: string;
let superCookie = "";
let adminCookie = "";
let opCookie = "";
let prevInstanceOrgId: string | undefined;

async function seed(client: PrismaClient) {
  await client.adminAuditLog.deleteMany({
    where: { organization_id: { in: [ORG_CREATE, ORG_OTHER] } },
  });
  await client.roleAssignment.deleteMany({
    where: { OR: [{ scope_id: { in: [ORG_CREATE, ORG_OTHER, EVENT_EXISTING] } }] },
  });
  await client.session.deleteMany({
    where: { user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN, EMAIL_OP] } } },
  });
  await client.userMfaMethod.deleteMany({
    where: { user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN] } } },
  });
  await client.user.deleteMany({ where: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN, EMAIL_OP] } } });
  await client.event.deleteMany({ where: { organization_id: { in: [ORG_CREATE, ORG_OTHER] } } });
  await client.organization.deleteMany({ where: { id: { in: [ORG_CREATE, ORG_OTHER] } } });

  const password_hash = await hashPassword(PASSWORD);

  await client.organization.createMany({
    data: [
      { id: ORG_CREATE, name: "Create Event Org", slug: "create-event-org" },
      { id: ORG_OTHER, name: "Other Org", slug: "create-event-other" },
    ],
  });

  await client.event.create({
    data: {
      id: EVENT_EXISTING,
      title: "Existing Event",
      slug: "taken_slug",
      date: new Date("2026-09-01"),
      organization_id: ORG_CREATE,
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
      { user_id: adminId, role: "admin", scope_type: "organization", scope_id: ORG_CREATE },
      { user_id: opId, role: "operator", scope_type: "event", scope_id: EVENT_EXISTING },
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
  process.env.INSTANCE_ORG_ID = ORG_CREATE;

  prisma = new PrismaClient();
  await seed(prisma);
  app = createApp({
    prisma,
    checkinToken: "create-event-checkin-token-32chars!!",
    allowCheckinBearer: true,
    baseUrl: "https://tickets.example.com",
    rateLimitStore: createRateLimitStore(),
    skipCheckinBootValidation: true,
    adminDistRoot,
  });
  superCookie = await sessionCookieFor(superId);
  adminCookie = await sessionCookieFor(adminId);
  opCookie = await sessionCookieFor(opId);
});

afterAll(async () => {
  if (prevInstanceOrgId !== undefined) process.env.INSTANCE_ORG_ID = prevInstanceOrgId;
  else delete process.env.INSTANCE_ORG_ID;
  await prisma?.$disconnect();
});

async function sessionCookieFor(userId: string): Promise<string> {
  const { rawToken } = await createSession(prisma, { userId, stage: SESSION_STAGE.FULL });
  return `admitto_session=${rawToken}`;
}

async function postCreateEvent(
  cookie: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return app.request("/api/admin/events", {
    method: "POST",
    headers: {
      Cookie: cookie,
      ...sameOrigin,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  await prisma.adminAuditLog.deleteMany({
    where: { organization_id: ORG_CREATE, action_type: "event_created" },
  });
  await prisma.event.deleteMany({
    where: {
      organization_id: ORG_CREATE,
      slug: { not: "taken_slug" },
    },
  });
});

describe("POST /api/admin/events", () => {
  it("creates event as superadmin with audit log", async () => {
    const beforeAudit = await prisma.adminAuditLog.count({
      where: { organization_id: ORG_CREATE, action_type: "event_created" },
    });

    const res = await postCreateEvent(superCookie, {
      title: "Autumn Summit 2026",
      slug: "autumn-summit-2026",
      date: "2026-09-29",
      timezone: "UTC",
      location: "Convention Center, Warsaw",
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      event: {
        id: string;
        title: string;
        slug: string;
        organization_id: string;
      };
    };
    expect(body.event.title).toBe("Autumn Summit 2026");
    expect(body.event.slug).toBe("autumn-summit-2026");
    expect(body.event.organization_id).toBe(ORG_CREATE);

    const row = await prisma.event.findUnique({ where: { id: body.event.id } });
    expect(row?.location).toBe("Convention Center, Warsaw");

    const afterAudit = await prisma.adminAuditLog.count({
      where: { organization_id: ORG_CREATE, action_type: "event_created" },
    });
    expect(afterAudit).toBe(beforeAudit + 1);
  });

  it("creates event with zero event items", async () => {
    const res = await postCreateEvent(superCookie, {
      title: "Items Empty",
      slug: "items-empty-event",
      date: "2026-09-29",
      timezone: "UTC",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { event: { id: string } };

    const items = await prisma.eventItem.findMany({ where: { event_id: body.event.id } });
    expect(items).toHaveLength(0);
  });

  it("creates event as org admin in own organization", async () => {
    const res = await postCreateEvent(adminCookie, {
      title: "Admin Created",
      slug: "admin-created-event",
      date: "2026-10-15",
      timezone: "UTC",
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { event: { organization_id: string; slug: string } };
    expect(body.event.organization_id).toBe(ORG_CREATE);
    expect(body.event.slug).toBe("admin-created-event");
  });

  it("returns 403 for operator", async () => {
    const res = await postCreateEvent(opCookie, {
      title: "Blocked",
      slug: "blocked-event",
      date: "2026-10-15",
      timezone: "UTC",
    });
    expect(res.status).toBe(403);
  });

  it("returns 409 when slug is taken", async () => {
    const res = await postCreateEvent(superCookie, {
      title: "Duplicate",
      slug: "taken_slug",
      date: "2026-10-15",
      timezone: "UTC",
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; error: string };
    expect(body.code).toBe("slug_taken");
    expect(body.error).toBe("Slug is already in use.");
  });

  it("returns 400 for invalid slug", async () => {
    const res = await postCreateEvent(superCookie, {
      title: "Bad Slug",
      slug: "INVALID",
      date: "2026-10-15",
      timezone: "UTC",
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for empty title", async () => {
    const res = await postCreateEvent(superCookie, {
      title: "   ",
      slug: "valid-slug",
      date: "2026-10-15",
      timezone: "UTC",
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for impossible calendar date", async () => {
    const res = await postCreateEvent(superCookie, {
      title: "Bad Date",
      slug: "bad-date",
      date: "2026-02-30",
      timezone: "UTC",
    });
    expect(res.status).toBe(400);
  });

  it("creates event with explicit timezone", async () => {
    const res = await postCreateEvent(superCookie, {
      title: "Tokyo Summit",
      slug: "tokyo-summit",
      date: "2026-09-01",
      timezone: "Asia/Tokyo",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { event: { id: string; timezone: string } };
    expect(body.event.timezone).toBe("Asia/Tokyo");

    const row = await prisma.event.findUniqueOrThrow({ where: { id: body.event.id } });
    expect(row.timezone).toBe("Asia/Tokyo");
  });

  it("accepts IANA alias canonicalized by ICU (Asia/Kolkata)", async () => {
    const res = await postCreateEvent(superCookie, {
      title: "Kolkata Summit",
      slug: "kolkata-summit",
      date: "2026-09-01",
      timezone: "Asia/Kolkata",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { event: { timezone: string } };
    expect(body.event.timezone).toBe("Asia/Kolkata");
  });

  it("returns 400 when timezone is missing", async () => {
    const res = await postCreateEvent(superCookie, {
      title: "Default TZ Event",
      slug: "default-tz-event",
      date: "2026-09-02",
    });
    expect(res.status).toBe(400);

    const row = await prisma.event.findFirst({ where: { slug: "default-tz-event" } });
    expect(row).toBeNull();
  });

  it("rejects invalid IANA timezone", async () => {
    const res = await postCreateEvent(superCookie, {
      title: "Bad TZ",
      slug: "bad-tz",
      date: "2026-09-03",
      timezone: "Mars/Olympus",
    });
    expect(res.status).toBe(400);

    const row = await prisma.event.findFirst({ where: { slug: "bad-tz" } });
    expect(row).toBeNull();
  });

  it("rejects offset-style timezone strings", async () => {
    const res = await postCreateEvent(superCookie, {
      title: "Offset TZ",
      slug: "offset-tz",
      date: "2026-09-04",
      timezone: "+05:30",
    });
    expect(res.status).toBe(400);

    const row = await prisma.event.findFirst({ where: { slug: "offset-tz" } });
    expect(row).toBeNull();
  });
});
