import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createSession, hashPassword, SESSION_STAGE } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { encryptToString } from "@admitto/crypto";
import { setMailSettings } from "@admitto/mailer-config";
import { generateToken, getAttendeeCard, hashToken } from "@admitto/tickets";
import * as mailDelivery from "@admitto/mail-delivery";
import type { ExportPayload } from "@admitto/mailer";
import { createApp } from "../../src/app.js";
import { createRateLimitStore, InMemoryRateLimitStore } from "../../src/rate-limit/index.js";
import { CAPACITY_EXCLUDED_STATUSES } from "../../src/admin/event-capacity.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };
const CHECKIN_TOKEN = "admin-attendees-checkin-token-32chars!";
const exported: ExportPayload[] = [];

const ORG_A = "org-admin-att-a";
const ORG_B = "org-admin-att-b";
const EVENT_A = "evt-admin-att-a";
const EVENT_B = "evt-admin-att-b";

const EMAIL_ADMIN = "admin-attendees-admin@example.com";
const EMAIL_OP = "admin-attendees-op@example.com";
const PASSWORD = "admin-att-pass-123";

const ATT_A1 = "att-admin-a1";
const ATT_A2 = "att-admin-a2";
const ATT_RL = "att-admin-a-rl";
const ATT_B1 = "att-admin-b1";

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let rateLimitStore: InMemoryRateLimitStore;
let adminId: string;
let opId: string;
let adminCookie = "";
let opCookie = "";

async function seed(client: PrismaClient) {
  await client.attendeeActionLog.deleteMany({
    where: { event_id: { in: [EVENT_A, EVENT_B] } },
  });
  await client.emailDelivery.deleteMany({
    where: { event_id: { in: [EVENT_A, EVENT_B] } },
  });
  await client.attendee.deleteMany({ where: { event_id: { in: [EVENT_A, EVENT_B] } } });
  await client.eventItem.deleteMany({ where: { event_id: { in: [EVENT_A, EVENT_B] } } });
  await client.roleAssignment.deleteMany({
    where: { OR: [{ scope_id: { in: [ORG_A, ORG_B, EVENT_A, EVENT_B] } }] },
  });
  await client.session.deleteMany({
    where: { user: { email: { in: [EMAIL_ADMIN, EMAIL_OP] } } },
  });
  await client.userMfaMethod.deleteMany({
    where: { user: { email: { in: [EMAIL_ADMIN] } } },
  });
  await client.user.deleteMany({ where: { email: { in: [EMAIL_ADMIN, EMAIL_OP] } } });
  await client.event.deleteMany({ where: { id: { in: [EVENT_A, EVENT_B] } } });
  await client.organization.deleteMany({ where: { id: { in: [ORG_A, ORG_B] } } });

  const password_hash = await hashPassword(PASSWORD);

  await client.organization.createMany({
    data: [
      { id: ORG_A, name: "Org A", slug: "admin-att-a" },
      { id: ORG_B, name: "Org B", slug: "admin-att-b" },
    ],
  });

  await client.event.createMany({
    data: [
      {
        id: EVENT_A,
        title: "Event A",
        slug: "event-admin-att-a",
        date: new Date("2026-10-01"),
        organization_id: ORG_A,
      },
      {
        id: EVENT_B,
        title: "Event B",
        slug: "event-admin-att-b",
        date: new Date("2026-11-01"),
        organization_id: ORG_B,
      },
    ],
  });

  const adminUser = await client.user.create({ data: { email: EMAIL_ADMIN, password_hash } });
  const opUser = await client.user.create({ data: { email: EMAIL_OP, password_hash } });
  adminId = adminUser.id;
  opId = opUser.id;

  await client.roleAssignment.createMany({
    data: [
      { user_id: adminId, role: "admin", scope_type: "organization", scope_id: ORG_A },
      { user_id: opId, role: "operator", scope_type: "event", scope_id: EVENT_A },
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

  await setMailSettings(
    { scopeType: "organization", scopeId: ORG_A },
    { provider: "export_only", fromAddress: "events@example.com" },
    client,
  );

  await client.eventItem.create({
    data: {
      event_id: EVENT_A,
      key: "giftbag",
      label: "Gift bag",
      config: { contents: [{ label: "Shirt size", source_field: "shirt_size" }] },
    },
  });

  const token = generateToken();
  const tokenEnc = encryptToString(token);
  await client.attendee.createMany({
    data: [
      {
        id: ATT_A1,
        event_id: EVENT_A,
        email: "anna@example.com",
        name: "Anna Alpha",
        company: "Alpha Corp",
        ticket_type: "vip",
        token_hash: hashToken(token),
        token_enc: tokenEnc,
        admitted_at: new Date("2026-10-01T10:00:00Z"),
      },
      {
        id: ATT_A2,
        event_id: EVENT_A,
        email: "bob@example.com",
        name: "Bob Beta",
        company: "Beta Ltd",
        ticket_type: "standard",
        token_hash: hashToken(generateToken()),
        token_enc: encryptToString(generateToken()),
      },
      {
        id: ATT_RL,
        event_id: EVENT_A,
        email: "rate@example.com",
        name: "Rate Limit",
        token_hash: hashToken(generateToken()),
        token_enc: encryptToString(generateToken()),
      },
      {
        id: ATT_B1,
        event_id: EVENT_B,
        email: "carol@example.com",
        name: "Carol Cross",
        company: "Cross Org",
      },
    ],
  });

  await client.emailDelivery.create({
    data: {
      organization_id: ORG_A,
      event_id: EVENT_A,
      attendee_id: ATT_A1,
      purpose: "initial",
      provider: "export_only",
      status: "sent",
      recipient_email: "anna@example.com",
      rendered_subject: "Your ticket",
      rendered_html: "<p>ticket</p>",
      sent_at: new Date("2026-09-01T12:00:00Z"),
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
  rateLimitStore = createRateLimitStore() as InMemoryRateLimitStore;
  app = createApp({
    prisma,
    checkinToken: CHECKIN_TOKEN,
    allowCheckinBearer: true,
    baseUrl: "https://tickets.example.com",
    rateLimitStore,
    skipCheckinBootValidation: true,
    adminDistRoot,
    mailDeliveryDeps: { exportSink: (p) => { exported.push(p); } },
  });
  adminCookie = await sessionCookieFor(adminId);
  opCookie = await sessionCookieFor(opId);
});

afterAll(async () => {
  await prisma?.$disconnect();
});

describe("GET /api/admin/events/:eventId/attendees", () => {
  it("returns paginated list without token fields", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees?page=1&pageSize=1`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Record<string, unknown>[];
      total: number;
      page: number;
      pageSize: number;
    };
    expect(body.total).toBe(3);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(1);
    expect(body.items).toHaveLength(1);
    const item = body.items[0]!;
    expect(item).not.toHaveProperty("token_hash");
    expect(item).not.toHaveProperty("token_enc");
    expect(item).not.toHaveProperty("qr_payload");
    expect(item.last_mail_status).toBe("sent");
    expect(item.check_in_status).toBe("admitted");
  });

  it("filters by q and status", async () => {
    const search = await app.request(
      `/api/admin/events/${EVENT_A}/attendees?q=anna&status=all`,
      { headers: { Cookie: adminCookie } },
    );
    expect(search.status).toBe(200);
    const searchBody = (await search.json()) as { items: { email: string }[] };
    expect(searchBody.items).toHaveLength(1);
    expect(searchBody.items[0]!.email).toBe("anna@example.com");

    const admitted = await app.request(
      `/api/admin/events/${EVENT_A}/attendees?status=admitted`,
      { headers: { Cookie: adminCookie } },
    );
    const admittedBody = (await admitted.json()) as { items: { id: string }[] };
    expect(admittedBody.items.every((i) => i.id === ATT_A1)).toBe(true);

    const notAdmitted = await app.request(
      `/api/admin/events/${EVENT_A}/attendees?status=not_admitted`,
      { headers: { Cookie: adminCookie } },
    );
    const notBody = (await notAdmitted.json()) as { items: { id: string }[] };
    expect(notBody.items.some((i) => i.id === ATT_A2)).toBe(true);
  });

  it("finds attendees by company stored only in custom_data", async () => {
    await prisma.attendee.update({
      where: { id: ATT_A2 },
      data: {
        company: null,
        custom_data: { company: "JSON Only Corp" },
      },
    });

    const res = await app.request(
      `/api/admin/events/${EVENT_A}/attendees?q=JSON+Only`,
      { headers: { Cookie: adminCookie } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { id: string; company: string | null }[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.id).toBe(ATT_A2);
    expect(body.items[0]!.company).toBe("JSON Only Corp");
  });

  it("rejects operator", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees`, {
      headers: { Cookie: opCookie },
    });
    expect(res.status).toBe(403);
  });
});

describe("GET /api/admin/events/:eventId/attendees/:id", () => {
  it("returns detail with deliveries", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_A1}`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      email: string;
      deliveries: { purpose: string; rendered_subject: string | null }[];
    };
    expect(body.email).toBe("anna@example.com");
    expect(body.deliveries.length).toBeGreaterThanOrEqual(1);
    expect(body.deliveries[0]!.purpose).toBe("initial");
  });

  it("returns 403 for cross-event attendee", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_B1}`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(403);
  });

  it("rejects operator", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_A1}`, {
      headers: { Cookie: opCookie },
    });
    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/admin/events/:eventId/attendees/:id", () => {
  const ERASE_ATTENDEE = "att-admin-erase";

  async function seedErasableAttendee() {
    await prisma.attendee.create({
      data: {
        id: ERASE_ATTENDEE,
        event_id: EVENT_A,
        email: "erase-me@example.com",
        name: "Erase Me",
        token_hash: hashToken(generateToken()),
        token_enc: encryptToString(generateToken()),
      },
    });

    const giftbag = await prisma.eventItem.findFirstOrThrow({
      where: { event_id: EVENT_A, key: "giftbag" },
      select: { id: true },
    });

    await prisma.$transaction([
      prisma.emailDelivery.create({
        data: {
          organization_id: ORG_A,
          event_id: EVENT_A,
          attendee_id: ERASE_ATTENDEE,
          purpose: "initial",
          provider: "export_only",
          status: "sent",
          recipient_email: "erase-me@example.com",
          rendered_subject: "Erase ticket",
          rendered_html: "<p>Erase Me ticket</p>",
        },
      }),
      prisma.walletPass.create({
        data: {
          attendee_id: ERASE_ATTENDEE,
          pass_type_id: "pass.example.admitto",
          serial_number: "erase-serial-001",
          auth_token: "erase-auth-token",
        },
      }),
      prisma.checkIn.create({
        data: {
          attendee_id: ERASE_ATTENDEE,
          event_id: EVENT_A,
          status: "VALID",
          checked_in_by: adminId,
        },
      }),
      prisma.attendeeItemState.create({
        data: {
          attendee_id: ERASE_ATTENDEE,
          event_item_id: giftbag.id,
          state: "issued",
          updated_by: adminId,
        },
      }),
      prisma.attendeeNote.create({
        data: {
          attendee_id: ERASE_ATTENDEE,
          event_id: EVENT_A,
          author_user_id: adminId,
          body: "private erasure note",
        },
      }),
      prisma.attendeeActionLog.create({
        data: {
          event_id: EVENT_A,
          attendee_id: ERASE_ATTENDEE,
          action_type: "test_existing_attendee_log",
          actor_user_id: adminId,
        },
      }),
    ]);
  }

  it("erases attendee dependencies and writes durable non-PII audit", async () => {
    await seedErasableAttendee();

    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ERASE_ATTENDEE}`, {
      method: "DELETE",
      headers: { Cookie: adminCookie, ...sameOrigin },
    });

    expect(res.status).toBe(204);
    expect(await prisma.attendee.findUnique({ where: { id: ERASE_ATTENDEE } })).toBeNull();
    expect(await prisma.emailDelivery.count({ where: { attendee_id: ERASE_ATTENDEE } })).toBe(0);
    expect(await prisma.walletPass.count({ where: { attendee_id: ERASE_ATTENDEE } })).toBe(0);
    expect(await prisma.checkIn.count({ where: { attendee_id: ERASE_ATTENDEE } })).toBe(0);
    expect(await prisma.attendeeItemState.count({ where: { attendee_id: ERASE_ATTENDEE } })).toBe(0);
    expect(await prisma.attendeeNote.count({ where: { attendee_id: ERASE_ATTENDEE } })).toBe(0);
    expect(await prisma.attendeeActionLog.count({ where: { attendee_id: ERASE_ATTENDEE } })).toBe(0);

    const audit = await prisma.attendeeActionLog.findFirst({
      where: { event_id: EVENT_A, attendee_id: null, action_type: "attendee_erased" },
      orderBy: { created_at: "desc" },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actor_user_id).toBe(adminId);
    const metadata = audit!.metadata as {
      attendee_id?: string;
      removed?: { email_deliveries?: number; wallet_passes?: number; check_ins?: number };
    };
    expect(metadata.attendee_id).toBe(ERASE_ATTENDEE);
    expect(metadata.removed).toMatchObject({
      email_deliveries: 1,
      wallet_passes: 1,
      check_ins: 1,
    });
    expect(JSON.stringify(metadata)).not.toContain("erase-me@example.com");
    expect(JSON.stringify(metadata)).not.toContain("Erase Me");
  });

  it("returns 403 for cross-event attendee", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_B1}`, {
      method: "DELETE",
      headers: { Cookie: adminCookie, ...sameOrigin },
    });

    expect(res.status).toBe(403);
    expect(await prisma.attendee.findUnique({ where: { id: ATT_B1 } })).not.toBeNull();
  });

  it("does not 500 or write another audit row for an already erased attendee", async () => {
    await seedErasableAttendee();

    const first = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ERASE_ATTENDEE}`, {
      method: "DELETE",
      headers: { Cookie: adminCookie, ...sameOrigin },
    });
    expect(first.status).toBe(204);

    const beforeAudit = await prisma.attendeeActionLog.count({
      where: { event_id: EVENT_A, attendee_id: null, action_type: "attendee_erased" },
    });

    const second = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ERASE_ATTENDEE}`, {
      method: "DELETE",
      headers: { Cookie: adminCookie, ...sameOrigin },
    });

    expect(second.status).toBe(403);
    const afterAudit = await prisma.attendeeActionLog.count({
      where: { event_id: EVENT_A, attendee_id: null, action_type: "attendee_erased" },
    });
    expect(afterAudit).toBe(beforeAudit);
  });

  it("rejects operator", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_A2}`, {
      method: "DELETE",
      headers: { Cookie: opCookie, ...sameOrigin },
    });

    expect(res.status).toBe(403);
    expect(await prisma.attendee.findUnique({ where: { id: ATT_A2 } })).not.toBeNull();
  });
});

describe("PATCH /api/admin/events/:eventId/attendees/:id", () => {
  async function currentUpdatedAt(attendeeId: string): Promise<string> {
    const row = await prisma.attendee.findUniqueOrThrow({
      where: { id: attendeeId },
      select: { updated_at: true },
    });
    return row.updated_at.toISOString();
  }

  it("updates attendee and writes audit without PII in metadata", async () => {
    const expectedUpdatedAt = await currentUpdatedAt(ATT_A2);
    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_A2}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Bob Updated",
        company: "Beta Updated",
        expected_updated_at: expectedUpdatedAt,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string; company: string | null };
    expect(body.name).toBe("Bob Updated");
    expect(body.company).toBe("Beta Updated");

    const log = await prisma.attendeeActionLog.findFirst({
      where: { attendee_id: ATT_A2, action_type: "attendee_edited" },
      orderBy: { created_at: "desc" },
    });
    expect(log).not.toBeNull();
    const meta = log!.metadata as { fields?: string[] };
    expect(meta.fields).toEqual(expect.arrayContaining(["name", "company"]));
    expect(JSON.stringify(meta)).not.toContain("Bob Updated");
    expect(JSON.stringify(meta)).not.toContain("bob@example.com");
  });

  it("returns 409 on email conflict", async () => {
    const expectedUpdatedAt = await currentUpdatedAt(ATT_A2);
    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_A2}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "anna@example.com",
        expected_updated_at: expectedUpdatedAt,
      }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("email_conflict");
  });

  it("preserves extra custom_data keys when custom attribute is edited", async () => {
    await prisma.attendee.update({
      where: { id: ATT_A2 },
      data: {
        custom_data: { agency_ref: "REF-001", shirt_size: "M" },
      },
    });

    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_A2}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        custom_data_fields: { shirt_size: "L" },
        expected_updated_at: await currentUpdatedAt(ATT_A2),
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { custom_data: { shirt_size?: string; agency_ref?: string } };
    expect(body.custom_data.shirt_size).toBe("L");

    const row = await prisma.attendee.findUniqueOrThrow({ where: { id: ATT_A2 } });
    const cd = row.custom_data as { agency_ref?: string; shirt_size?: string };
    expect(cd.agency_ref).toBe("REF-001");
    expect(cd.shirt_size).toBe("L");
  });

  it("accepts custom_data_fields values up to 100 characters", async () => {
    const longValue = "x".repeat(100);
    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_A2}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        custom_data_fields: { shirt_size: longValue },
        expected_updated_at: await currentUpdatedAt(ATT_A2),
      }),
    });
    expect(res.status).toBe(200);
  });

  it("rejects custom_data_fields values over 100 characters", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_A2}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        custom_data_fields: { shirt_size: "x".repeat(101) },
        expected_updated_at: await currentUpdatedAt(ATT_A2),
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("validation_failed");
  });

  it.each([
    ["uppercase", { Shirt_size: "M" }],
    ["hyphenated", { "shirt-size": "M" }],
    ["over 60 chars", { ["a".repeat(61)]: "M" }],
  ])("rejects custom_data_fields with invalid key (%s)", async (_label, custom_data_fields) => {
    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_A2}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        custom_data_fields,
        expected_updated_at: await currentUpdatedAt(ATT_A2),
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("validation_failed");
  });

  it("writes jacket_size under correct key and check-in card shows parity", async () => {
    await prisma.eventItem.updateMany({
      where: { event_id: EVENT_A, key: "giftbag" },
      data: {
        config: { contents: [{ label: "Jacket size", source_field: "jacket_size" }] },
      },
    });
    await prisma.attendee.update({
      where: { id: ATT_A2 },
      data: { custom_data: { jacket_size: "M" } },
    });

    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_A2}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        custom_data_fields: { jacket_size: "L" },
        expected_updated_at: await currentUpdatedAt(ATT_A2),
      }),
    });
    expect(res.status).toBe(200);

    const row = await prisma.attendee.findUniqueOrThrow({ where: { id: ATT_A2 } });
    const cd = row.custom_data as { jacket_size?: string; shirt_size?: string };
    expect(cd.jacket_size).toBe("L");
    expect(cd.shirt_size).toBeUndefined();

    const card = await getAttendeeCard(EVENT_A, ATT_A2, prisma);
    const giftbag = card!.items.find((i) => i.key === "giftbag");
    expect(giftbag?.detail).toBe("Jacket size: L");
  });

  it("returns 400 for unknown custom_data_fields key", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_A2}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        custom_data_fields: { hacker_field: "x" },
        expected_updated_at: await currentUpdatedAt(ATT_A2),
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unknown_custom_data_field");
  });

  it("rejects invalid select option and missing required field", async () => {
    await prisma.eventItem.updateMany({
      where: { event_id: EVENT_A, key: "giftbag" },
      data: {
        config: {
          contents: [
            {
              label: "Size",
              source_field: "shirt_size",
              type: "select",
              required: true,
              options: ["S", "M", "L"],
            },
          ],
        },
      },
    });

    const invalidOption = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_A2}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        custom_data_fields: { shirt_size: "XL" },
        expected_updated_at: await currentUpdatedAt(ATT_A2),
      }),
    });
    expect(invalidOption.status).toBe(400);
    expect((await invalidOption.json()) as { error: string }).toEqual({ error: "validation_failed" });

    const clearRequired = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_A2}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        custom_data_fields: { shirt_size: null },
        expected_updated_at: await currentUpdatedAt(ATT_A2),
      }),
    });
    expect(clearRequired.status).toBe(400);
    expect((await clearRequired.json()) as { error: string }).toEqual({
      error: "required_custom_data_field_missing",
    });
  });

  it("rejects profile-only PATCH when required custom_data is missing", async () => {
    await prisma.eventItem.updateMany({
      where: { event_id: EVENT_A, key: "giftbag" },
      data: {
        config: {
          contents: [
            {
              label: "Size",
              source_field: "shirt_size",
              type: "select",
              required: true,
              options: ["S", "M", "L"],
            },
          ],
        },
      },
    });
    await prisma.attendee.update({
      where: { id: ATT_A2 },
      data: { custom_data: {} },
    });

    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_A2}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Bob Renamed",
        expected_updated_at: await currentUpdatedAt(ATT_A2),
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toEqual({
      error: "required_custom_data_field_missing",
    });
  });

  it("rejects RSVP-only PATCH when required custom_data is missing", async () => {
    await prisma.eventItem.updateMany({
      where: { event_id: EVENT_A, key: "giftbag" },
      data: {
        config: {
          contents: [
            {
              label: "Size",
              source_field: "shirt_size",
              type: "select",
              required: true,
              options: ["S", "M", "L"],
            },
          ],
        },
      },
    });
    await prisma.attendee.update({
      where: { id: ATT_A2 },
      data: { custom_data: {}, rsvp_status: "none" },
    });

    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_A2}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        rsvp_status: "confirmed",
        expected_updated_at: await currentUpdatedAt(ATT_A2),
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toEqual({
      error: "required_custom_data_field_missing",
    });
  });

  it("rejects profile-only PATCH when stored custom_data is invalid for config", async () => {
    await prisma.eventItem.updateMany({
      where: { event_id: EVENT_A, key: "giftbag" },
      data: {
        config: {
          contents: [
            {
              label: "Size",
              source_field: "shirt_size",
              type: "select",
              required: true,
              options: ["S", "M", "L"],
            },
          ],
        },
      },
    });
    await prisma.attendee.update({
      where: { id: ATT_A2 },
      data: { custom_data: { shirt_size: "XL" } },
    });

    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_A2}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Bob With Legacy Size",
        expected_updated_at: await currentUpdatedAt(ATT_A2),
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toEqual({ error: "validation_failed" });
  });

  it("PATCH normalizes boolean custom_data aliases to true/false", async () => {
    await prisma.eventItem.updateMany({
      where: { event_id: EVENT_A, key: "giftbag" },
      data: {
        config: {
          contents: [
            {
              label: "Lunch",
              source_field: "lunch",
              type: "boolean",
            },
          ],
        },
      },
    });
    await prisma.attendee.update({
      where: { id: ATT_A1 },
      data: { custom_data: { lunch: "false" } },
    });

    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_A1}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        expected_updated_at: await currentUpdatedAt(ATT_A1),
        custom_data_fields: { lunch: "yes" },
      }),
    });
    expect(res.status).toBe(200);
    const row = await prisma.attendee.findUniqueOrThrow({ where: { id: ATT_A1 } });
    expect((row.custom_data as { lunch?: string }).lunch).toBe("true");
  });

  it("audits custom_data field names without PII values", async () => {
    await prisma.eventItem.updateMany({
      where: { event_id: EVENT_A, key: "giftbag" },
      data: {
        config: { contents: [{ label: "Jacket size", source_field: "jacket_size" }] },
      },
    });

    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_A2}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        custom_data_fields: { jacket_size: "SecretSize" },
        expected_updated_at: await currentUpdatedAt(ATT_A2),
      }),
    });
    expect(res.status).toBe(200);

    const log = await prisma.attendeeActionLog.findFirst({
      where: { attendee_id: ATT_A2, action_type: "attendee_edited" },
      orderBy: { created_at: "desc" },
    });
    const meta = log!.metadata as { fields?: string[] };
    expect(meta.fields).toContain("jacket_size");
    expect(JSON.stringify(meta)).not.toContain("SecretSize");
  });

  it("includes disabled item contents in allowed custom_data_fields", async () => {
    await prisma.eventItem.create({
      data: {
        event_id: EVENT_A,
        key: "socks",
        label: "Socks",
        enabled: false,
        config: { contents: [{ label: "Socks size", source_field: "sock_size" }] },
      },
    });

    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_A2}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        custom_data_fields: { sock_size: "42" },
        expected_updated_at: await currentUpdatedAt(ATT_A2),
      }),
    });
    expect(res.status).toBe(200);

    const row = await prisma.attendee.findUniqueOrThrow({ where: { id: ATT_A2 } });
    const cd = row.custom_data as { sock_size?: string };
    expect(cd.sock_size).toBe("42");

    const card = await getAttendeeCard(EVENT_A, ATT_A2, prisma);
    expect(card!.items.some((i) => i.key === "socks")).toBe(false);
  });

  it("syncs company edits into custom_data for operator parity", async () => {
    await prisma.attendee.update({
      where: { id: ATT_A2 },
      data: { company: null, custom_data: { company: "Old JSON Co" } },
    });

    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_A2}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        company: "New Admin Co",
        expected_updated_at: await currentUpdatedAt(ATT_A2),
      }),
    });
    expect(res.status).toBe(200);

    const row = await prisma.attendee.findUniqueOrThrow({ where: { id: ATT_A2 } });
    expect(row.company).toBe("New Admin Co");
    const cd = row.custom_data as { company?: string };
    expect(cd.company).toBe("New Admin Co");
  });

  it("returns 409 stale_write when expected_updated_at is stale", async () => {
    const staleUpdatedAt = await currentUpdatedAt(ATT_A2);

    const first = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_A2}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Stale Test First",
        expected_updated_at: staleUpdatedAt,
      }),
    });
    expect(first.status).toBe(200);

    const second = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_A2}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Stale Test Second",
        expected_updated_at: staleUpdatedAt,
      }),
    });
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: string };
    expect(body.error).toBe("stale_write");

    const row = await prisma.attendee.findUniqueOrThrow({ where: { id: ATT_A2 } });
    expect(row.name).toBe("Stale Test First");
  });

  it("allows no-op PATCH without expected_updated_at", async () => {
    const row = await prisma.attendee.findUniqueOrThrow({ where: { id: ATT_A2 } });
    const beforeLogs = await prisma.attendeeActionLog.count({
      where: { attendee_id: ATT_A2, action_type: "attendee_edited" },
    });

    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_A2}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ name: row.name }),
    });
    expect(res.status).toBe(200);

    const afterLogs = await prisma.attendeeActionLog.count({
      where: { attendee_id: ATT_A2, action_type: "attendee_edited" },
    });
    expect(afterLogs).toBe(beforeLogs);
  });

  it("allows no-op PATCH with only expected_updated_at", async () => {
    const expectedUpdatedAt = await currentUpdatedAt(ATT_A2);
    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_A2}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ expected_updated_at: expectedUpdatedAt }),
    });
    expect(res.status).toBe(200);
  });

  it("returns 400 when expected_updated_at is missing for a real change", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_A2}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ department: "Ops" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("validation_failed");
  });
});

describe("POST /api/admin/events/:eventId/attendees/:id/resend", () => {
  it("creates resend delivery and audit; alternate to does not change email", async () => {
    const before = await prisma.attendee.findUniqueOrThrow({ where: { id: ATT_A1 } });

    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_A1}/resend`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ to: "alt@example.com" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { purpose: string; recipient_email: string | null };
    expect(body.purpose).toBe("resend");
    expect(body.recipient_email).toBe("alt@example.com");

    const after = await prisma.attendee.findUniqueOrThrow({ where: { id: ATT_A1 } });
    expect(after.email).toBe(before.email);

    const log = await prisma.attendeeActionLog.findFirst({
      where: { attendee_id: ATT_A1, action_type: "ticket_resent" },
      orderBy: { created_at: "desc" },
    });
    expect(log).not.toBeNull();
    const meta = log!.metadata as { alternate?: boolean; to?: string };
    expect(meta.to).toBeUndefined();
    expect(meta.alternate).toBe(true);
  });

  it("rejects operator", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_A1}/resend`, {
      method: "POST",
      headers: { Cookie: opCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
  });

  it("accepts empty POST body without JSON payload", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_A1}/resend`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
  });

  it("returns 422 when resend is skipped (cancelled attendee)", async () => {
    await prisma.attendee.update({
      where: { id: ATT_A2 },
      data: { status: "cancelled" },
    });

    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_A2}/resend`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; reason?: string };
    expect(body.error).toBe("resend_skipped");
    expect(body.reason).toBe("cancelled");

    await prisma.attendee.update({
      where: { id: ATT_A2 },
      data: { status: "registered" },
    });
  });

  it("returns 429 after 5 resends per minute for the same attendee", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_RL}/resend`, {
        method: "POST",
        headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
    }

    const limited = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_RL}/resend`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(limited.status).toBe(429);
    const body = (await limited.json()) as { error: string };
    expect(body.error).toBe("too many requests");
  });
});

describe("POST /api/admin/events/:eventId/attendees/bulk-resend", () => {
  const bulkUrl = `/api/admin/events/${EVENT_A}/attendees/bulk-resend`;

  beforeEach(() => {
    rateLimitStore.reset();
  });

  async function postBulkResend(
    target: "unsent" | "all" = "unsent",
    cookie = adminCookie,
  ): Promise<Response> {
    return app.request(bulkUrl, {
      method: "POST",
      headers: { Cookie: cookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ target }),
    });
  }

  it("queues tickets for unsent attendees without prior delivery", async () => {
    await prisma.emailDelivery.deleteMany({ where: { event_id: EVENT_A } });

    const res = await postBulkResend("unsent");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { queued: number; skipped: number; failed: number };
    expect(body.queued).toBeGreaterThan(0);
    expect(body.skipped).toBe(0);
    expect(body.failed).toBe(0);

    const log = await prisma.attendeeActionLog.findFirst({
      where: { event_id: EVENT_A, action_type: "mail_bulk_resend" },
      orderBy: { created_at: "desc" },
    });
    expect(log).not.toBeNull();
    expect(log!.metadata).toEqual({
      target: "unsent",
      queued: body.queued,
      skipped: 0,
      failed: 0,
    });
  });

  it("accepts empty POST body and defaults target to unsent", async () => {
    const res = await app.request(bulkUrl, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { queued: number; skipped: number; failed: number };
    expect(body.queued).toBeGreaterThanOrEqual(0);

    const log = await prisma.attendeeActionLog.findFirst({
      where: { event_id: EVENT_A, action_type: "mail_bulk_resend" },
      orderBy: { created_at: "desc" },
    });
    expect(log!.metadata).toMatchObject({ target: "unsent" });
  });

  it("returns queued 0 when all attendees already have delivered mail", async () => {
    await prisma.emailDelivery.deleteMany({ where: { event_id: EVENT_A } });
    const attendees = await prisma.attendee.findMany({
      where: { event_id: EVENT_A },
      select: { id: true, email: true },
    });
    await prisma.emailDelivery.createMany({
      data: attendees.map((a) => ({
        organization_id: ORG_A,
        event_id: EVENT_A,
        attendee_id: a.id,
        purpose: "initial",
        provider: "export_only",
        status: "delivered",
        recipient_email: a.email,
        rendered_subject: "Ticket",
        rendered_html: "<p>ticket</p>",
        sent_at: new Date(),
      })),
    });

    const res = await postBulkResend("unsent");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { queued: number; skipped: number; failed: number };
    expect(body).toEqual({ queued: 0, skipped: 0, failed: 0 });

    const log = await prisma.attendeeActionLog.findFirst({
      where: { event_id: EVENT_A, action_type: "mail_bulk_resend" },
      orderBy: { created_at: "desc" },
    });
    expect(log).not.toBeNull();
    expect(log!.metadata).toEqual({ target: "unsent", queued: 0, skipped: 0, failed: 0 });
  });

  it("queues tickets for all attendees when target is all", async () => {
    await prisma.emailDelivery.deleteMany({ where: { event_id: EVENT_A } });
    const attendeeCount = await prisma.attendee.count({ where: { event_id: EVENT_A } });

    const res = await postBulkResend("all");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { queued: number; skipped: number; failed: number };
    expect(body.queued).toBe(attendeeCount);
    expect(body.skipped).toBe(0);
    expect(body.failed).toBe(0);
  });

  it("skips attendees with queued delivery when target is unsent", async () => {
    await prisma.emailDelivery.deleteMany({ where: { event_id: EVENT_A } });
    await prisma.emailDelivery.create({
      data: {
        organization_id: ORG_A,
        event_id: EVENT_A,
        attendee_id: ATT_A2,
        purpose: "resend",
        provider: "export_only",
        status: "queued",
        recipient_email: "bob@example.com",
        rendered_subject: "Queued",
        rendered_html: "<p>queued</p>",
      },
    });

    const res = await postBulkResend("unsent");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { queued: number; skipped: number; failed: number };
    const attendeeCount = await prisma.attendee.count({ where: { event_id: EVENT_A } });
    expect(body.queued).toBe(attendeeCount - 1);
    expect(body.skipped).toBe(0);
    expect(body.failed).toBe(0);
  });

  it("reports failed when deliveries exist but provider accepted none", async () => {
    const spy = vi.spyOn(mailDelivery, "sendTicketEmails").mockResolvedValueOnce({
      batchId: "bulk-fail-batch",
      sent: 0,
      skipped: [],
      deliveries: [
        { attendeeId: ATT_A1, deliveryId: "del-fail-1" },
        { attendeeId: ATT_A2, deliveryId: "del-fail-2" },
      ],
    });
    try {
      const res = await postBulkResend("all");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { queued: number; skipped: number; failed: number };
      expect(body).toEqual({ queued: 0, skipped: 0, failed: 2 });

      const log = await prisma.attendeeActionLog.findFirst({
        where: { event_id: EVENT_A, action_type: "mail_bulk_resend" },
        orderBy: { created_at: "desc" },
      });
      expect(log!.metadata).toEqual({ target: "all", queued: 0, skipped: 0, failed: 2 });
    } finally {
      spy.mockRestore();
    }
  });

  it("returns 403 when event is archived", async () => {
    await prisma.event.update({
      where: { id: EVENT_A },
      data: { archived_at: new Date() },
    });
    try {
      const res = await postBulkResend("unsent");
      expect(res.status).toBe(403);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("event_archived");
    } finally {
      await prisma.event.update({
        where: { id: EVENT_A },
        data: { archived_at: null },
      });
    }
  });

  it("rejects operator without manage access", async () => {
    const res = await postBulkResend("unsent", opCookie);
    expect(res.status).toBe(403);
  });

  it("returns 400 too_many_attendees when attendee count exceeds limit", async () => {
    const stubIds = Array.from({ length: 501 }, (_, i) => ({ id: `stub-${i}` }));
    const spy = vi.spyOn(prisma.attendee, "findMany").mockResolvedValue(stubIds as never);
    try {
      const res = await postBulkResend("all");
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; limit: number };
      expect(body.error).toBe("too_many_attendees");
      expect(body.limit).toBe(500);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("Attendees v2 — RSVP and manual create", () => {
  async function currentUpdatedAt(attendeeId: string): Promise<string> {
    const row = await prisma.attendee.findUniqueOrThrow({
      where: { id: attendeeId },
      select: { updated_at: true },
    });
    return row.updated_at.toISOString();
  }

  async function resetEventACustomFields(): Promise<void> {
    await prisma.eventItem.deleteMany({ where: { event_id: EVENT_A, key: "merch" } });
    await prisma.eventItem.updateMany({
      where: { event_id: EVENT_A, key: "giftbag" },
      data: { config: { contents: [{ label: "Shirt size", source_field: "shirt_size" }] } },
    });
  }

  async function countActiveEventAAttendees(): Promise<number> {
    return prisma.attendee.count({
      where: { event_id: EVENT_A, status: { notIn: [...CAPACITY_EXCLUDED_STATUSES] } },
    });
  }

  async function withSavedEventCapacity(
    capacity: number | null,
    run: () => Promise<void>,
  ): Promise<void> {
    const prior = await prisma.event.findUnique({
      where: { id: EVENT_A },
      select: { capacity: true },
    });
    await prisma.event.update({ where: { id: EVENT_A }, data: { capacity } });
    try {
      await run();
    } finally {
      await prisma.event.update({
        where: { id: EVENT_A },
        data: { capacity: prior?.capacity ?? null },
      });
    }
  }

  it("list rows include rsvp_status and admitted_at", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: { id: string; rsvp_status: string; admitted_at: string | null }[];
    };
    const anna = body.items.find((i) => i.id === ATT_A1);
    expect(anna?.rsvp_status).toBe("none");
    expect(anna?.admitted_at).not.toBeNull();
    if (body.items[0]) {
      expect(body.items[0]).not.toHaveProperty("token_enc");
      expect(body.items[0]).not.toHaveProperty("ticket_ref");
    }
  });

  it("filters list by rsvp_status", async () => {
    await prisma.attendee.update({
      where: { id: ATT_A2 },
      data: { rsvp_status: "confirmed" },
    });

    const res = await app.request(
      `/api/admin/events/${EVENT_A}/attendees?rsvp_status=confirmed`,
      { headers: { Cookie: adminCookie } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { id: string }[] };
    expect(body.items.map((i) => i.id)).toContain(ATT_A2);
    expect(body.items.every((i) => i.id === ATT_A2)).toBe(true);

    await prisma.attendee.update({
      where: { id: ATT_A2 },
      data: { rsvp_status: "none" },
    });
  });

  it("detail includes rsvp fields, action_log, and ticket_ref without raw token", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_A1}`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rsvp_status: string;
      ticket_ref: string | null;
      action_log: unknown[];
    };
    expect(body.rsvp_status).toBe("none");
    expect(body.ticket_ref).toBeTruthy();
    expect(body).not.toHaveProperty("token_enc");
    expect(Array.isArray(body.action_log)).toBe(true);
  });

  it("PATCH rsvp_status writes rsvp_status_changed audit log", async () => {
    const expectedUpdatedAt = await currentUpdatedAt(ATT_A2);
    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_A2}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        rsvp_status: "confirmed",
        expected_updated_at: expectedUpdatedAt,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rsvp_status: string;
      action_log: { action_type: string; actor_display: string | null }[];
    };
    expect(body.rsvp_status).toBe("confirmed");

    const rsvpEntry = body.action_log.find((e) => e.action_type === "rsvp_status_changed");
    expect(rsvpEntry?.actor_display).toBe("Admin");
    expect(rsvpEntry?.actor_display).not.toBe(EMAIL_ADMIN);

    const log = await prisma.attendeeActionLog.findFirst({
      where: { attendee_id: ATT_A2, action_type: "rsvp_status_changed" },
      orderBy: { created_at: "desc" },
    });
    expect(log).not.toBeNull();
    const meta = log!.metadata as { from?: string; to?: string };
    expect(meta.to).toBe("confirmed");

    await prisma.attendee.update({
      where: { id: ATT_A2 },
      data: { rsvp_status: "none", rsvp_updated_at: null, rsvp_source: null },
    });
  });

  it("POST create attendee returns 201 with audit log", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "manual@example.com",
        name: "Manual Guest",
        company: "Manual Co",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { email: string; rsvp_status: string; id: string };
    expect(body.email).toBe("manual@example.com");
    expect(body.rsvp_status).toBe("none");

    const log = await prisma.attendeeActionLog.findFirst({
      where: { attendee_id: body.id, action_type: "attendee_created_manual" },
    });
    expect(log).not.toBeNull();

    await prisma.attendee.delete({ where: { id: body.id } });
  });

  it("POST create rejects invalid custom_data select option", async () => {
    await prisma.eventItem.updateMany({
      where: { event_id: EVENT_A, key: "giftbag" },
      data: {
        config: {
          contents: [
            {
              label: "Shirt size",
              source_field: "shirt_size",
              type: "select",
              required: true,
              options: ["S", "M", "L"],
            },
          ],
        },
      },
    });

    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "bad-select@example.com",
        name: "Bad Select",
        custom_data: { shirt_size: "XL" },
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("validation_failed");
  });

  it("POST create ignores null custom_data values", async () => {
    await prisma.eventItem.updateMany({
      where: { event_id: EVENT_A, key: "giftbag" },
      data: {
        config: {
          contents: [{ label: "Lunch", source_field: "lunch", type: "boolean" }],
        },
      },
    });

    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "null-field@example.com",
        name: "Null Field",
        custom_data: { lunch: null },
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    const row = await prisma.attendee.findUniqueOrThrow({ where: { id: body.id } });
    expect(row.custom_data).toBeNull();

    await prisma.attendee.delete({ where: { id: body.id } });
  });

  it("POST create merges duplicate source_field metadata across items", async () => {
    await prisma.eventItem.updateMany({
      where: { event_id: EVENT_A, key: "giftbag" },
      data: {
        config: { contents: [{ label: "Shirt size", source_field: "shirt_size" }] },
      },
    });
    await prisma.eventItem.upsert({
      where: { event_id_key: { event_id: EVENT_A, key: "merch" } },
      create: {
        event_id: EVENT_A,
        key: "merch",
        label: "Merch",
        config: {
          contents: [
            {
              label: "Shirt size (merch)",
              source_field: "shirt_size",
              type: "select",
              required: true,
              options: ["S", "M", "L"],
            },
          ],
        },
      },
      update: {
        config: {
          contents: [
            {
              label: "Shirt size (merch)",
              source_field: "shirt_size",
              type: "select",
              required: true,
              options: ["S", "M", "L"],
            },
          ],
        },
      },
    });

    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "missing-size@example.com",
        name: "Missing Size",
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toEqual({
      error: "required_custom_data_field_missing",
    });
  });

  it("POST create rejects custom_data values over 100 characters", async () => {
    await prisma.eventItem.updateMany({
      where: { event_id: EVENT_A, key: "giftbag" },
      data: {
        config: {
          contents: [{ label: "Shirt size", source_field: "shirt_size", type: "text" }],
        },
      },
    });

    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "long-field@example.com",
        name: "Long Field",
        custom_data: { shirt_size: "x".repeat(101) },
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("validation_failed");
  });

  it("POST create duplicate email returns 409 email_taken", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ email: "anna@example.com", name: "Duplicate" }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("email_taken");
  });

  it("POST create rejects operator", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees`, {
      method: "POST",
      headers: { Cookie: opCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ email: "op-blocked@example.com", name: "Blocked" }),
    });
    expect(res.status).toBe(403);
  });

  it("export CSV does not expose token fields in response body", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/export?format=csv`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("token_enc");
    expect(text).not.toContain("token_hash");
    expect(text).not.toContain("ticket_ref");
  });

  it("POST create returns 409 event_full when at capacity", async () => {
    await resetEventACustomFields();
    const current = await countActiveEventAAttendees();
    await withSavedEventCapacity(current, async () => {
      const res = await app.request(`/api/admin/events/${EVENT_A}/attendees`, {
        method: "POST",
        headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ email: "full@example.com", name: "Full Event" }),
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { code: string; capacity: number; current: number };
      expect(body.code).toBe("event_full");
      expect(body.capacity).toBe(current);
      expect(body.current).toBe(current);
    });
  });

  it("POST create allows superadmin force when at capacity", async () => {
    await resetEventACustomFields();
    const password_hash = await hashPassword(PASSWORD);
    const superEmail = "admin-attendees-super@example.com";
    await prisma.session.deleteMany({ where: { user: { email: superEmail } } });
    await prisma.userMfaMethod.deleteMany({ where: { user: { email: superEmail } } });
    await prisma.roleAssignment.deleteMany({ where: { user: { email: superEmail } } });
    await prisma.user.deleteMany({ where: { email: superEmail } });
    const priorSuper = await prisma.roleAssignment.findFirst({
      where: { role: "superadmin", scope_type: "instance" },
      select: { id: true, user_id: true },
    });
    const superUser = await prisma.user.create({ data: { email: superEmail, password_hash } });
    try {
      if (priorSuper) {
        await prisma.roleAssignment.update({
          where: { id: priorSuper.id },
          data: { user_id: superUser.id },
        });
      } else {
        await prisma.roleAssignment.create({
          data: { user_id: superUser.id, role: "superadmin", scope_type: "instance", scope_id: null },
        });
      }
      await prisma.userMfaMethod.create({
        data: {
          user_id: superUser.id,
          type: "totp",
          secret_enc: encryptTotpSecret(generateTotpSecret()),
          confirmed_at: new Date(),
        },
      });
      const superSession = await createSession(prisma, {
        userId: superUser.id,
        stage: SESSION_STAGE.FULL,
      });
      const superCookie = `admitto_session=${superSession.rawToken}`;

      const current = await countActiveEventAAttendees();
      await withSavedEventCapacity(current, async () => {
        const res = await app.request(`/api/admin/events/${EVENT_A}/attendees?force=1`, {
          method: "POST",
          headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
          body: JSON.stringify({ email: "forced@example.com", name: "Forced Guest" }),
        });
        expect(res.status).toBe(201);
        const created = (await res.json()) as { id: string };
        const log = await prisma.attendeeActionLog.findFirst({
          where: { attendee_id: created.id, action_type: "attendee_created_manual" },
        });
        expect(log?.metadata).toMatchObject({ forced: true, capacity: current, current });
        await prisma.attendee.delete({ where: { id: created.id } });
      });
    } finally {
      if (priorSuper) {
        await prisma.roleAssignment.update({
          where: { id: priorSuper.id },
          data: { user_id: priorSuper.user_id },
        });
      } else {
        await prisma.roleAssignment.deleteMany({
          where: { user_id: superUser.id, role: "superadmin", scope_type: "instance" },
        });
      }
      await prisma.session.deleteMany({ where: { user_id: superUser.id } });
      await prisma.userMfaMethod.deleteMany({ where: { user_id: superUser.id } });
      await prisma.roleAssignment.deleteMany({ where: { user_id: superUser.id } });
      await prisma.user.delete({ where: { id: superUser.id } });
    }
  });

  it("POST create succeeds when cancelled attendee frees a capacity slot", async () => {
    await resetEventACustomFields();
    const priorStatus = (
      await prisma.attendee.findUniqueOrThrow({
        where: { id: ATT_A2 },
        select: { status: true },
      })
    ).status;
    try {
      const activeBefore = await countActiveEventAAttendees();
      await withSavedEventCapacity(activeBefore, async () => {
        await prisma.attendee.update({
          where: { id: ATT_A2 },
          data: { status: "cancelled" },
        });
        const res = await app.request(`/api/admin/events/${EVENT_A}/attendees`, {
          method: "POST",
          headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
          body: JSON.stringify({ email: "after-cancel@example.com", name: "After Cancel" }),
        });
        expect(res.status).toBe(201);
        const created = (await res.json()) as { id: string };
        await prisma.attendee.delete({ where: { id: created.id } });
      });
    } finally {
      await prisma.attendee.update({ where: { id: ATT_A2 }, data: { status: priorStatus } });
    }
  });

  it("PATCH cancelled to registered returns 409 event_full when capacity is full", async () => {
    await resetEventACustomFields();
    const priorStatus = (
      await prisma.attendee.findUniqueOrThrow({
        where: { id: ATT_A2 },
        select: { status: true },
      })
    ).status;
    let fillerId: string | undefined;
    try {
      const activeBefore = await countActiveEventAAttendees();
      await withSavedEventCapacity(activeBefore, async () => {
        await prisma.attendee.update({
          where: { id: ATT_A2 },
          data: { status: "cancelled" },
        });
        const fillRes = await app.request(`/api/admin/events/${EVENT_A}/attendees`, {
          method: "POST",
          headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
          body: JSON.stringify({ email: "fills-cancel-slot@example.com", name: "Fills Cancel Slot" }),
        });
        expect(fillRes.status).toBe(201);
        fillerId = ((await fillRes.json()) as { id: string }).id;

        const cancelledRow = await prisma.attendee.findUniqueOrThrow({
          where: { id: ATT_A2 },
          select: { updated_at: true },
        });
        const restoreRes = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_A2}`, {
          method: "PATCH",
          headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
          body: JSON.stringify({
            status: "registered",
            expected_updated_at: cancelledRow.updated_at.toISOString(),
          }),
        });
        expect(restoreRes.status).toBe(409);
        expect(((await restoreRes.json()) as { code: string }).code).toBe("event_full");
      });
    } finally {
      if (fillerId) await prisma.attendee.delete({ where: { id: fillerId } }).catch(() => undefined);
      await prisma.attendee.update({ where: { id: ATT_A2 }, data: { status: priorStatus } });
    }
  });

  it("PATCH status revoked writes pass_revoked and pass_restored audit logs", async () => {
    const priorStatus = (
      await prisma.attendee.findUniqueOrThrow({
        where: { id: ATT_A2 },
        select: { status: true },
      })
    ).status;
    try {
      const getRes = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_A2}`, {
        headers: { Cookie: adminCookie },
      });
      expect(getRes.status).toBe(200);
      const detail = (await getRes.json()) as { updated_at: string };

      const patchRes = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_A2}`, {
        method: "PATCH",
        headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ status: "revoked", expected_updated_at: detail.updated_at }),
      });
      expect(patchRes.status).toBe(200);
      const patched = (await patchRes.json()) as { status: string; updated_at: string };
      expect(patched.status).toBe("revoked");

      const revokeLog = await prisma.attendeeActionLog.findFirst({
        where: { attendee_id: ATT_A2, action_type: "pass_revoked" },
        orderBy: { created_at: "desc" },
      });
      expect(revokeLog).not.toBeNull();
      expect(revokeLog?.metadata).toMatchObject({ previous_status: "registered" });

      const restoreRes = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_A2}`, {
        method: "PATCH",
        headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "registered",
          expected_updated_at: patched.updated_at,
        }),
      });
      expect(restoreRes.status).toBe(200);

      const restoredLog = await prisma.attendeeActionLog.findFirst({
        where: { attendee_id: ATT_A2, action_type: "pass_restored" },
        orderBy: { created_at: "desc" },
      });
      expect(restoredLog).not.toBeNull();
    } finally {
      await prisma.attendee.update({ where: { id: ATT_A2 }, data: { status: priorStatus } });
    }
  });

  it("PATCH restore returns 409 event_full when capacity is full", async () => {
    await resetEventACustomFields();
    const current = await countActiveEventAAttendees();
    let fillerId: string | undefined;
    try {
      await withSavedEventCapacity(current, async () => {
        const getRes = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_A2}`, {
          headers: { Cookie: adminCookie },
        });
        const detail = (await getRes.json()) as { updated_at: string };

        const revokeRes = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_A2}`, {
          method: "PATCH",
          headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
          body: JSON.stringify({ status: "revoked", expected_updated_at: detail.updated_at }),
        });
        expect(revokeRes.status).toBe(200);

        const fillRes = await app.request(`/api/admin/events/${EVENT_A}/attendees`, {
          method: "POST",
          headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
          body: JSON.stringify({ email: "fills-slot@example.com", name: "Fills Slot" }),
        });
        expect(fillRes.status).toBe(201);
        fillerId = ((await fillRes.json()) as { id: string }).id;

        const revokedRow = await prisma.attendee.findUniqueOrThrow({
          where: { id: ATT_A2 },
          select: { updated_at: true },
        });
        const restoreRes = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_A2}`, {
          method: "PATCH",
          headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
          body: JSON.stringify({
            status: "registered",
            expected_updated_at: revokedRow.updated_at.toISOString(),
          }),
        });
        expect(restoreRes.status).toBe(409);
        const body = (await restoreRes.json()) as { code: string };
        expect(body.code).toBe("event_full");
      });
    } finally {
      if (fillerId) await prisma.attendee.delete({ where: { id: fillerId } }).catch(() => undefined);
      await prisma.attendee.update({ where: { id: ATT_A2 }, data: { status: "registered" } });
    }
  });
});
