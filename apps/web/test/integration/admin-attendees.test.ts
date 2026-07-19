import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
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
    },
  });
  await client.eventCustomField.create({
    data: { event_id: EVENT_A, source_field: "shirt_size", label: "Shirt size" },
  });
  await client.ticketType.createMany({
    data: [
      { event_id: EVENT_A, key: "vip", label: "VIP", color: "purple" },
      { event_id: EVENT_A, key: "standard", label: "Standard", color: "gray", sort_order: 1 },
    ],
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
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    const body = (await res.json()) as {
      items: { status: string; updated_at: string; last_mail_status: string; check_in_status: string }[];
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
    expect(item.status).toBe("registered");
    expect(new Date(item.updated_at).toISOString()).toBe(item.updated_at);
  });

  it("filters by q and status", async () => {
    const search = await app.request(
      `/api/admin/events/${EVENT_A}/attendees?q=anna&status=all`,
      { headers: { Cookie: adminCookie } },
    );
    expect(search.status).toBe(200);
    const searchBody = (await search.json()) as {
      items: { email: string; status: string; updated_at: string }[];
    };
    expect(searchBody.items).toHaveLength(1);
    expect(searchBody.items[0]!.email).toBe("anna@example.com");
    expect(searchBody.items[0]!.status).toBe("registered");
    expect(new Date(searchBody.items[0]!.updated_at).toISOString()).toBe(searchBody.items[0]!.updated_at);

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

  it("sorts by name ascending (default) and descending", async () => {
    const asc = await app.request(`/api/admin/events/${EVENT_A}/attendees`, {
      headers: { Cookie: adminCookie },
    });
    const ascBody = (await asc.json()) as { items: { name: string }[] };
    expect(ascBody.items.map((i) => i.name)).toEqual(["Anna Alpha", "Bob Beta", "Rate Limit"]);

    const desc = await app.request(`/api/admin/events/${EVENT_A}/attendees?sortDir=desc`, {
      headers: { Cookie: adminCookie },
    });
    const descBody = (await desc.json()) as { items: { name: string }[] };
    expect(descBody.items.map((i) => i.name)).toEqual(["Rate Limit", "Bob Beta", "Anna Alpha"]);
  });

  it("sorts ticket type by the catalog's curated order, not alphabetically", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees?sortBy=ticket_type`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { ticket_type: string | null }[] };
    // "vip" has sort_order 0, "standard" has sort_order 1 - vip sorts first despite "standard"
    // < "vip" alphabetically, proving this follows the catalog order, not A-Z.
    expect(body.items.map((i) => i.ticket_type)).toEqual(["vip", "standard", null]);
  });

  it("sorts ticket type by catalog order through the search branch too (raw-SQL join)", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_A}/attendees?sortBy=ticket_type&q=a`,
      { headers: { Cookie: adminCookie } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { ticket_type: string | null }[] };
    expect(body.items.map((i) => i.ticket_type)).toEqual(["vip", "standard", null]);
  });

  it("sorts by company with nulls last regardless of direction", async () => {
    const asc = await app.request(`/api/admin/events/${EVENT_A}/attendees?sortBy=company`, {
      headers: { Cookie: adminCookie },
    });
    const ascBody = (await asc.json()) as { items: { name: string }[] };
    expect(ascBody.items.map((i) => i.name)).toEqual(["Anna Alpha", "Bob Beta", "Rate Limit"]);

    const desc = await app.request(
      `/api/admin/events/${EVENT_A}/attendees?sortBy=company&sortDir=desc`,
      { headers: { Cookie: adminCookie } },
    );
    const descBody = (await desc.json()) as { items: { name: string }[] };
    // Beta Ltd > Alpha Corp descending, but Rate Limit (no company) still sorts last, not first.
    expect(descBody.items.map((i) => i.name)).toEqual(["Bob Beta", "Anna Alpha", "Rate Limit"]);
  });

  it("sorts by company using the displayed value, not the raw column, when custom_data overrides it (regression)", async () => {
    // resolveCompanyDepartment prefers custom_data.company over the scalar column - the ORDER BY
    // has to follow the same precedence, or an attendee could sort in a position that doesn't
    // match the company value actually shown for them in the same response.
    await prisma.attendee.create({
      data: {
        id: "att-admin-company-regression",
        event_id: EVENT_A,
        email: "company-regression@example.com",
        name: "Zack Sort",
        company: null,
        custom_data: { company: "Aaa Corp" },
      },
    });
    try {
      const res = await app.request(`/api/admin/events/${EVENT_A}/attendees?sortBy=company`, {
        headers: { Cookie: adminCookie },
      });
      const body = (await res.json()) as { items: { name: string; company: string | null }[] };
      // "Aaa Corp" (from custom_data; the scalar column is null) sorts before "Alpha Corp" - if
      // the ORDER BY used only the null scalar column, this attendee would sort last instead.
      expect(body.items[0]).toMatchObject({ name: "Zack Sort", company: "Aaa Corp" });
    } finally {
      await prisma.attendee.delete({ where: { id: "att-admin-company-regression" } });
    }
  });

  it("sorts by admitted_at with nulls last regardless of direction", async () => {
    const asc = await app.request(`/api/admin/events/${EVENT_A}/attendees?sortBy=admitted_at`, {
      headers: { Cookie: adminCookie },
    });
    const ascBody = (await asc.json()) as { items: { name: string }[] };
    expect(ascBody.items[0]!.name).toBe("Anna Alpha");

    const desc = await app.request(
      `/api/admin/events/${EVENT_A}/attendees?sortBy=admitted_at&sortDir=desc`,
      { headers: { Cookie: adminCookie } },
    );
    const descBody = (await desc.json()) as { items: { name: string }[] };
    expect(descBody.items[0]!.name).toBe("Anna Alpha");
  });

  it("uses name as a stable tiebreak when the sort column has identical values", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_A}/attendees?sortBy=status&sortDir=desc`,
      { headers: { Cookie: adminCookie } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { name: string }[] };
    // every seeded attendee has status "registered" - desc on an all-equal column falls through
    // to the name-asc tiebreak, proving pagination stays stable across ties.
    expect(body.items.map((i) => i.name)).toEqual(["Anna Alpha", "Bob Beta", "Rate Limit"]);
  });

  it("falls back to name asc for an unknown sortBy/sortDir", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_A}/attendees?sortBy=bogus&sortDir=bogus`,
      { headers: { Cookie: adminCookie } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { name: string }[] };
    expect(body.items.map((i) => i.name)).toEqual(["Anna Alpha", "Bob Beta", "Rate Limit"]);
  });

  it("sorts name case-insensitively, not by raw byte order", async () => {
    await prisma.attendee.update({ where: { id: ATT_RL }, data: { name: "aaron lowercase" } });
    try {
      const res = await app.request(`/api/admin/events/${EVENT_A}/attendees`, {
        headers: { Cookie: adminCookie },
      });
      const body = (await res.json()) as { items: { name: string }[] };
      // "aaron lowercase" sorts right before "Anna Alpha" under a human-friendly,
      // case-insensitive comparison; a case-sensitive byte-order compare would instead put it
      // dead last, since every uppercase-starting name sorts before every lowercase one.
      expect(body.items.map((i) => i.name)).toEqual(["aaron lowercase", "Anna Alpha", "Bob Beta"]);
    } finally {
      await prisma.attendee.update({ where: { id: ATT_RL }, data: { name: "Rate Limit" } });
    }
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
    const body = (await res.json()) as {
      items: { id: string; company: string | null; status: string; updated_at: string }[];
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.id).toBe(ATT_A2);
    expect(body.items[0]!.company).toBe("JSON Only Corp");
    expect(body.items[0]!.status).toBe("registered");
    expect(typeof body.items[0]!.updated_at).toBe("string");
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
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = (await res.json()) as {
      email: string;
      created_at: string;
      deliveries: { purpose: string; rendered_subject: string | null }[];
    };
    expect(body.email).toBe("anna@example.com");
    // #365: read off directly from the Attendee row, not derived from action log.
    expect(new Date(body.created_at).toString()).not.toBe("Invalid Date");
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

    const adminAudit = await prisma.adminAuditLog.findFirst({
      where: { organization_id: ORG_A, action_type: "attendee_erased" },
      orderBy: { created_at: "desc" },
    });
    expect(adminAudit).not.toBeNull();
    expect(adminAudit?.actor_user_id).toBe(adminId);
    // Unlike the per-attendee AttendeeActionLog entry above, the central admin audit log
    // deliberately does include the erased attendee's identity (PO review: needed to answer
    // "who was deleted" for incident response / GDPR Art. 33-34 breach-notification duties).
    const adminMeta = adminAudit!.metadata as {
      event_id?: string;
      event_title?: string;
      attendee_id?: string;
      attendee_name?: string;
      attendee_email?: string;
    };
    expect(adminMeta.event_id).toBe(EVENT_A);
    expect(adminMeta.event_title).toBe("Event A");
    expect(adminMeta.attendee_id).toBe(ERASE_ATTENDEE);
    expect(adminMeta.attendee_name).toBe("Erase Me");
    expect(adminMeta.attendee_email).toBe("erase-me@example.com");
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

describe("POST /api/admin/events/:eventId/attendees/bulk-delete", () => {
  async function seedBulkErasable(ids: string[]) {
    await prisma.attendee.createMany({
      data: ids.map((id, i) => ({
        id,
        event_id: EVENT_A,
        email: `bulk-erase-${i}@example.com`,
        name: `Bulk Erase ${i}`,
        token_hash: hashToken(generateToken()),
        token_enc: encryptToString(generateToken()),
      })),
    });
  }

  /** Dependent rows on the first of `ids` — proves bulk-delete's cleanup actually runs, not just
   * that the attendee rows themselves disappear (Codecov review). */
  async function seedBulkErasableDependents(firstId: string) {
    await prisma.$transaction([
      prisma.emailDelivery.create({
        data: {
          organization_id: ORG_A,
          event_id: EVENT_A,
          attendee_id: firstId,
          purpose: "initial",
          provider: "export_only",
          status: "sent",
          recipient_email: "bulk-erase-0@example.com",
          rendered_subject: "Bulk erase ticket",
          rendered_html: "<p>Bulk Erase ticket</p>",
        },
      }),
      prisma.walletPass.create({
        data: {
          attendee_id: firstId,
          pass_type_id: "pass.example.admitto",
          serial_number: `bulk-erase-serial-${firstId}`,
          auth_token: "bulk-erase-auth-token",
        },
      }),
      prisma.checkIn.create({
        data: {
          attendee_id: firstId,
          event_id: EVENT_A,
          status: "VALID",
          checked_in_by: adminId,
        },
      }),
    ]);
  }

  it("erases every requested attendee and writes one bulk + one central audit row", async () => {
    const ids = ["att-bulk-erase-1", "att-bulk-erase-2"];
    await seedBulkErasable(ids);
    await seedBulkErasableDependents(ids[0]!);

    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/bulk-delete`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ attendeeIds: ids }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deletedCount: 2 });
    expect(await prisma.attendee.count({ where: { id: { in: ids } } })).toBe(0);
    expect(await prisma.emailDelivery.count({ where: { attendee_id: ids[0] } })).toBe(0);
    expect(await prisma.walletPass.count({ where: { attendee_id: ids[0] } })).toBe(0);
    expect(await prisma.checkIn.count({ where: { attendee_id: ids[0] } })).toBe(0);

    const audit = await prisma.attendeeActionLog.findFirst({
      where: { event_id: EVENT_A, attendee_id: null, action_type: "attendees_bulk_erased" },
      orderBy: { created_at: "desc" },
    });
    expect(audit).not.toBeNull();
    const meta = audit!.metadata as {
      attendee_ids?: string[];
      removed?: { email_deliveries?: number; wallet_passes?: number; check_ins?: number };
    };
    expect(meta.attendee_ids?.sort()).toEqual([...ids].sort());
    expect(meta.removed).toMatchObject({ email_deliveries: 1, wallet_passes: 1, check_ins: 1 });

    const adminAudit = await prisma.adminAuditLog.findFirst({
      where: { organization_id: ORG_A, action_type: "attendees_bulk_erased" },
      orderBy: { created_at: "desc" },
    });
    expect(adminAudit).not.toBeNull();
    expect(adminAudit?.actor_user_id).toBe(adminId);
    // Same PO-review rationale as the single-attendee case above - the central log
    // deliberately keeps each erased attendee's name/email for incident-response purposes.
    const adminMeta = adminAudit!.metadata as {
      event_id?: string;
      event_title?: string;
      count?: number;
      attendees?: { id: string; name: string; email: string }[];
    };
    expect(adminMeta.event_id).toBe(EVENT_A);
    expect(adminMeta.event_title).toBe("Event A");
    expect(adminMeta.count).toBe(2);
    expect(adminMeta.attendees?.map((a) => a.id).sort()).toEqual([...ids].sort());
    expect(adminMeta.attendees?.map((a) => a.email).sort()).toEqual(
      ["bulk-erase-0@example.com", "bulk-erase-1@example.com"].sort(),
    );
  });

  it("reports only the attendees this request actually deleted when one is erased by a concurrent request mid-transaction (CodeRabbit review)", async () => {
    const ids = ["att-bulk-erase-race-1", "att-bulk-erase-race-2", "att-bulk-erase-race-3"];
    await seedBulkErasable(ids);

    // Simulates another admin's request (or a separate DSAR erasure) committing a delete for
    // one of the selected attendees between this request's findMany and its own DELETE
    // statement - exactly the TOCTOU window CodeRabbit flagged. Prisma middleware also runs
    // for queries issued inside `$transaction` callbacks, so this intercepts the route
    // handler's own `tx.attendee.findMany`. Fires once, then becomes a permanent no-op, since
    // `prisma` is shared for the rest of this file and `$use` middleware can't be unregistered.
    let armed = true;
    prisma.$use(async (params, next) => {
      const result = await next(params);
      if (armed && params.model === "Attendee" && params.action === "findMany") {
        armed = false;
        await prisma.attendee.delete({ where: { id: ids[1]! } });
      }
      return result;
    });

    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/bulk-delete`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ attendeeIds: ids }),
    });

    expect(armed).toBe(false); // sanity check: the injected concurrent delete actually ran
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deletedCount: 2 });

    const bulkLog = await prisma.attendeeActionLog.findFirst({
      where: { event_id: EVENT_A, attendee_id: null, action_type: "attendees_bulk_erased" },
      orderBy: { created_at: "desc" },
    });
    const bulkMeta = bulkLog!.metadata as { attendee_ids?: string[] };
    expect(bulkMeta.attendee_ids?.sort()).toEqual([ids[0], ids[2]].sort());

    const adminAudit = await prisma.adminAuditLog.findFirst({
      where: { organization_id: ORG_A, action_type: "attendees_bulk_erased" },
      orderBy: { created_at: "desc" },
    });
    const adminMeta = adminAudit!.metadata as {
      count?: number;
      attendees?: { id: string; name: string; email: string }[];
    };
    // Must reflect exactly what this request deleted - not the pre-race selection, which would
    // over-report the concurrently-erased attendee as removed by this action.
    expect(adminMeta.count).toBe(2);
    expect(adminMeta.attendees?.map((a) => a.id).sort()).toEqual([ids[0], ids[2]].sort());
  });

  it("silently ignores an id from a different event instead of failing the whole request", async () => {
    const ownId = "att-bulk-erase-own";
    await seedBulkErasable([ownId]);

    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/bulk-delete`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ attendeeIds: [ownId, ATT_B1] }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deletedCount: 1 });
    expect(await prisma.attendee.findUnique({ where: { id: ownId } })).toBeNull();
    expect(await prisma.attendee.findUnique({ where: { id: ATT_B1 } })).not.toBeNull();
  });

  it("rejects an empty selection", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/bulk-delete`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ attendeeIds: [] }),
    });

    expect(res.status).toBe(400);
  });

  it("rejects operator", async () => {
    const ids = ["att-bulk-erase-op"];
    await seedBulkErasable(ids);

    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/bulk-delete`, {
      method: "POST",
      headers: { Cookie: opCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ attendeeIds: ids }),
    });

    expect(res.status).toBe(403);
    expect(await prisma.attendee.findUnique({ where: { id: ids[0] } })).not.toBeNull();
  });
});

describe("POST /api/admin/events/:eventId/attendees/bulk-checkin", () => {
  // The suite-level seed() doesn't clean up after this block, and later describes in this same
  // file (e.g. bulk-resend) count *every* attendee in EVENT_A - leaving our seeded rows behind
  // would skew those counts. Delete CheckIn rows before Attendee rows (FK constraint), matching
  // revoke-checkin's own fixture below.
  afterAll(async () => {
    await prisma.checkIn.deleteMany({ where: { attendee_id: { startsWith: "att-bulk-checkin-" } } });
    await prisma.attendee.deleteMany({ where: { id: { startsWith: "att-bulk-checkin-" } } });
  });

  async function seedCheckable(ids: string[], overrides: Partial<{ admitted_at: Date }> = {}) {
    await prisma.attendee.createMany({
      data: ids.map((id) => ({
        id,
        event_id: EVENT_A,
        email: `${id}@example.com`,
        name: `Bulk Checkin ${id}`,
        token_hash: hashToken(generateToken()),
        token_enc: encryptToString(generateToken()),
        ...overrides,
      })),
    });
  }

  it("checks in every requested attendee, updates admitted_at, and writes per-attendee check_in logs", async () => {
    const ids = ["att-bulk-checkin-1", "att-bulk-checkin-2"];
    await seedCheckable(ids);

    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/bulk-checkin`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ attendeeIds: ids }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ checkedIn: 2, alreadyCheckedIn: 0, revoked: 0, invalid: 0, errored: 0 });

    const after = await prisma.attendee.findMany({
      where: { id: { in: ids } },
      select: { admitted_at: true },
    });
    expect(after.every((a) => a.admitted_at !== null)).toBe(true);

    const logs = await prisma.attendeeActionLog.findMany({
      where: { attendee_id: { in: ids }, action_type: "check_in" },
    });
    expect(logs).toHaveLength(2);

    const checkIns = await prisma.checkIn.findMany({
      where: { attendee_id: { in: ids }, status: "VALID", source: "manual" },
    });
    expect(checkIns).toHaveLength(2);
  });

  it("spans more than one bounded-concurrency chunk and sums counts correctly across chunks", async () => {
    // BULK_CHECKIN_CONCURRENCY is 10 - 12 ids force exactly two chunks (10 + 2), exercising the
    // outer `for (const batch of chunk(...))` accumulation that every other test in this block
    // (2 ids or fewer) never reaches.
    const ids = Array.from({ length: 12 }, (_, i) => `att-bulk-checkin-chunk-${i}`);
    await seedCheckable(ids);

    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/bulk-checkin`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ attendeeIds: ids }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ checkedIn: 12, alreadyCheckedIn: 0, revoked: 0, invalid: 0, errored: 0 });

    const after = await prisma.attendee.findMany({ where: { id: { in: ids } }, select: { admitted_at: true } });
    expect(after).toHaveLength(12);
    expect(after.every((a) => a.admitted_at !== null)).toBe(true);
  });

  it("counts a cancelled attendee's ticket as revoked instead of admitting them", async () => {
    const id = "att-bulk-checkin-revoked";
    await prisma.attendee.create({
      data: {
        id,
        event_id: EVENT_A,
        email: `${id}@example.com`,
        name: `Bulk Checkin ${id}`,
        token_hash: hashToken(generateToken()),
        token_enc: encryptToString(generateToken()),
        status: "cancelled",
      },
    });

    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/bulk-checkin`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ attendeeIds: [id] }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ checkedIn: 0, alreadyCheckedIn: 0, revoked: 1, invalid: 0, errored: 0 });
    const after = await prisma.attendee.findUnique({ where: { id } });
    expect(after?.admitted_at).toBeNull();
  });

  it("rejects a malformed JSON body", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/bulk-checkin`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: "{not json",
    });

    expect(res.status).toBe(400);
  });

  it("returns 403 for an admin outside the event's organization", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_B}/attendees/bulk-checkin`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ attendeeIds: ["att-does-not-matter"] }),
    });

    expect(res.status).toBe(403);
  });

  it("counts an already-admitted attendee separately without failing the request", async () => {
    const freshId = "att-bulk-checkin-mixed-fresh";
    const admittedId = "att-bulk-checkin-mixed-admitted";
    await seedCheckable([freshId]);
    await seedCheckable([admittedId], { admitted_at: new Date("2026-10-01T10:00:00Z") });

    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/bulk-checkin`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ attendeeIds: [freshId, admittedId] }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ checkedIn: 1, alreadyCheckedIn: 1, revoked: 0, invalid: 0, errored: 0 });
  });

  it("silently ignores an id from a different event instead of failing the whole request", async () => {
    const ownId = "att-bulk-checkin-own";
    await seedCheckable([ownId]);

    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/bulk-checkin`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ attendeeIds: [ownId, ATT_B1] }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ checkedIn: 1, alreadyCheckedIn: 0, revoked: 0, invalid: 0, errored: 0 });
    const other = await prisma.attendee.findUnique({ where: { id: ATT_B1 } });
    expect(other?.admitted_at).toBeNull();
  });

  it("rejects an empty selection", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/bulk-checkin`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ attendeeIds: [] }),
    });

    expect(res.status).toBe(400);
  });

  it("rejects operator", async () => {
    const ids = ["att-bulk-checkin-op"];
    await seedCheckable(ids);

    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/bulk-checkin`, {
      method: "POST",
      headers: { Cookie: opCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ attendeeIds: ids }),
    });

    expect(res.status).toBe(403);
    const after = await prisma.attendee.findUnique({ where: { id: ids[0] } });
    expect(after?.admitted_at).toBeNull();
  });

  it("returns 403 when the event is archived", async () => {
    const ids = ["att-bulk-checkin-archived"];
    await seedCheckable(ids);
    await prisma.event.update({ where: { id: EVENT_A }, data: { archived_at: new Date() } });
    try {
      const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/bulk-checkin`, {
        method: "POST",
        headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ attendeeIds: ids }),
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("event_archived");
      const after = await prisma.attendee.findUnique({ where: { id: ids[0] } });
      expect(after?.admitted_at).toBeNull();
    } finally {
      await prisma.event.update({ where: { id: EVENT_A }, data: { archived_at: null } });
    }
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

  it("updates attendee and writes audit without leaking the new name value (PII-safe)", async () => {
    const expectedUpdatedAt = await currentUpdatedAt(ATT_A2);
    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_A2}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Bob Updated",
        expected_updated_at: expectedUpdatedAt,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string };
    expect(body.name).toBe("Bob Updated");

    const log = await prisma.attendeeActionLog.findFirst({
      where: { attendee_id: ATT_A2, action_type: "attendee_edited" },
      orderBy: { created_at: "desc" },
    });
    expect(log).not.toBeNull();
    const meta = log!.metadata as { fields?: string[] };
    expect(meta.fields).toEqual(expect.arrayContaining(["name"]));
    // name is deliberately never one of LOGGED_VALUE_FIELDS - only the fixed business/contact
    // fields below (email/company/department/ticket_type) get their value logged (PO review).
    expect(JSON.stringify(meta)).not.toContain("Bob Updated");
  });

  it("logs before/after values for the approved safe subset - email/company/department/ticket_type (PO review)", async () => {
    // Explicit known starting state, not whatever earlier tests in this file left ATT_A2 in -
    // company/department can resolve from custom_data (operator-parity sync), so a value read
    // straight off the scalar columns wouldn't reliably match what computePatchChanges compares.
    await prisma.attendee.update({
      where: { id: ATT_A2 },
      data: {
        email: "bob@example.com",
        company: "Beta Ltd",
        custom_data: { company: "Beta Ltd" },
        department: null,
        ticket_type: "standard",
      },
    });
    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_A2}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "bob-value-logged@example.com",
        company: "Beta Value-Logged Co",
        department: "Value-Logged Dept",
        ticket_type: "vip",
        expected_updated_at: await currentUpdatedAt(ATT_A2),
      }),
    });
    expect(res.status).toBe(200);

    const log = await prisma.attendeeActionLog.findFirst({
      where: { attendee_id: ATT_A2, action_type: "attendee_edited" },
      orderBy: { created_at: "desc" },
    });
    expect(log).not.toBeNull();
    const meta = log!.metadata as {
      field_changes?: Record<string, { from: string | null; to: string | null }>;
    };
    expect(meta.field_changes?.email).toEqual({
      from: "bob@example.com",
      to: "bob-value-logged@example.com",
    });
    expect(meta.field_changes?.company).toEqual({ from: "Beta Ltd", to: "Beta Value-Logged Co" });
    expect(meta.field_changes?.department).toEqual({ from: null, to: "Value-Logged Dept" });
    expect(meta.field_changes?.ticket_type).toEqual({ from: "standard", to: "vip" });
    // custom_data field edits stay values-never-logged even in the same request shape -
    // covered by "audits custom_data field names without PII values" below.
    expect(meta.field_changes?.name).toBeUndefined();
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

  it("rejects a ticket_type not in the event's catalog (batch 04 / #351)", async () => {
    // Asserts the row is unchanged, not any specific value - other tests in this file mutate
    // ATT_A2's ticket_type, so hardcoding an expected "before" value here is order-dependent.
    const before = await prisma.attendee.findUniqueOrThrow({ where: { id: ATT_A2 } });
    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_A2}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        ticket_type: "bogus-type",
        expected_updated_at: await currentUpdatedAt(ATT_A2),
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unknown_ticket_type");

    const row = await prisma.attendee.findUniqueOrThrow({ where: { id: ATT_A2 } });
    expect(row.ticket_type).toBe(before.ticket_type);
  });

  it("clears ticket_type to null instead of persisting an empty string (CodeRabbit review)", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_A2}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        ticket_type: "",
        expected_updated_at: await currentUpdatedAt(ATT_A2),
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ticket_type: string | null };
    expect(body.ticket_type).toBeNull();

    const row = await prisma.attendee.findUniqueOrThrow({ where: { id: ATT_A2 } });
    expect(row.ticket_type).toBeNull();
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
    await prisma.eventCustomField.upsert({
      where: { event_id_source_field: { event_id: EVENT_A, source_field: "jacket_size" } },
      create: { event_id: EVENT_A, source_field: "jacket_size", label: "Jacket size" },
      update: {},
    });
    await prisma.eventItem.updateMany({
      where: { event_id: EVENT_A, key: "giftbag" },
      data: {
        config: { content_fields: ["jacket_size"] },
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
    await prisma.eventCustomField.update({
      where: { event_id_source_field: { event_id: EVENT_A, source_field: "shirt_size" } },
      data: { label: "Size", type: "select", required: true, options: ["S", "M", "L"] },
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
    await prisma.eventCustomField.update({
      where: { event_id_source_field: { event_id: EVENT_A, source_field: "shirt_size" } },
      data: { label: "Size", type: "select", required: true, options: ["S", "M", "L"] },
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
    await prisma.eventCustomField.update({
      where: { event_id_source_field: { event_id: EVENT_A, source_field: "shirt_size" } },
      data: { label: "Size", type: "select", required: true, options: ["S", "M", "L"] },
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
    await prisma.eventCustomField.update({
      where: { event_id_source_field: { event_id: EVENT_A, source_field: "shirt_size" } },
      data: { label: "Size", type: "select", required: true, options: ["S", "M", "L"] },
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

    await prisma.eventCustomField.update({
      where: { event_id_source_field: { event_id: EVENT_A, source_field: "shirt_size" } },
      data: { required: false },
    });
    await prisma.attendee.update({ where: { id: ATT_A2 }, data: { custom_data: {} } });
  });

  it("PATCH normalizes boolean custom_data aliases to true/false", async () => {
    await prisma.eventCustomField.upsert({
      where: { event_id_source_field: { event_id: EVENT_A, source_field: "lunch" } },
      create: { event_id: EVENT_A, source_field: "lunch", label: "Lunch", type: "boolean" },
      update: {},
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

  it("includes registry fields not referenced by any item's content_fields", async () => {
    await prisma.eventCustomField.create({
      data: { event_id: EVENT_A, source_field: "sock_size", label: "Socks size" },
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

  it("returns 422 mail_not_configured instead of a raw 500 when no mail transport is set up", async () => {
    const spy = vi
      .spyOn(mailDelivery, "resendTicketEmail")
      .mockRejectedValueOnce(new Error("Cannot resolve mail provider: not set in env"));
    try {
      const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_A1}/resend`, {
        method: "POST",
        headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(422);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("mail_not_configured");
    } finally {
      spy.mockRestore();
    }
  });

  it("does not remap an unrelated send failure to mail_not_configured (rethrows instead)", async () => {
    const spy = vi
      .spyOn(mailDelivery, "resendTicketEmail")
      .mockRejectedValueOnce(new Error("boom: provider timed out"));
    try {
      const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_A1}/resend`, {
        method: "POST",
        headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      // Not caught by mailNotConfiguredResponse — falls through to the framework's
      // generic unhandled-error response (plain text, not our JSON error envelope).
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(text).not.toContain("mail_not_configured");
    } finally {
      spy.mockRestore();
    }
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

describe("POST /api/admin/events/:eventId/attendees/:id/revoke-checkin", () => {
  const ATT_REVOKE = "att-admin-revoke-target";

  beforeAll(async () => {
    const token = generateToken();
    await prisma.attendee.upsert({
      where: { id: ATT_REVOKE },
      create: {
        id: ATT_REVOKE,
        event_id: EVENT_A,
        email: "revoke-target@example.com",
        name: "Revoke Target",
        token_hash: hashToken(token),
        admitted_at: new Date("2026-10-01T10:00:00Z"),
      },
      update: { admitted_at: new Date("2026-10-01T10:00:00Z"), admitted_by: null },
    });
  });

  // bulk-resend below counts EVENT_A's attendees — don't leak this fixture into it.
  afterAll(async () => {
    await prisma.attendeeActionLog.deleteMany({ where: { attendee_id: ATT_REVOKE } });
    await prisma.checkIn.deleteMany({ where: { attendee_id: ATT_REVOKE } });
    await prisma.attendee.delete({ where: { id: ATT_REVOKE } });
  });

  it("rejects operator", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_A}/attendees/${ATT_REVOKE}/revoke-checkin`,
      {
        method: "POST",
        headers: { Cookie: opCookie, ...sameOrigin, "Content-Type": "application/json" },
      },
    );
    expect(res.status).toBe(403);
    const after = await prisma.attendee.findUniqueOrThrow({ where: { id: ATT_REVOKE } });
    expect(after.admitted_at).not.toBeNull();
  });

  it("admin un-admits the attendee and logs check_in_revoked", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_A}/attendees/${ATT_REVOKE}/revoke-checkin`,
      {
        method: "POST",
        headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { card: { check_in_status: string } };
    expect(body.card.check_in_status).toBe("not_admitted");

    const after = await prisma.attendee.findUniqueOrThrow({ where: { id: ATT_REVOKE } });
    expect(after.admitted_at).toBeNull();

    const log = await prisma.attendeeActionLog.findFirst({
      where: { attendee_id: ATT_REVOKE, action_type: "check_in_revoked" },
      orderBy: { created_at: "desc" },
    });
    expect(log).not.toBeNull();
  });

  it("returns 409 when the attendee is not currently admitted", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_A}/attendees/${ATT_REVOKE}/revoke-checkin`,
      {
        method: "POST",
        headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      },
    );
    expect(res.status).toBe(409);
    // The actual reason, not a fixed "not_admitted" code — distinguishes
    // this from losing a concurrent-revoke race (review finding).
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Attendee is not currently admitted");
  });

  it("returns 403 for an unknown attendee id (no existence oracle, matches sibling attendee routes)", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_A}/attendees/does-not-exist/revoke-checkin`,
      {
        method: "POST",
        headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      },
    );
    expect(res.status).toBe(403);
  });

  // Revoke-checkin always cascades into resetItems:true (revokeCheckInTx), which now enforces
  // the same "pass must be admittable" guard as the single-item revoke path (packages/tickets
  // item-states.ts isAdmittable check, closed as part of the bulk-revoke danger-zone review).
  // Regression: that guard throws IllegalItemTransitionError, which this handler must map to a
  // 409 like its handleRevokeAttendeeItem sibling does, not let fall through to a raw 500.
  it("returns 409 (not 500) when revoking check-in for an admitted attendee whose pass is blocked", async () => {
    const attId = "att-admin-revoke-checkin-blocked-pass";
    try {
      await prisma.attendee.upsert({
        where: { id: attId },
        create: {
          id: attId,
          event_id: EVENT_A,
          email: "revoke-checkin-blocked@example.com",
          name: "Blocked Pass Revoke",
          token_hash: hashToken(generateToken()),
          status: "cancelled",
          admitted_at: new Date("2026-10-01T10:00:00Z"),
        },
        update: { status: "cancelled", admitted_at: new Date("2026-10-01T10:00:00Z") },
      });
      await getAttendeeCard(EVENT_A, attId, prisma);
      const giftbag = await prisma.eventItem.findFirstOrThrow({
        where: { event_id: EVENT_A, key: "giftbag" },
      });
      await prisma.attendeeItemState.update({
        where: { attendee_id_event_item_id: { attendee_id: attId, event_item_id: giftbag.id } },
        data: { state: "issued" },
      });

      const res = await app.request(
        `/api/admin/events/${EVENT_A}/attendees/${attId}/revoke-checkin`,
        {
          method: "POST",
          headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
        },
      );
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("Attendee's pass is not active");

      // Neither the admission nor the issued item should have been touched by the failed attempt.
      const after = await prisma.attendee.findUniqueOrThrow({ where: { id: attId } });
      expect(after.admitted_at).not.toBeNull();
      const item = await prisma.attendeeItemState.findFirst({
        where: { attendee_id: attId, event_item: { key: "giftbag" } },
      });
      expect(item?.state).toBe("issued");
    } finally {
      await prisma.attendeeActionLog.deleteMany({ where: { attendee_id: attId } });
      await prisma.attendeeItemState.deleteMany({ where: { attendee_id: attId } });
      await prisma.checkIn.deleteMany({ where: { attendee_id: attId } });
      await prisma.attendee.delete({ where: { id: attId } });
    }
  });
});

describe("POST /api/admin/events/:eventId/attendees/:id/items/:itemKey/revoke", () => {
  const ATT_ITEM_REVOKE = "att-admin-item-revoke-target";

  // Lazily create the item-state rows (getAttendeeCard does this), then force
  // giftbag to "issued" so there's something to revoke.
  async function setGiftbagIssued() {
    await getAttendeeCard(EVENT_A, ATT_ITEM_REVOKE, prisma);
    const giftbag = await prisma.eventItem.findFirstOrThrow({
      where: { event_id: EVENT_A, key: "giftbag" },
    });
    await prisma.attendeeItemState.update({
      where: {
        attendee_id_event_item_id: { attendee_id: ATT_ITEM_REVOKE, event_item_id: giftbag.id },
      },
      data: { state: "issued" },
    });
  }

  beforeAll(async () => {
    await prisma.attendee.upsert({
      where: { id: ATT_ITEM_REVOKE },
      create: {
        id: ATT_ITEM_REVOKE,
        event_id: EVENT_A,
        email: "item-revoke-target@example.com",
        name: "Item Revoke Target",
        token_hash: hashToken(generateToken()),
      },
      update: {},
    });
  });

  // bulk-resend below counts EVENT_A's attendees — don't leak this fixture.
  afterAll(async () => {
    await prisma.attendeeActionLog.deleteMany({ where: { attendee_id: ATT_ITEM_REVOKE } });
    await prisma.attendeeItemState.deleteMany({ where: { attendee_id: ATT_ITEM_REVOKE } });
    await prisma.attendee.delete({ where: { id: ATT_ITEM_REVOKE } });
  });

  it("rejects operator (server enforces admin/superadmin, not just frontend hiding)", async () => {
    await setGiftbagIssued();
    const res = await app.request(
      `/api/admin/events/${EVENT_A}/attendees/${ATT_ITEM_REVOKE}/items/giftbag/revoke`,
      {
        method: "POST",
        headers: { Cookie: opCookie, ...sameOrigin, "Content-Type": "application/json" },
      },
    );
    expect(res.status).toBe(403);
    const after = await prisma.attendeeItemState.findFirst({
      where: { attendee_id: ATT_ITEM_REVOKE, event_item: { key: "giftbag" } },
    });
    expect(after?.state).toBe("issued");
  });

  it("admin resets the item to pending, logs item_revoked, and returns the refreshed card", async () => {
    await setGiftbagIssued();
    const res = await app.request(
      `/api/admin/events/${EVENT_A}/attendees/${ATT_ITEM_REVOKE}/items/giftbag/revoke`,
      {
        method: "POST",
        headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      card: { items: { key: string; state: string; actions: string[] }[] };
    };
    const giftbag = body.card.items.find((i) => i.key === "giftbag");
    expect(giftbag?.state).toBe("pending");
    expect(giftbag?.actions).toContain("issued");

    const after = await prisma.attendeeItemState.findFirst({
      where: { attendee_id: ATT_ITEM_REVOKE, event_item: { key: "giftbag" } },
    });
    expect(after?.state).toBe("pending");

    const log = await prisma.attendeeActionLog.findFirst({
      where: { attendee_id: ATT_ITEM_REVOKE, action_type: "item_revoked" },
      orderBy: { created_at: "desc" },
    });
    expect(log).not.toBeNull();
    expect(log?.metadata).toMatchObject({ event_item_key: "giftbag", from_state: "issued" });
  });

  it("returns 409 for an unknown item key", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_A}/attendees/${ATT_ITEM_REVOKE}/items/does-not-exist/revoke`,
      {
        method: "POST",
        headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      },
    );
    expect(res.status).toBe(409);
  });

  it("returns 403 for an unknown attendee id (no existence oracle, matches sibling routes)", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_A}/attendees/does-not-exist/items/giftbag/revoke`,
      {
        method: "POST",
        headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      },
    );
    expect(res.status).toBe(403);
  });

  it("returns a generic 500 without leaking the underlying error for an unexpected failure", async () => {
    await setGiftbagIssued();
    // revokeItemState runs inside prisma.$transaction — spying on a model
    // method directly (e.g. prisma.attendeeItemState.findUnique) doesn't
    // intercept the transaction-scoped `tx` client Prisma creates internally,
    // so the mock has to sit on $transaction itself.
    const spy = vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(new Error("db exploded"));
    try {
      const res = await app.request(
        `/api/admin/events/${EVENT_A}/attendees/${ATT_ITEM_REVOKE}/items/giftbag/revoke`,
        {
          method: "POST",
          headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
        },
      );
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("server error");
    } finally {
      spy.mockRestore();
    }
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

  it("skips attendees with queued initial delivery when target is unsent", async () => {
    await prisma.emailDelivery.deleteMany({ where: { event_id: EVENT_A } });
    await prisma.emailDelivery.create({
      data: {
        organization_id: ORG_A,
        event_id: EVENT_A,
        attendee_id: ATT_A2,
        purpose: "initial",
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

  it("queues unsent tickets for attendees with resend-only delivery", async () => {
    await prisma.emailDelivery.deleteMany({ where: { event_id: EVENT_A } });
    await prisma.emailDelivery.create({
      data: {
        organization_id: ORG_A,
        event_id: EVENT_A,
        attendee_id: ATT_A2,
        purpose: "resend",
        provider: "export_only",
        status: "sent",
        recipient_email: "bob@example.com",
        rendered_subject: "Reminder",
        rendered_html: "<p>reminder</p>",
        sent_at: new Date(),
      },
    });

    const res = await postBulkResend("unsent");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { queued: number; skipped: number; failed: number };
    const attendeeCount = await prisma.attendee.count({ where: { event_id: EVENT_A } });
    expect(body.queued).toBe(attendeeCount);
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
      resolvedTemplateId: undefined,
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

  it("returns 422 mail_not_configured instead of a raw 500 when no mail transport is set up", async () => {
    const spy = vi
      .spyOn(mailDelivery, "sendTicketEmails")
      .mockRejectedValueOnce(new Error("Cannot resolve mail provider: not set in env"));
    try {
      const res = await postBulkResend("all");
      expect(res.status).toBe(422);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("mail_not_configured");
    } finally {
      spy.mockRestore();
    }
  });

  it("does not remap an unrelated send failure to mail_not_configured (rethrows instead)", async () => {
    const spy = vi
      .spyOn(mailDelivery, "sendTicketEmails")
      .mockRejectedValueOnce(new Error("boom: provider timed out"));
    try {
      const res = await postBulkResend("all");
      // Not caught by mailNotConfiguredResponse — falls through to the framework's
      // generic unhandled-error response (plain text, not our JSON error envelope).
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(text).not.toContain("mail_not_configured");
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
    await prisma.eventCustomField.deleteMany({ where: { event_id: EVENT_A } });
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

    const adminAudit = await prisma.adminAuditLog.findFirst({
      where: { organization_id: ORG_A, action_type: "attendee_created_manual" },
      orderBy: { created_at: "desc" },
    });
    expect(adminAudit).not.toBeNull();
    expect(adminAudit?.actor_user_id).toBe(adminId);
    const adminMeta = adminAudit!.metadata as {
      event_id?: string;
      event_title?: string;
      attendee_id?: string;
      attendee_name?: string;
      attendee_email?: string;
    };
    expect(adminMeta.event_id).toBe(EVENT_A);
    expect(adminMeta.event_title).toBe("Event A");
    expect(adminMeta.attendee_id).toBe(body.id);
    expect(adminMeta.attendee_name).toBe("Manual Guest");
    expect(adminMeta.attendee_email).toBe("manual@example.com");

    await prisma.attendee.delete({ where: { id: body.id } });
  });

  it("POST create rejects invalid custom_data select option", async () => {
    await prisma.eventCustomField.update({
      where: { event_id_source_field: { event_id: EVENT_A, source_field: "shirt_size" } },
      data: { type: "select", required: true, options: ["S", "M", "L"] },
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

    await prisma.eventCustomField.update({
      where: { event_id_source_field: { event_id: EVENT_A, source_field: "shirt_size" } },
      data: { required: false },
    });
  });

  it("POST create ignores null custom_data values", async () => {
    await prisma.eventCustomField.upsert({
      where: { event_id_source_field: { event_id: EVENT_A, source_field: "lunch" } },
      create: { event_id: EVENT_A, source_field: "lunch", label: "Lunch", type: "boolean" },
      update: {},
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

  it("POST create rejects when a required custom field is missing", async () => {
    await prisma.eventCustomField.update({
      where: { event_id_source_field: { event_id: EVENT_A, source_field: "shirt_size" } },
      data: { type: "select", required: true, options: ["S", "M", "L"] },
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

    await prisma.eventCustomField.update({
      where: { event_id_source_field: { event_id: EVENT_A, source_field: "shirt_size" } },
      data: { required: false, type: "text", options: Prisma.JsonNull },
    });
  });

  it("POST create rejects custom_data values over 100 characters", async () => {
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

  it("POST create rejects a ticket_type not in the event's catalog (batch 04 / #351)", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "unknown-type@example.com",
        name: "Unknown Type",
        ticket_type: "bogus-type",
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unknown_ticket_type");

    const row = await prisma.attendee.findFirst({ where: { email: "unknown-type@example.com" } });
    expect(row).toBeNull();
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

  it("PATCH status revoked on an admitted attendee auto-clears the admission (PO review)", async () => {
    const ATT_PASS_REVOKE = "att-admin-pass-revoke-admitted";
    const token = generateToken();
    await prisma.attendee.upsert({
      where: { id: ATT_PASS_REVOKE },
      create: {
        id: ATT_PASS_REVOKE,
        event_id: EVENT_A,
        email: "pass-revoke-admitted@example.com",
        name: "Pass Revoke Admitted",
        token_hash: hashToken(token),
        admitted_at: new Date("2026-10-01T10:00:00Z"),
      },
      update: { status: "registered", admitted_at: new Date("2026-10-01T10:00:00Z"), admitted_by: null },
    });
    try {
      const getRes = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_PASS_REVOKE}`, {
        headers: { Cookie: adminCookie },
      });
      const detail = (await getRes.json()) as { updated_at: string };

      const patchRes = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_PASS_REVOKE}`, {
        method: "PATCH",
        headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ status: "revoked", expected_updated_at: detail.updated_at }),
      });
      expect(patchRes.status).toBe(200);
      const patched = (await patchRes.json()) as {
        status: string;
        check_in_status: string;
        admitted_at: string | null;
        updated_at: string;
      };
      // Response DTO must reflect the clear immediately, not the pre-revoke row.
      expect(patched.check_in_status).toBe("not_admitted");
      expect(patched.admitted_at).toBeNull();

      const row = await prisma.attendee.findUniqueOrThrow({ where: { id: ATT_PASS_REVOKE } });
      expect(row.admitted_at).toBeNull();
      // revokeCheckInTx's own write bumps updated_at a second time — the
      // response must reflect the real, final value, not the one captured
      // right after the status-change write (review finding: a stale
      // updated_at here would make the client's very next edit fail with a
      // false 409 stale_write, since expected_updated_at wouldn't match).
      expect(patched.updated_at).toBe(row.updated_at.toISOString());

      const checkInRevokedLog = await prisma.attendeeActionLog.findFirst({
        where: { attendee_id: ATT_PASS_REVOKE, action_type: "check_in_revoked" },
      });
      expect(checkInRevokedLog).not.toBeNull();

      // A follow-up edit using the response's own updated_at must succeed —
      // proves the CAS won't spuriously reject it as a stale write.
      const followUpRes = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_PASS_REVOKE}`, {
        method: "PATCH",
        headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Pass Revoke Admitted (edited)", expected_updated_at: patched.updated_at }),
      });
      expect(followUpRes.status).toBe(200);
    } finally {
      await prisma.attendeeActionLog.deleteMany({ where: { attendee_id: ATT_PASS_REVOKE } });
      await prisma.checkIn.deleteMany({ where: { attendee_id: ATT_PASS_REVOKE } });
      await prisma.attendee.delete({ where: { id: ATT_PASS_REVOKE } });
    }
  });

  it("PATCH status revoked clears the admission but does not reset already handed-out items (bot review, #457)", async () => {
    // revokeCheckInMutation is shared with the explicit "Revoke check-in"
    // action, which DOES blanket-reset items (PO's ask). This path only
    // revokes the *pass* — it must not wipe a hand-out record that's
    // genuinely accurate, or restoring the pass later would make the item
    // card falsely say a gift bag/headset still needs to be given out.
    const ATT_PASS_REVOKE_ITEMS = "att-admin-pass-revoke-keeps-items";
    const token = generateToken();
    await prisma.attendee.upsert({
      where: { id: ATT_PASS_REVOKE_ITEMS },
      create: {
        id: ATT_PASS_REVOKE_ITEMS,
        event_id: EVENT_A,
        email: "pass-revoke-keeps-items@example.com",
        name: "Pass Revoke Keeps Items",
        token_hash: hashToken(token),
        admitted_at: new Date("2026-10-01T10:00:00Z"),
      },
      update: { status: "registered", admitted_at: new Date("2026-10-01T10:00:00Z"), admitted_by: null },
    });
    await getAttendeeCard(EVENT_A, ATT_PASS_REVOKE_ITEMS, prisma);
    const giftbag = await prisma.eventItem.findFirstOrThrow({ where: { event_id: EVENT_A, key: "giftbag" } });
    await prisma.attendeeItemState.update({
      where: { attendee_id_event_item_id: { attendee_id: ATT_PASS_REVOKE_ITEMS, event_item_id: giftbag.id } },
      data: { state: "issued" },
    });
    try {
      const getRes = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_PASS_REVOKE_ITEMS}`, {
        headers: { Cookie: adminCookie },
      });
      const detail = (await getRes.json()) as { updated_at: string };

      const patchRes = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_PASS_REVOKE_ITEMS}`, {
        method: "PATCH",
        headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ status: "revoked", expected_updated_at: detail.updated_at }),
      });
      expect(patchRes.status).toBe(200);

      const row = await prisma.attendee.findUniqueOrThrow({ where: { id: ATT_PASS_REVOKE_ITEMS } });
      expect(row.admitted_at).toBeNull();

      const giftbagAfter = await prisma.attendeeItemState.findFirst({
        where: { attendee_id: ATT_PASS_REVOKE_ITEMS, event_item_id: giftbag.id },
      });
      expect(giftbagAfter?.state).toBe("issued");

      const revokedLogs = await prisma.attendeeActionLog.count({
        where: { attendee_id: ATT_PASS_REVOKE_ITEMS, action_type: "item_revoked" },
      });
      expect(revokedLogs).toBe(0);
    } finally {
      await prisma.attendeeActionLog.deleteMany({ where: { attendee_id: ATT_PASS_REVOKE_ITEMS } });
      await prisma.attendeeItemState.deleteMany({ where: { attendee_id: ATT_PASS_REVOKE_ITEMS } });
      await prisma.checkIn.deleteMany({ where: { attendee_id: ATT_PASS_REVOKE_ITEMS } });
      await prisma.attendee.delete({ where: { id: ATT_PASS_REVOKE_ITEMS } });
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
