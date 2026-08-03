import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { createSession, hashPassword, SESSION_STAGE } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { encryptToString } from "@admitto/crypto";
import { generateToken, hashToken } from "@admitto/tickets";
import { createApp } from "../../src/app.js";
import { InMemoryRateLimitStore } from "../../src/rate-limit/index.js";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };

const ORG_SET = "org-event-settings";
const ORG_B = "org-event-settings-b";
const EVENT_SET = "evt-event-settings";
const EVENT_B = "evt-event-settings-b";
const EVENT_ARCHIVED = "evt-event-settings-archived";
const EVENT_ACTIVE_EMPTY = "evt-event-settings-active-empty";
const EVENT_MISSING = "evt-event-settings-missing";
const ATT_SET = "att-event-settings-1";
const ITEM_SET = "item-event-settings-1";

const EMAIL_SUPER = "event-settings-super@example.com";
const EMAIL_ADMIN = "event-settings-admin@example.com";
const EMAIL_OP = "event-settings-op@example.com";
const PASSWORD = "event-settings-pass-123";

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let rateLimitStore: InMemoryRateLimitStore;
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
    where: { OR: [{ scope_id: { in: [ORG_SET, ORG_B, EVENT_SET, EVENT_ARCHIVED, EVENT_B] } }] },
  });
  await client.session.deleteMany({
    where: { user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN, EMAIL_OP] } } },
  });
  await client.userMfaMethod.deleteMany({
    where: { user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN] } } },
  });
  await client.user.deleteMany({ where: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN, EMAIL_OP] } } });
  await client.event.deleteMany({
    where: { id: { in: [EVENT_SET, EVENT_ARCHIVED, EVENT_B, EVENT_ACTIVE_EMPTY] } },
  });
  await client.organization.deleteMany({ where: { id: { in: [ORG_SET, ORG_B] } } });

  const password_hash = await hashPassword(PASSWORD);

  await client.organization.createMany({
    data: [
      { id: ORG_SET, name: "Settings Org", slug: "event-settings-org" },
      { id: ORG_B, name: "Settings Org B", slug: "event-settings-org-b" },
    ],
  });

  await client.event.createMany({
    data: [
      {
        id: EVENT_SET,
        title: "Settings Event",
        slug: "event-settings",
        date: new Date("2026-10-01T12:00:00.000Z"),
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
      {
        id: EVENT_B,
        title: "Settings Event B",
        slug: "event-settings-b",
        date: new Date("2026-12-01T12:00:00.000Z"),
        organization_id: ORG_B,
      },
      {
        id: EVENT_ACTIVE_EMPTY,
        title: "Active Empty Settings Event",
        slug: "event-settings-active-empty",
        date: new Date("2027-01-01T12:00:00.000Z"),
        organization_id: ORG_SET,
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
      status: "registered",
    },
  });
}

beforeAll(async () => {
  prisma = createTestPrismaClient();
  await seed(prisma);
  rateLimitStore = new InMemoryRateLimitStore();
  app = createApp({
    prisma,
    rateLimitStore,
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
      timezone: "UTC",
      capacity: null,
      archived_at: null,
      logo_url: null,
      header_image_url: null,
    },
  });
  await prisma.organization.update({
    where: { id: ORG_SET },
    data: { logo_url: null, header_image_url: null },
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
      timezone: string;
      capacity: number | null;
      status: string;
      archived_at: string | null;
      created_at: string;
      is_deletable: boolean;
      organization_name: string;
      active_items: { id: string; name: string; enabled: boolean }[];
      logo_url: string | null;
      logo_original_url: string | null;
      logo_crop: unknown;
      header_image_url: string | null;
      resolved_logo_url: string | null;
      resolved_header_image_url: string | null;
      admitted_count: number;
      issued_items_count: number;
    };
    expect(body.id).toBe(EVENT_SET);
    expect(body.title).toBe("Settings Event");
    expect(body.slug).toBe("event-settings");
    expect(body.timezone).toBe("UTC");
    expect(body.capacity).toBeNull();
    expect(body.status).toBe("active");
    expect(body.archived_at).toBeNull();
    expect(new Date(body.created_at).toString()).not.toBe("Invalid Date");
    expect(body.is_deletable).toBe(false);
    expect(body.organization_name).toBe("Settings Org");
    expect(body.active_items.some((i) => i.id === ITEM_SET && i.name === "Badge")).toBe(true);
    expect(body.logo_url).toBeNull();
    expect(body.logo_original_url).toBeNull();
    expect(body.logo_crop).toBeNull();
    expect(body.header_image_url).toBeNull();
    expect(body.resolved_logo_url).toBeNull();
    expect(body.resolved_header_image_url).toBeNull();
    expect(body.admitted_count).toBe(0);
    expect(body.issued_items_count).toBe(0);
  });

  it("returns admitted_count and issued_items_count reflecting real activity", async () => {
    const admittedAttendee = await prisma.attendee.create({
      data: {
        event_id: EVENT_SET,
        email: "admitted-guest@example.com",
        name: "Admitted Guest",
        status: "registered",
        admitted_at: new Date(),
      },
    });
    await prisma.attendeeItemState.create({
      data: { attendee_id: admittedAttendee.id, event_item_id: ITEM_SET, state: "issued" },
    });

    try {
      const res = await app.request(`/api/admin/events/${EVENT_SET}/settings`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { admitted_count: number; issued_items_count: number };
      expect(body.admitted_count).toBe(1);
      expect(body.issued_items_count).toBe(1);
    } finally {
      await prisma.attendeeItemState.deleteMany({ where: { attendee_id: admittedAttendee.id } });
      await prisma.attendee.delete({ where: { id: admittedAttendee.id } });
    }
  });

  // Regression (bot review): revokeAllItemsForEvent skips a blocked-pass attendee's items via
  // the isAdmittable guard, so counting their items here would show/enable "Revoke all items
  // issued" for items the bulk action can never actually revoke, leaving the count stuck nonzero.
  it("excludes items belonging to a blocked-pass (cancelled/revoked) attendee from issued_items_count", async () => {
    const blockedAttendee = await prisma.attendee.create({
      data: {
        event_id: EVENT_SET,
        email: "blocked-pass-guest@example.com",
        name: "Blocked Pass Guest",
        status: "cancelled",
      },
    });
    await prisma.attendeeItemState.create({
      data: { attendee_id: blockedAttendee.id, event_item_id: ITEM_SET, state: "issued" },
    });

    try {
      const res = await app.request(`/api/admin/events/${EVENT_SET}/settings`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { issued_items_count: number };
      expect(body.issued_items_count).toBe(0);
    } finally {
      await prisma.attendeeItemState.deleteMany({ where: { attendee_id: blockedAttendee.id } });
      await prisma.attendee.delete({ where: { id: blockedAttendee.id } });
    }
  });

  // Regression (CodeRabbit review): same gap as issued_items_count above, for the sibling
  // count. revokeAllCheckInsForEvent's resetItems:true cascade rolls back the whole per-attendee
  // transaction (including the admitted_at clear) when it hits a blocked pass, so an
  // admitted-but-blocked attendee's check-in is never actually revoked by the bulk action even
  // though admitted_at is still set - counting them here would show/enable "Revoke all
  // check-ins" for an attendee the bulk action can never actually revoke.
  it("excludes an admitted attendee whose pass is blocked (cancelled/revoked) from admitted_count", async () => {
    const blockedAdmitted = await prisma.attendee.create({
      data: {
        event_id: EVENT_SET,
        email: "blocked-admitted-guest@example.com",
        name: "Blocked Admitted Guest",
        status: "cancelled",
        admitted_at: new Date(),
      },
    });

    try {
      const res = await app.request(`/api/admin/events/${EVENT_SET}/settings`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { admitted_count: number };
      expect(body.admitted_count).toBe(0);
    } finally {
      await prisma.attendee.delete({ where: { id: blockedAdmitted.id } });
    }
  });

  it("returns archived_at for an archived event", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_ARCHIVED}/settings`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      archived_at: string | null;
    };
    expect(body.status).toBe("archived");
    expect(body.archived_at).not.toBeNull();
  });

  it("resolves branding from the organization when the event has no override", async () => {
    await prisma.organization.update({
      where: { id: ORG_SET },
      data: {
        logo_url: "https://cdn.example.com/org-logo.png",
        header_image_url: "https://cdn.example.com/org-header.png",
      },
    });

    const res = await app.request(`/api/admin/events/${EVENT_SET}/settings`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      logo_url: string | null;
      header_image_url: string | null;
      resolved_logo_url: string | null;
      resolved_header_image_url: string | null;
    };
    expect(body.logo_url).toBeNull();
    expect(body.header_image_url).toBeNull();
    expect(body.resolved_logo_url).toBe("https://cdn.example.com/org-logo.png");
    expect(body.resolved_header_image_url).toBe("https://cdn.example.com/org-header.png");
  });

  it("prefers the event's own branding over the organization's", async () => {
    await prisma.organization.update({
      where: { id: ORG_SET },
      data: { logo_url: "https://cdn.example.com/org-logo.png" },
    });
    await prisma.event.update({
      where: { id: EVENT_SET },
      data: { logo_url: "https://cdn.example.com/event-logo.png" },
    });

    const res = await app.request(`/api/admin/events/${EVENT_SET}/settings`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      logo_url: string | null;
      resolved_logo_url: string | null;
    };
    expect(body.logo_url).toBe("https://cdn.example.com/event-logo.png");
    expect(body.resolved_logo_url).toBe("https://cdn.example.com/event-logo.png");
  });

  it("returns is_deletable: true for an archived event with zero activity", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_ARCHIVED}/settings`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      archived_at: string | null;
      is_deletable: boolean;
    };
    expect(body.archived_at).not.toBeNull();
    expect(body.is_deletable).toBe(true);
  });

  it("returns is_deletable: true for an ACTIVE event with zero activity (archiving is not required)", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_ACTIVE_EMPTY}/settings`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      archived_at: string | null;
      is_deletable: boolean;
    };
    expect(body.status).toBe("active");
    expect(body.archived_at).toBeNull();
    expect(body.is_deletable).toBe(true);
  });

  it("returns 404 for non-existent event (superadmin)", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_MISSING}/settings`, {
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });

  it("returns 403 for non-existent event (org admin, no existence leak)", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_MISSING}/settings`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("forbidden");
  });

  it("returns 403 for cross-org event", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_B}/settings`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("forbidden");
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
    resetSystemLogBufferForTest();
    const res = await app.request(`/api/admin/events/${EVENT_SET}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Renamed Event" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      event: {
        title: string;
        slug: string;
        is_deletable: boolean;
        admitted_count: number;
        issued_items_count: number;
      };
    };
    expect(body.event.title).toBe("Renamed Event");
    expect(body.event.slug).toBe("event-settings");
    expect(body.event.is_deletable).toBe(false);
    expect(body.event.admitted_count).toBe(0);
    expect(body.event.issued_items_count).toBe(0);

    const audit = await prisma.adminAuditLog.findFirst({
      where: { organization_id: ORG_SET, action_type: "event_updated" },
    });
    expect(audit).not.toBeNull();
    const meta = audit!.metadata as { eventId?: string; fields?: string[] };
    expect(meta.eventId).toBe(EVENT_SET);
    expect(meta.fields).toContain("title");

    const [entry] = querySystemLogs({ source: "admin", search: "event_updated" });
    expect(entry).toMatchObject({
      level: "info",
      source: "admin",
      message: "event_updated",
      fields: { eventId: EVENT_SET, fields: ["title"], actorUserId: adminId, actorEmail: EMAIL_ADMIN },
    });
    expect(JSON.stringify(entry)).not.toContain("Renamed Event");
  });

  it("records a safe System-log category when the update transaction fails", async () => {
    resetSystemLogBufferForTest();
    const spy = vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(new Error("database secret"));
    try {
      const res = await app.request(`/api/admin/events/${EVENT_SET}`, {
        method: "PATCH",
        headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Private event title" }),
      });
      expect(res.status).toBe(500);
      const [entry] = querySystemLogs({ source: "admin", search: "event_updated_failed" });
      expect(entry).toMatchObject({
        level: "error",
        source: "admin",
        message: "event_updated_failed",
        fields: {
          eventId: EVENT_SET,
          fields: ["title"],
          actorUserId: adminId,
          errorKind: "transaction",
        },
      });
      expect(JSON.stringify(entry)).not.toContain("database secret");
      expect(JSON.stringify(entry)).not.toContain("Private event title");
    } finally {
      spy.mockRestore();
    }
  });

  it("updates timezone", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_SET}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ timezone: "Asia/Tokyo" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { event: { timezone: string } };
    expect(body.event.timezone).toBe("Asia/Tokyo");

    const row = await prisma.event.findUniqueOrThrow({ where: { id: EVENT_SET } });
    expect(row.timezone).toBe("Asia/Tokyo");
  });

  it("returns 400 for invalid timezone", async () => {
    const before = await prisma.event.findUniqueOrThrow({ where: { id: EVENT_SET } });

    const res = await app.request(`/api/admin/events/${EVENT_SET}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ timezone: "Mars/Olympus" }),
    });
    expect(res.status).toBe(400);

    const row = await prisma.event.findUniqueOrThrow({ where: { id: EVENT_SET } });
    expect(row.timezone).toBe(before.timezone);
  });

  it("updates logo_url and header_image_url, writing AdminAuditLog", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_SET}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        logo_url: "https://cdn.example.com/event-logo.png",
        header_image_url: "https://cdn.example.com/event-header.png",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      event: { logo_url: string | null; header_image_url: string | null };
    };
    expect(body.event.logo_url).toBe("https://cdn.example.com/event-logo.png");
    expect(body.event.header_image_url).toBe("https://cdn.example.com/event-header.png");

    const row = await prisma.event.findUniqueOrThrow({ where: { id: EVENT_SET } });
    expect(row.logo_url).toBe("https://cdn.example.com/event-logo.png");

    const audit = await prisma.adminAuditLog.findFirst({
      where: { organization_id: ORG_SET, action_type: "event_updated" },
    });
    const meta = audit!.metadata as { fields?: string[] };
    expect(meta.fields).toContain("logo_url");
    expect(meta.fields).toContain("header_image_url");
  });

  it("persists logo_original_url and logo_crop for uploaded logos, and clears them with the logo", async () => {
    const crop = { unit: "%", x: 5, y: 10, width: 80, height: 70, zoom: 1.5 };
    const setRes = await app.request(`/api/admin/events/${EVENT_SET}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        logo_url: "/uploads/default/a1b2c3d4-e5f6-7890-abcd-ef1234567890.png",
        logo_original_url: "/uploads/default/b2c3d4e5-f6a7-8901-bcde-f12345678901.png",
        logo_crop: crop,
      }),
    });
    expect(setRes.status).toBe(200);
    const setBody = (await setRes.json()) as {
      event: {
        logo_url: string | null;
        logo_original_url: string | null;
        logo_crop: typeof crop | null;
      };
    };
    expect(setBody.event.logo_url).toBe("/uploads/default/a1b2c3d4-e5f6-7890-abcd-ef1234567890.png");
    expect(setBody.event.logo_original_url).toBe(
      "/uploads/default/b2c3d4e5-f6a7-8901-bcde-f12345678901.png",
    );
    expect(setBody.event.logo_crop).toEqual(crop);

    const clearRes = await app.request(`/api/admin/events/${EVENT_SET}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ logo_url: null }),
    });
    expect(clearRes.status).toBe(200);
    const clearBody = (await clearRes.json()) as {
      event: {
        logo_url: string | null;
        logo_original_url: string | null;
        logo_crop: unknown;
      };
    };
    expect(clearBody.event.logo_url).toBeNull();
    expect(clearBody.event.logo_original_url).toBeNull();
    expect(clearBody.event.logo_crop).toBeNull();
  });

  it("clears logo_url back to inherited branding when set to null", async () => {
    await prisma.organization.update({
      where: { id: ORG_SET },
      data: { logo_url: "https://cdn.example.com/org-logo.png" },
    });
    await prisma.event.update({
      where: { id: EVENT_SET },
      data: { logo_url: "https://cdn.example.com/event-logo.png" },
    });

    const res = await app.request(`/api/admin/events/${EVENT_SET}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ logo_url: null }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      event: { logo_url: string | null; resolved_logo_url: string | null };
    };
    expect(body.event.logo_url).toBeNull();
    expect(body.event.resolved_logo_url).toBe("https://cdn.example.com/org-logo.png");
  });

  it("returns 400 for a non-URL logo_url and does not mutate", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_SET}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ logo_url: "not-a-url" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/http:\/\/ or https:\/\//);

    const row = await prisma.event.findUniqueOrThrow({ where: { id: EVENT_SET } });
    expect(row.logo_url).toBeNull();
  });

  it("returns 403 event_archived when patching branding on an archived event", async () => {
    await prisma.event.update({ where: { id: EVENT_SET }, data: { archived_at: new Date() } });

    const res = await app.request(`/api/admin/events/${EVENT_SET}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ logo_url: "https://cdn.example.com/event-logo.png" }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("event_archived");
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

  it("returns 400 when capacity exceeds PostgreSQL int max", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_SET}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ capacity: 2_147_483_648 }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 403 for cross-org event and does not mutate", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_B}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Hacked Title" }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("forbidden");

    const row = await prisma.event.findUniqueOrThrow({ where: { id: EVENT_B } });
    expect(row.title).toBe("Settings Event B");
  });

  it("allows superadmin to patch cross-org event", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_B}`, {
      method: "PATCH",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Superadmin Renamed B" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { event: { title: string } };
    expect(body.event.title).toBe("Superadmin Renamed B");

    await prisma.event.update({
      where: { id: EVENT_B },
      data: { title: "Settings Event B" },
    });
  });
});

describe("GET /api/admin/events/:eventId/export-pii", () => {
  beforeEach(() => {
    rateLimitStore.reset();
  });

  it("returns 403 for org admin", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_SET}/export-pii`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(403);
  });

  it("returns 404 for non-existent event (superadmin)", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_MISSING}/export-pii`, {
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });

  it("returns CSV attachment for superadmin and writes audit log", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_SET}/export-pii`, {
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
    expect(res.headers.get("Content-Disposition")).toContain("pii-export-event-settings");
    expect(res.headers.get("Cache-Control")).toBe("no-store");

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
    const meta = audit!.metadata as { eventId?: string; rowCount?: number; totalCount?: number; truncated?: boolean };
    expect(meta.eventId).toBe(EVENT_SET);
    expect(meta.rowCount).toBeGreaterThan(0);
    expect(meta.totalCount).toBe(meta.rowCount);
    expect(meta.truncated).toBe(false);
  });

  it("returns 429 after 5 PII exports per hour per superadmin", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await app.request(`/api/admin/events/${EVENT_SET}/export-pii`, {
        headers: { Cookie: superCookie },
      });
      expect(res.status).toBe(200);
    }

    const limited = await app.request(`/api/admin/events/${EVENT_SET}/export-pii`, {
      headers: { Cookie: superCookie },
    });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "too many requests" });
  });
});

describe("event context routes", () => {
  it("sets and clears the pinned note with an audit trail", async () => {
    const setNote = await app.request(`/api/admin/events/${EVENT_SET}/note`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ note: "  Call venue on Friday  " }),
    });
    expect(setNote.status).toBe(200);
    expect(await prisma.event.findUniqueOrThrow({ where: { id: EVENT_SET } })).toMatchObject({
      pinned_note: "Call venue on Friday",
    });

    const clearNote = await app.request(`/api/admin/events/${EVENT_SET}/note`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ note: "  " }),
    });
    expect(clearNote.status).toBe(200);
    expect(await prisma.event.findUniqueOrThrow({ where: { id: EVENT_SET } })).toMatchObject({
      pinned_note: null,
    });

    const actions = await prisma.adminAuditLog.findMany({
      where: {
        organization_id: ORG_SET,
        action_type: { in: ["event_pinned_note_set", "event_pinned_note_cleared"] },
      },
    });
    expect(actions.map((action) => action.action_type)).toEqual(
      expect.arrayContaining(["event_pinned_note_set", "event_pinned_note_cleared"]),
    );
  });

  it("creates and updates a contact, returning validation errors without mutation", async () => {
    let contactId: string | undefined;

    try {
      const created = await app.request(`/api/admin/events/${EVENT_SET}/contacts`, {
        method: "POST",
        headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "  Venue manager  ",
          role: "  Logistics  ",
          email: "manager@example.com",
          sort_order: 2,
        }),
      });
      expect(created.status).toBe(201);
      const contact = (await created.json()) as { id: string; name: string; role: string | null };
      contactId = contact.id;
      expect(contact).toMatchObject({ name: "Venue manager", role: "Logistics" });

      const updated = await app.request(`/api/admin/events/${EVENT_SET}/contacts/${contact.id}`, {
        method: "PUT",
        headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "  After-hours manager  ", phone: "  +48 123 456 789  " }),
      });
      expect(updated.status).toBe(200);
      expect(await updated.json()).toMatchObject({
        id: contact.id,
        name: "After-hours manager",
        phone: "+48 123 456 789",
      });

      const invalid = await app.request(`/api/admin/events/${EVENT_SET}/contacts/${contact.id}`, {
        method: "PUT",
        headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "   " }),
      });
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toEqual({ error: "name_required" });

      expect(await prisma.eventContact.findUniqueOrThrow({ where: { id: contact.id } })).toMatchObject({
        id: contact.id,
        name: "After-hours manager",
        role: "Logistics",
        phone: "+48 123 456 789",
        email: "manager@example.com",
        sort_order: 2,
      });
    } finally {
      if (contactId) await prisma.eventContact.deleteMany({ where: { id: contactId } });
    }
  });

  it("converts a contact update race into not_found", async () => {
    const contact = await prisma.eventContact.create({
      data: { event_id: EVENT_SET, name: "Race contact" },
    });
    const update = vi.spyOn(prisma.eventContact, "update").mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("record disappeared", {
        code: "P2025",
        clientVersion: "test",
      }),
    );

    try {
      const res = await app.request(`/api/admin/events/${EVENT_SET}/contacts/${contact.id}`, {
        method: "PUT",
        headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Updated after race" }),
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    } finally {
      update.mockRestore();
      await prisma.eventContact.deleteMany({ where: { id: contact.id } });
    }
  });

  it("creates and updates a resource while validating mutable fields", async () => {
    let resourceId: string | undefined;

    try {
      const created = await app.request(`/api/admin/events/${EVENT_SET}/resources`, {
        method: "POST",
        headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "  Venue plan  ",
          url: "https://example.com/plan.pdf",
          type: "file",
          description: "  Internal plan  ",
        }),
      });
      expect(created.status).toBe(201);
      const resource = (await created.json()) as { id: string; title: string; type: string };
      resourceId = resource.id;
      expect(resource).toMatchObject({ title: "Venue plan", type: "file" });

      const updated = await app.request(`/api/admin/events/${EVENT_SET}/resources/${resource.id}`, {
        method: "PUT",
        headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "  Updated venue plan  ",
          url: "https://example.com/updated-plan.pdf",
          description: "  ",
        }),
      });
      expect(updated.status).toBe(200);
      expect(await updated.json()).toMatchObject({
        id: resource.id,
        title: "Updated venue plan",
        url: "https://example.com/updated-plan.pdf",
        description: null,
      });

      const invalidType = await app.request(`/api/admin/events/${EVENT_SET}/resources/${resource.id}`, {
        method: "PUT",
        headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ type: "folder" }),
      });
      expect(invalidType.status).toBe(400);
      expect(await invalidType.json()).toEqual({ error: "invalid_type" });

      expect(await prisma.eventResource.findUniqueOrThrow({ where: { id: resource.id } })).toMatchObject({
        id: resource.id,
        title: "Updated venue plan",
        type: "file",
        url: "https://example.com/updated-plan.pdf",
        description: null,
      });

      const invalidUrl = await app.request(`/api/admin/events/${EVENT_SET}/resources/${resource.id}`, {
        method: "PUT",
        headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ url: "  " }),
      });
      expect(invalidUrl.status).toBe(400);
      expect(await invalidUrl.json()).toEqual({ error: "url_required" });

      expect(await prisma.eventResource.findUniqueOrThrow({ where: { id: resource.id } })).toMatchObject({
        id: resource.id,
        title: "Updated venue plan",
        type: "file",
        url: "https://example.com/updated-plan.pdf",
        description: null,
      });
    } finally {
      if (resourceId) await prisma.eventResource.deleteMany({ where: { id: resourceId } });
    }
  });
});
