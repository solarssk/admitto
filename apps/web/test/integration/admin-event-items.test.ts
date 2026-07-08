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

/** The "badge" item is backfilled lazily (see event-items.ts), so fetch its
 * id via the list endpoint instead of assuming a fixed seeded id. */
async function getBadgeItemId(eventId: string): Promise<string> {
  const res = await app.request(`/api/admin/events/${eventId}/items`, {
    headers: { Cookie: adminCookie, ...sameOrigin },
  });
  const body = (await res.json()) as { items: Array<{ id: string; key: string }> };
  const badge = body.items.find((i) => i.key === "badge");
  if (!badge) throw new Error("expected badge item to be backfilled");
  return badge.id;
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
    const body = (await res.json()) as { items: { key: string; icon: string | null; config: unknown }[] };
    // "badge" is auto-backfilled for legacy events missing it (see event-items.ts),
    // alongside the fixture-seeded "giftbag" and "socks".
    expect(body.items.map((i) => i.key).sort()).toEqual(["badge", "giftbag", "socks"]);
    const giftbag = body.items.find((i) => i.key === "giftbag");
    expect(giftbag?.icon).toBeNull();
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

  it("creates item with icon", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_EI_A}/items`, {
      method: "POST",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ key: "vip_gift", label: "VIP gift", icon: "crown" }),
    });
    expect(res.status).toBe(201);
    const row = (await res.json()) as { key: string; icon: string | null };
    expect(row.key).toBe("vip_gift");
    expect(row.icon).toBe("crown");
  });

  it("creates item with icon and config together", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_EI_A}/items`, {
      method: "POST",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({
        key: "combo_item",
        label: "Combo",
        icon: "star",
        config: { requires_return: true },
      }),
    });
    expect(res.status).toBe(201);
    const row = (await res.json()) as {
      key: string;
      icon: string | null;
      config: { requires_return?: boolean };
    };
    expect(row.key).toBe("combo_item");
    expect(row.icon).toBe("star");
    expect(row.config.requires_return).toBe(true);
  });

  it("stores null when icon is the default package name", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_EI_A}/items`, {
      method: "POST",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ key: "default_icon", label: "Default icon", icon: "package" }),
    });
    expect(res.status).toBe(201);
    const row = (await res.json()) as { icon: string | null };
    expect(row.icon).toBeNull();
  });

  it("creates item without icon as null", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_EI_A}/items`, {
      method: "POST",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ key: "plain_item", label: "Plain item" }),
    });
    expect(res.status).toBe(201);
    const row = (await res.json()) as { icon: string | null };
    expect(row.icon).toBeNull();
  });

  it("rejects invalid icon on create", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_EI_A}/items`, {
      method: "POST",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ key: "bad_icon", label: "Bad icon", icon: "<script>" }),
    });
    expect(res.status).toBe(400);

    const trailingHyphen = await app.request(`/api/admin/events/${EVENT_EI_A}/items`, {
      method: "POST",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ key: "bad_icon2", label: "Bad icon 2", icon: "arrow-" }),
    });
    expect(trailingHyphen.status).toBe(400);
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

  it("rejects invalid source_field slug in contents", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_EI_A}/items/${ITEM_SOCKS}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({
        config: { contents: [{ label: "Shirt size", source_field: "shirt-size" }] },
      }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects reserved source_field slugs that collide with import columns", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_EI_A}/items/${ITEM_SOCKS}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({
        config: { contents: [{ label: "Email copy", source_field: "email" }] },
      }),
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

  it("disabling the badge item auto-turns-off Issue badge at entry", async () => {
    const badgeId = await getBadgeItemId(EVENT_EI_A);

    const res = await app.request(`/api/admin/events/${EVENT_EI_A}/items/${badgeId}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ enabled: false }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { enabled: boolean };
    expect(body.enabled).toBe(false);

    const event = await prisma.event.findUnique({ where: { id: EVENT_EI_A } });
    expect((event?.ops_config as { badge_at_entry?: boolean } | null)?.badge_at_entry).toBe(false);

    const log = await prisma.attendeeActionLog.findFirst({
      where: { event_id: EVENT_EI_A, action_type: "ops_config_updated" },
      orderBy: { created_at: "desc" },
    });
    expect(log?.metadata).toMatchObject({
      fields: ["badge_at_entry"],
      reason: "badge_item_disabled",
    });

    // Restore shared fixture state for tests declared later in this file.
    await prisma.eventItem.update({ where: { id: badgeId }, data: { enabled: true } });
    await prisma.event.update({
      where: { id: EVENT_EI_A },
      data: { ops_config: { badge_at_entry: true, require_confirm_on_scan: false } },
    });
  });

  it("re-disabling an already-off badge item does not touch ops_config again", async () => {
    const badgeId = await getBadgeItemId(EVENT_EI_A);
    await prisma.eventItem.update({ where: { id: badgeId }, data: { enabled: false } });
    await prisma.event.update({
      where: { id: EVENT_EI_A },
      data: { ops_config: { badge_at_entry: false, require_confirm_on_scan: false } },
    });

    const before = await prisma.attendeeActionLog.count({
      where: { event_id: EVENT_EI_A, action_type: "ops_config_updated" },
    });

    const res = await app.request(`/api/admin/events/${EVENT_EI_A}/items/${badgeId}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ enabled: false, description: "still off, patched again" }),
    });
    expect(res.status).toBe(200);

    const after = await prisma.attendeeActionLog.count({
      where: { event_id: EVENT_EI_A, action_type: "ops_config_updated" },
    });
    expect(after).toBe(before);

    // Restore shared fixture state for tests declared later in this file.
    await prisma.eventItem.update({ where: { id: badgeId }, data: { enabled: true } });
    await prisma.event.update({
      where: { id: EVENT_EI_A },
      data: { ops_config: { badge_at_entry: true, require_confirm_on_scan: false } },
    });
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

  it("sets and resets icon via PATCH", async () => {
    const createRes = await app.request(`/api/admin/events/${EVENT_EI_A}/items`, {
      method: "POST",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ key: "icon_patch", label: "Icon patch test" }),
    });
    const created = (await createRes.json()) as { id: string; icon: string | null };
    expect(created.icon).toBeNull();

    const setRes = await app.request(`/api/admin/events/${EVENT_EI_A}/items/${created.id}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ icon: "star" }),
    });
    expect(setRes.status).toBe(200);
    expect(((await setRes.json()) as { icon: string | null }).icon).toBe("star");

    const resetRes = await app.request(`/api/admin/events/${EVENT_EI_A}/items/${created.id}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ icon: null }),
    });
    expect(resetRes.status).toBe(200);
    expect(((await resetRes.json()) as { icon: string | null }).icon).toBeNull();

    const emptyRes = await app.request(`/api/admin/events/${EVENT_EI_A}/items/${created.id}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ icon: "" }),
    });
    expect(emptyRes.status).toBe(200);
    expect(((await emptyRes.json()) as { icon: string | null }).icon).toBeNull();
  });

  it("rejects icon over max length and invalid characters", async () => {
    const createRes = await app.request(`/api/admin/events/${EVENT_EI_A}/items`, {
      method: "POST",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ key: "icon_validate", label: "Icon validate" }),
    });
    const created = (await createRes.json()) as { id: string };

    const longRes = await app.request(`/api/admin/events/${EVENT_EI_A}/items/${created.id}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ icon: "a".repeat(65) }),
    });
    expect(longRes.status).toBe(400);

    const underRes = await app.request(`/api/admin/events/${EVENT_EI_A}/items/${created.id}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ icon: "bad_icon" }),
    });
    expect(underRes.status).toBe(400);
  });

  it("round-trips contents metadata", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_EI_A}/items/${ITEM_SOCKS}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({
        config: {
          contents: [
            {
              label: "Size",
              source_field: "sock_size",
              type: "select",
              required: true,
              options: ["S", "M", "L"],
            },
          ],
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      config: {
        contents: Array<{
          label: string;
          source_field: string;
          type: string;
          required: boolean;
          options: string[];
        }>;
      };
    };
    expect(body.config.contents[0]).toEqual({
      label: "Size",
      source_field: "sock_size",
      type: "select",
      required: true,
      options: ["S", "M", "L"],
    });

    const getRes = await app.request(`/api/admin/events/${EVENT_EI_A}/items`, {
      headers: { Cookie: adminCookie },
    });
    const socks = ((await getRes.json()) as { items: { key: string; config: typeof body.config }[] })
      .items.find((i) => i.key === "socks");
    expect(socks?.config?.contents?.[0]).toEqual(body.config.contents[0]);
  });

  it("rejects select contents without options", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_EI_A}/items/${ITEM_SOCKS}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({
        config: {
          contents: [{ label: "Size", source_field: "size", type: "select" }],
        },
      }),
    });
    expect(res.status).toBe(400);
  });

  it("GET preserves item flags when legacy contents fail strict parse", async () => {
    await prisma.eventItem.update({
      where: { id: ITEM_SOCKS },
      data: {
        config: {
          requires_return: true,
          issue_on_checkin: false,
          contents: [
            { label: "A", source_field: "dup_field" },
            { label: "B", source_field: "dup_field" },
          ],
        },
      },
    });

    const res = await app.request(`/api/admin/events/${EVENT_EI_A}/items`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const socks = ((await res.json()) as { items: { key: string; config: EventItemConfigBody }[] })
      .items.find((i) => i.key === "socks");
    expect(socks?.config?.requires_return).toBe(true);
    expect(socks?.config?.issue_on_checkin).toBe(false);
    expect(socks?.config?.contents).toEqual([
      { label: "A", source_field: "dup_field" },
      { label: "B", source_field: "dup_field" },
    ]);
  });

  it("GET preserves content metadata when strict config parse fails", async () => {
    await prisma.eventItem.update({
      where: { id: ITEM_SOCKS },
      data: {
        config: {
          requires_return: true,
          contents: [
            {
              label: "Size",
              source_field: "size",
              type: "select",
              required: true,
              options: ["S", "M"],
            },
            {
              label: "Size dup",
              source_field: "size",
              type: "text",
            },
          ],
        },
      },
    });

    const res = await app.request(`/api/admin/events/${EVENT_EI_A}/items`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const socks = ((await res.json()) as { items: { key: string; config: EventItemConfigBody }[] })
      .items.find((i) => i.key === "socks");
    expect(socks?.config?.contents?.[0]).toEqual({
      label: "Size",
      source_field: "size",
      type: "select",
      required: true,
      options: ["S", "M"],
    });
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

  it("allows delete when attendee states are only returned", async () => {
    const createRes = await app.request(`/api/admin/events/${EVENT_EI_A}/items`, {
      method: "POST",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ key: "temp_returned", label: "Temp returned" }),
    });
    const created = (await createRes.json()) as { id: string };
    await prisma.attendeeItemState.create({
      data: {
        attendee_id: ATT_EI,
        event_item_id: created.id,
        state: "returned",
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

  it("returns 409 item_in_use for giftbag already issued to attendees", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_EI_A}/items/${ITEM_GIFTBAG}`, {
      method: "DELETE",
      headers: { Cookie: adminCookie, ...sameOrigin },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("item_in_use");
  });

  it("returns 409 default_item when deleting the badge item", async () => {
    const badgeId = await getBadgeItemId(EVENT_EI_A);

    const res = await app.request(`/api/admin/events/${EVENT_EI_A}/items/${badgeId}`, {
      method: "DELETE",
      headers: { Cookie: adminCookie, ...sameOrigin },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("default_item");

    const stillThere = await prisma.eventItem.findUnique({ where: { id: badgeId } });
    expect(stillThere).not.toBeNull();
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
  it("GET returns parsed config with new flag defaults", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_EI_A}/ops-config`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      badge_at_entry: boolean;
      require_confirm_on_scan: boolean;
      allow_manual_lookup: boolean;
      auto_advance_on_valid: boolean;
    };
    expect(body.badge_at_entry).toBe(true);
    expect(body.require_confirm_on_scan).toBe(false);
    expect(body.allow_manual_lookup).toBe(true);
    expect(body.auto_advance_on_valid).toBe(true);
  });

  it("GET defaults new flags when legacy JSON omits them", async () => {
    const legacyEventId = "evt-admin-ei-legacy-ops";
    await prisma.event.create({
      data: {
        id: legacyEventId,
        title: "Legacy ops",
        slug: "event-admin-ei-legacy-ops",
        date: new Date("2026-12-01"),
        organization_id: ORG_EI_A,
        ops_config: { badge_at_entry: false },
      },
    });

    const res = await app.request(`/api/admin/events/${legacyEventId}/ops-config`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as OpsConfigBody;
    expect(body.badge_at_entry).toBe(false);
    expect(body.require_confirm_on_scan).toBe(false);
    expect(body.allow_manual_lookup).toBe(true);
    expect(body.auto_advance_on_valid).toBe(true);

    await prisma.event.delete({ where: { id: legacyEventId } });
  });

  it("PATCH merges and audits", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_EI_A}/ops-config`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ require_confirm_on_scan: true }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      require_confirm_on_scan: boolean;
      badge_at_entry: boolean;
      allow_manual_lookup: boolean;
      auto_advance_on_valid: boolean;
    };
    expect(body.require_confirm_on_scan).toBe(true);
    expect(body.badge_at_entry).toBe(true);
    expect(body.allow_manual_lookup).toBe(true);
    expect(body.auto_advance_on_valid).toBe(true);

    const log = await prisma.attendeeActionLog.findFirst({
      where: { event_id: EVENT_EI_A, action_type: "ops_config_updated" },
      orderBy: { created_at: "desc" },
    });
    expect(log?.attendee_id).toBeNull();
    expect(log?.metadata).toEqual({ fields: ["require_confirm_on_scan"] });
  });

  it("PATCH partial merge preserves other ops flags", async () => {
    const seedRes = await app.request(`/api/admin/events/${EVENT_EI_A}/ops-config`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({
        require_confirm_on_scan: true,
        badge_at_entry: true,
        allow_manual_lookup: true,
        auto_advance_on_valid: true,
      }),
    });
    expect(seedRes.status).toBe(200);

    const res = await app.request(`/api/admin/events/${EVENT_EI_A}/ops-config`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ allow_manual_lookup: false, auto_advance_on_valid: false }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as OpsConfigBody;
    expect(body.allow_manual_lookup).toBe(false);
    expect(body.auto_advance_on_valid).toBe(false);
    expect(body.badge_at_entry).toBe(true);
    expect(body.require_confirm_on_scan).toBe(true);
  });

  it("PATCH rejects badge_at_entry:true while the badge item is disabled", async () => {
    const badgeId = await getBadgeItemId(EVENT_EI_A);

    // Disabling the badge item auto-flips badge_at_entry to false.
    const disableRes = await app.request(`/api/admin/events/${EVENT_EI_A}/items/${badgeId}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ enabled: false }),
    });
    expect(disableRes.status).toBe(200);

    const res = await app.request(`/api/admin/events/${EVENT_EI_A}/ops-config`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ badge_at_entry: true }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("badge_item_inactive");

    const event = await prisma.event.findUnique({ where: { id: EVENT_EI_A } });
    expect((event?.ops_config as { badge_at_entry?: boolean } | null)?.badge_at_entry).toBe(false);

    // Restore shared fixture state for tests declared later in this file.
    await prisma.eventItem.update({ where: { id: badgeId }, data: { enabled: true } });
    await prisma.event.update({
      where: { id: EVENT_EI_A },
      data: {
        ops_config: {
          badge_at_entry: true,
          require_confirm_on_scan: true,
          allow_manual_lookup: false,
          auto_advance_on_valid: false,
        },
      },
    });
  });

  it("PATCH rejects badge_at_entry:true while the badge item has issue_on_checkin off", async () => {
    const badgeId = await getBadgeItemId(EVENT_EI_A);

    const configRes = await app.request(`/api/admin/events/${EVENT_EI_A}/items/${badgeId}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ config: { issue_on_checkin: false, requires_return: false } }),
    });
    expect(configRes.status).toBe(200);

    const res = await app.request(`/api/admin/events/${EVENT_EI_A}/ops-config`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ badge_at_entry: true }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("badge_item_inactive");

    // Restore shared fixture state for tests declared later in this file.
    await prisma.eventItem.update({
      where: { id: badgeId },
      data: { config: { issue_on_checkin: true, requires_return: false } },
    });
    await prisma.event.update({
      where: { id: EVENT_EI_A },
      data: {
        ops_config: {
          badge_at_entry: true,
          require_confirm_on_scan: true,
          allow_manual_lookup: false,
          auto_advance_on_valid: false,
        },
      },
    });
  });
});


type OpsConfigBody = {
  badge_at_entry: boolean;
  require_confirm_on_scan: boolean;
  allow_manual_lookup: boolean;
  auto_advance_on_valid: boolean;
};

type EventItemConfigBody = {
  requires_return?: boolean;
  issue_on_checkin?: boolean;
  contents?: Array<{ label: string; source_field: string }>;
};
