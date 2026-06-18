import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createSession, hashPassword, SESSION_STAGE } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { createApp } from "../../src/app.js";
import { createRateLimitStore } from "../../src/rate-limit/index.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };

const ORG_EI_A = "org-admin-ei-a";
const ORG_EI_B = "org-admin-ei-b";
const EVENT_EI_A = "evt-admin-ei-a";
const EVENT_EI_B = "evt-admin-ei-b";

const EMAIL_ADMIN = "admin-event-items@example.com";
const EMAIL_OP = "admin-event-items-op@example.com";
const PASSWORD = "admin-ei-pass-123";

const ITEM_GIFTBAG = "ei_giftbag_a";
const ITEM_SOCKS = "ei_socks_a";
const ATT_EI = "att-admin-ei-1";

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let adminId: string;
let opId: string;
let adminCookie = "";
let opCookie = "";

async function seed(client: PrismaClient) {
  await client.attendeeActionLog.deleteMany({
    where: { event_id: { in: [EVENT_EI_A, EVENT_EI_B] } },
  });
  await client.attendeeItemState.deleteMany({
    where: { attendee: { event_id: { in: [EVENT_EI_A, EVENT_EI_B] } } },
  });
  await client.eventItem.deleteMany({ where: { event_id: { in: [EVENT_EI_A, EVENT_EI_B] } } });
  await client.attendee.deleteMany({ where: { event_id: { in: [EVENT_EI_A, EVENT_EI_B] } } });
  await client.roleAssignment.deleteMany({
    where: { OR: [{ scope_id: { in: [ORG_EI_A, ORG_EI_B, EVENT_EI_A, EVENT_EI_B] } }] },
  });
  await client.session.deleteMany({
    where: { user: { email: { in: [EMAIL_ADMIN, EMAIL_OP] } } },
  });
  await client.userMfaMethod.deleteMany({
    where: { user: { email: { in: [EMAIL_ADMIN] } } },
  });
  await client.user.deleteMany({ where: { email: { in: [EMAIL_ADMIN, EMAIL_OP] } } });
  await client.event.deleteMany({ where: { id: { in: [EVENT_EI_A, EVENT_EI_B] } } });
  await client.organization.deleteMany({ where: { id: { in: [ORG_EI_A, ORG_EI_B] } } });

  const password_hash = await hashPassword(PASSWORD);

  await client.organization.createMany({
    data: [
      { id: ORG_EI_A, name: "Org EI A", slug: "admin-ei-a" },
      { id: ORG_EI_B, name: "Org EI B", slug: "admin-ei-b" },
    ],
  });

  await client.event.createMany({
    data: [
      {
        id: EVENT_EI_A,
        title: "Event EI A",
        slug: "event-admin-ei-a",
        date: new Date("2026-10-01"),
        organization_id: ORG_EI_A,
        ops_config: { badge_at_entry: true, require_confirm_on_scan: false },
      },
      {
        id: EVENT_EI_B,
        title: "Event EI B",
        slug: "event-admin-ei-b",
        date: new Date("2026-11-01"),
        organization_id: ORG_EI_B,
      },
    ],
  });

  await client.eventItem.createMany({
    data: [
      {
        id: ITEM_GIFTBAG,
        event_id: EVENT_EI_A,
        key: "giftbag",
        label: "Gift bag",
        config: {
          contents: [{ label: "Shirt size", source_field: "shirt_size" }],
          requires_return: false,
        },
      },
      {
        id: ITEM_SOCKS,
        event_id: EVENT_EI_A,
        key: "socks",
        label: "Socks",
        enabled: false,
        config: { contents: [{ label: "Socks size", source_field: "sock_size" }] },
      },
    ],
  });

  const adminUser = await client.user.create({ data: { email: EMAIL_ADMIN, password_hash } });
  const opUser = await client.user.create({ data: { email: EMAIL_OP, password_hash } });
  adminId = adminUser.id;
  opId = opUser.id;

  await client.roleAssignment.createMany({
    data: [
      { user_id: adminId, role: "admin", scope_type: "organization", scope_id: ORG_EI_A },
      { user_id: opId, role: "operator", scope_type: "event", scope_id: EVENT_EI_A },
    ],
  });

  await client.userMfaMethod.create({
    data: {
      user_id: adminId,
      type: "totp",
      secret_enc: encryptTotpSecret(generateTotpSecret()),
      confirmed_at: new Date(),
    },
  });

  await client.attendee.create({
    data: {
      id: ATT_EI,
      event_id: EVENT_EI_A,
      email: "issued@example.com",
      name: "Issued Guest",
    },
  });

  await client.attendeeItemState.create({
    data: {
      attendee_id: ATT_EI,
      event_item_id: ITEM_GIFTBAG,
      state: "issued",
    },
  });
}

async function sessionCookieFor(userId: string): Promise<string> {
  const { rawToken } = await createSession(prisma, { userId, stage: SESSION_STAGE.FULL });
  return `admitto_session=${rawToken}`;
}

beforeAll(async () => {
  prisma = new PrismaClient();
  await seed(prisma);
  app = createApp({
    prisma,
    checkinToken: "admin-event-items-checkin-token-32!",
    allowCheckinBearer: true,
    baseUrl: "https://tickets.example.com",
    rateLimitStore: createRateLimitStore(),
    skipCheckinBootValidation: true,
    adminDistRoot,
  });
  adminCookie = await sessionCookieFor(adminId);
  opCookie = await sessionCookieFor(opId);
});

afterAll(async () => {
  await prisma?.$disconnect();
});

describe("GET /api/admin/events/:eventId/items", () => {
  it("returns items for event admin", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_EI_A}/items`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { key: string; config: unknown }[] };
    expect(body.items.map((i) => i.key).sort()).toEqual(["giftbag", "socks"]);
    const giftbag = body.items.find((i) => i.key === "giftbag");
    expect(giftbag?.config).toEqual({
      contents: [{ label: "Shirt size", source_field: "shirt_size" }],
      requires_return: false,
    });
  });

  it("returns 403 for operator", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_EI_A}/items`, {
      headers: { Cookie: opCookie },
    });
    expect(res.status).toBe(403);
  });

  it("returns 403 for cross-event admin scope", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_EI_B}/items`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/admin/events/:eventId/items", () => {
  it("creates item and audits without PII", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_EI_A}/items`, {
      method: "POST",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({
        key: "voucher",
        label: "Voucher",
        config: { contents: [{ label: "Code", source_field: "voucher_code" }] },
      }),
    });
    expect(res.status).toBe(201);
    const row = (await res.json()) as { key: string };
    expect(row.key).toBe("voucher");

    const log = await prisma.attendeeActionLog.findFirst({
      where: { event_id: EVENT_EI_A, action_type: "event_item_created" },
      orderBy: { created_at: "desc" },
    });
    expect(log?.attendee_id).toBeNull();
    expect(log?.metadata).toEqual({ item_key: "voucher" });
  });

  it("returns 409 on key conflict", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_EI_A}/items`, {
      method: "POST",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ key: "giftbag", label: "Duplicate" }),
    });
    expect(res.status).toBe(409);
  });

  it("rejects more than 20 content rows", async () => {
    const contents = Array.from({ length: 21 }, (_, i) => ({
      label: `Field ${i}`,
      source_field: `field_${i}`,
    }));
    const res = await app.request(`/api/admin/events/${EVENT_EI_A}/items`, {
      method: "POST",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ key: "too_many", label: "Too many", config: { contents } }),
    });
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/admin/events/:eventId/items/:itemId", () => {
  it("updates label and config", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_EI_A}/items/${ITEM_SOCKS}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ enabled: true, label: "Socks pack" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { enabled: boolean; label: string };
    expect(body.enabled).toBe(true);
    expect(body.label).toBe("Socks pack");
  });

  it("rejects unknown config keys", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_EI_A}/items/${ITEM_SOCKS}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ config: { size_field: "shirt_size" } }),
    });
    expect(res.status).toBe(400);
  });

  it("persists issue_on_checkin false explicitly", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_EI_A}/items/${ITEM_SOCKS}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({
        config: {
          contents: [{ label: "Socks size", source_field: "sock_size" }],
          issue_on_checkin: false,
          requires_return: false,
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      config: { issue_on_checkin: boolean; requires_return: boolean };
    };
    expect(body.config.issue_on_checkin).toBe(false);
    expect(body.config.requires_return).toBe(false);

    const row = await prisma.eventItem.findUnique({ where: { id: ITEM_SOCKS } });
    expect(row?.config).toMatchObject({ issue_on_checkin: false, requires_return: false });
  });

  it("returns 409 when disabling item with issued states", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_EI_A}/items/${ITEM_GIFTBAG}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ enabled: false }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("item_in_use");
  });

  it("returns 403 for cross-event item patch", async () => {
    const itemB = await prisma.eventItem.create({
      data: {
        id: "ei_event_b_only",
        event_id: EVENT_EI_B,
        key: "lanyard",
        label: "Lanyard",
        type: "item",
      },
    });
    const res = await app.request(`/api/admin/events/${EVENT_EI_B}/items/${itemB.id}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ label: "Hijacked" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/admin/events/:eventId/items/:itemId", () => {
  it("returns 409 when item in use", async () => {
    const createRes = await app.request(`/api/admin/events/${EVENT_EI_A}/items`, {
      method: "POST",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ key: "temp_in_use", label: "Temp in use" }),
    });
    const created = (await createRes.json()) as { id: string };
    await prisma.attendeeItemState.create({
      data: {
        attendee_id: ATT_EI,
        event_item_id: created.id,
        state: "issued",
      },
    });

    const res = await app.request(`/api/admin/events/${EVENT_EI_A}/items/${created.id}`, {
      method: "DELETE",
      headers: { Cookie: adminCookie, ...sameOrigin },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("item_in_use");
  });

  it("allows delete when attendee states are only pending", async () => {
    const createRes = await app.request(`/api/admin/events/${EVENT_EI_A}/items`, {
      method: "POST",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ key: "temp_pending", label: "Temp pending" }),
    });
    const created = (await createRes.json()) as { id: string };
    await prisma.attendeeItemState.create({
      data: {
        attendee_id: ATT_EI,
        event_item_id: created.id,
        state: "pending",
      },
    });

    const res = await app.request(`/api/admin/events/${EVENT_EI_A}/items/${created.id}`, {
      method: "DELETE",
      headers: { Cookie: adminCookie, ...sameOrigin },
    });
    expect(res.status).toBe(200);

    const deleted = await prisma.eventItem.findUnique({ where: { id: created.id } });
    expect(deleted).toBeNull();
  });

  it("returns 409 for default items", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_EI_A}/items/${ITEM_GIFTBAG}`, {
      method: "DELETE",
      headers: { Cookie: adminCookie, ...sameOrigin },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("default_item_not_deletable");
  });

  it("returns 403 for cross-event item delete", async () => {
    const itemB = await prisma.eventItem.create({
      data: {
        id: "ei_event_b_delete",
        event_id: EVENT_EI_B,
        key: "pin",
        label: "Pin",
        type: "item",
      },
    });
    const res = await app.request(`/api/admin/events/${EVENT_EI_B}/items/${itemB.id}`, {
      method: "DELETE",
      headers: { Cookie: adminCookie, ...sameOrigin },
    });
    expect(res.status).toBe(403);
  });

  it("deletes unused item", async () => {
    const createRes = await app.request(`/api/admin/events/${EVENT_EI_A}/items`, {
      method: "POST",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ key: "lanyard", label: "Lanyard" }),
    });
    const created = (await createRes.json()) as { id: string };

    const res = await app.request(`/api/admin/events/${EVENT_EI_A}/items/${created.id}`, {
      method: "DELETE",
      headers: { Cookie: adminCookie, ...sameOrigin },
    });
    expect(res.status).toBe(200);
  });
});

describe("ops-config", () => {
  it("GET returns parsed config", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_EI_A}/ops-config`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { badge_at_entry: boolean; require_confirm_on_scan: boolean };
    expect(body.badge_at_entry).toBe(true);
    expect(body.require_confirm_on_scan).toBe(false);
  });

  it("PATCH merges and audits", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_EI_A}/ops-config`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ require_confirm_on_scan: true }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { require_confirm_on_scan: boolean };
    expect(body.require_confirm_on_scan).toBe(true);

    const log = await prisma.attendeeActionLog.findFirst({
      where: { event_id: EVENT_EI_A, action_type: "ops_config_updated" },
      orderBy: { created_at: "desc" },
    });
    expect(log?.attendee_id).toBeNull();
    expect(log?.metadata).toEqual({ fields: ["require_confirm_on_scan"] });
  });
});
