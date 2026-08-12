import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient, Prisma } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { createSession, hashPassword, SESSION_STAGE } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { createApp } from "../../src/app.js";
import { createRateLimitStore } from "../../src/rate-limit/index.js";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";

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

  prisma = createTestPrismaClient();
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
    resetSystemLogBufferForTest();
    const beforeAudit = await prisma.adminAuditLog.count({
      where: { organization_id: ORG_CREATE, action_type: "event_created" },
    });

    const res = await postCreateEvent(superCookie, {
      title: "Autumn Summit 2026",
      slug: "autumn-summit-2026",
      date: "2026-09-29",
      timezone: "UTC",
      venue_name: "Convention Center, Warsaw",
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      event: {
        id: string;
        title: string;
        slug: string;
        organization_id: string;
        location: string | null;
      };
    };
    expect(body.event.title).toBe("Autumn Summit 2026");
    expect(body.event.slug).toBe("autumn-summit-2026");
    expect(body.event.organization_id).toBe(ORG_CREATE);
    expect(body.event.location).toBe("Convention Center, Warsaw");

    const row = await prisma.event.findUnique({
      where: { id: body.event.id },
      include: { location_details: true },
    });
    expect(row?.location_details?.venue_name).toBe("Convention Center, Warsaw");
    expect(row?.created_by_user_id).toBe(superId);

    const afterAudit = await prisma.adminAuditLog.count({
      where: { organization_id: ORG_CREATE, action_type: "event_created" },
    });
    expect(afterAudit).toBe(beforeAudit + 1);

    const [entry] = querySystemLogs({ source: "admin", search: "event_created" });
    expect(entry).toMatchObject({
      level: "info",
      source: "admin",
      message: "event_created",
      fields: { eventId: body.event.id, orgId: ORG_CREATE, actorUserId: superId, actorEmail: EMAIL_SUPER },
    });
    expect(JSON.stringify(entry)).not.toContain("Autumn Summit 2026");
  });

  it("creates a geocoded EventLocation row from the selected location fields", async () => {
    const res = await postCreateEvent(superCookie, {
      title: "Geocoded Event",
      slug: "geocoded-event",
      date: "2026-09-29",
      timezone: "UTC",
      venue_name: "Convention Center",
      formatted_address: "1 Example Street, Warsaw",
      latitude: 52.2297,
      longitude: 21.0122,
      geocoding_provider: "nominatim",
    });
    expect(res.status).toBe(201);
    const { event } = (await res.json()) as { event: { id: string } };

    const location = await prisma.eventLocation.findUnique({ where: { event_id: event.id } });
    expect(location).toMatchObject({
      venue_name: "Convention Center",
      formatted_address: "1 Example Street, Warsaw",
      latitude: 52.2297,
      longitude: 21.0122,
      geocoding_provider: "nominatim",
    });
    expect(location?.geocoded_at).toBeInstanceOf(Date);
  });

  it("stores coordinates without a geocoding_provider when none was selected", async () => {
    const res = await postCreateEvent(superCookie, {
      title: "Pin Only Event",
      slug: "pin-only-event",
      date: "2026-09-29",
      timezone: "UTC",
      latitude: 52.2297,
      longitude: 21.0122,
    });
    expect(res.status).toBe(201);
    const { event } = (await res.json()) as { event: { id: string } };

    const location = await prisma.eventLocation.findUnique({ where: { event_id: event.id } });
    expect(location).toMatchObject({
      latitude: 52.2297,
      longitude: 21.0122,
      geocoding_provider: null,
    });
    expect(location?.geocoded_at).toBeInstanceOf(Date);
  });

  it("treats a blank geocoding_provider as null when coordinates are set", async () => {
    const res = await postCreateEvent(superCookie, {
      title: "Blank Provider Event",
      slug: "blank-provider-event",
      date: "2026-09-29",
      timezone: "UTC",
      latitude: 52.2297,
      longitude: 21.0122,
      geocoding_provider: "   ",
    });
    expect(res.status).toBe(201);
    const { event } = (await res.json()) as { event: { id: string } };

    const location = await prisma.eventLocation.findUnique({ where: { event_id: event.id } });
    expect(location?.geocoding_provider).toBeNull();
    expect(location?.geocoded_at).toBeInstanceOf(Date);
  });

  it("rejects create when only one coordinate is provided", async () => {
    const res = await postCreateEvent(superCookie, {
      title: "Half Pin Event",
      slug: "half-pin-event",
      date: "2026-09-29",
      timezone: "UTC",
      latitude: 52.2297,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/latitude|longitude|coordinate/i);
  });

  it("creates a location row for an address-only event", async () => {
    const res = await postCreateEvent(superCookie, {
      title: "Address Only Event",
      slug: "address-only-event",
      date: "2026-09-29",
      timezone: "UTC",
      formatted_address: "1 Example Street, Warsaw",
    });
    expect(res.status).toBe(201);
    const { event } = (await res.json()) as { event: { id: string } };

    const location = await prisma.eventLocation.findUnique({ where: { event_id: event.id } });
    expect(location?.formatted_address).toBe("1 Example Street, Warsaw");
    expect(location?.venue_name).toBeNull();
  });

  it("does not create a location row for a blank venue without address or coordinates", async () => {
    const res = await postCreateEvent(superCookie, {
      title: "No Location Event",
      slug: "no-location-event",
      date: "2026-09-29",
      timezone: "UTC",
      venue_name: "   ",
    });
    expect(res.status).toBe(201);
    const { event } = (await res.json()) as { event: { id: string } };

    expect(await prisma.eventLocation.findUnique({ where: { event_id: event.id } })).toBeNull();
  });

  it("records a safe System-log category when the create transaction fails", async () => {
    resetSystemLogBufferForTest();
    const spy = vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(new Error("database secret"));
    try {
      const res = await postCreateEvent(superCookie, {
        title: "Private event title",
        slug: "failing-event",
        date: "2026-09-29",
        timezone: "UTC",
      });
      expect(res.status).toBe(500);
      const [entry] = querySystemLogs({ source: "admin", search: "event_created_failed" });
      expect(entry).toMatchObject({
        level: "error",
        source: "admin",
        message: "event_created_failed",
        fields: { orgId: ORG_CREATE, actorUserId: superId, errorKind: "transaction" },
      });
      expect(JSON.stringify(entry)).not.toContain("database secret");
      expect(JSON.stringify(entry)).not.toContain("Private event title");
    } finally {
      spy.mockRestore();
    }
  });

  it("creates event with only the default badge item", async () => {
    const res = await postCreateEvent(superCookie, {
      title: "Items Empty",
      slug: "items-empty-event",
      date: "2026-09-29",
      timezone: "UTC",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { event: { id: string } };

    const items = await prisma.eventItem.findMany({ where: { event_id: body.event.id } });
    expect(items).toHaveLength(1);
    expect(items[0]?.key).toBe("badge");
  });

  it("creates event as org admin in own organization", async () => {
    const res = await postCreateEvent(adminCookie, {
      title: "Admin Created",
      slug: "admin-created-event",
      date: "2026-10-15",
      timezone: "UTC",
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { event: { id: string; organization_id: string; slug: string } };
    expect(body.event.organization_id).toBe(ORG_CREATE);
    expect(body.event.slug).toBe("admin-created-event");

    const row = await prisma.event.findUniqueOrThrow({ where: { id: body.event.id } });
    expect(row.created_by_user_id).toBe(adminId);
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

  it("returns 409 when a concurrent create races on slug (P2002)", async () => {
    const spy = vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
      }),
    );
    try {
      const res = await postCreateEvent(superCookie, {
        title: "Race Event",
        slug: "race-slug-event",
        date: "2026-09-29",
        timezone: "UTC",
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        code: "slug_taken",
        error: "Slug is already in use.",
      });
    } finally {
      spy.mockRestore();
    }
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

  it("stores a legacy IANA alias using the preferred identifier", async () => {
    const res = await postCreateEvent(superCookie, {
      title: "Legacy Kolkata Summit",
      slug: "legacy-kolkata-summit",
      date: "2026-09-01",
      timezone: "Asia/Calcutta",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { event: { id: string; timezone: string } };
    expect(body.event.timezone).toBe("Asia/Kolkata");

    const row = await prisma.event.findUniqueOrThrow({ where: { id: body.event.id } });
    expect(row.timezone).toBe("Asia/Kolkata");
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
