import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createSession, hashPassword, SESSION_STAGE } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { encryptToString } from "@admitto/crypto";
import { setMailSettings } from "@admitto/mailer-config";
import { generateToken, hashToken } from "@admitto/tickets";
import type { ExportPayload } from "@admitto/mailer";
import { createApp } from "../../src/app.js";
import { createRateLimitStore } from "../../src/rate-limit/index.js";

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
  app = createApp({
    prisma,
    checkinToken: CHECKIN_TOKEN,
    allowCheckinBearer: true,
    baseUrl: "https://tickets.example.com",
    rateLimitStore: createRateLimitStore(),
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

describe("PATCH /api/admin/events/:eventId/attendees/:id", () => {
  it("updates attendee and writes audit without PII in metadata", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_A2}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Bob Updated", company: "Beta Updated" }),
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
    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_A2}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ email: "anna@example.com" }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("email_conflict");
  });

  it("preserves extra custom_data keys when shirt_size is edited", async () => {
    await prisma.attendee.update({
      where: { id: ATT_A2 },
      data: {
        custom_data: { agency_ref: "REF-001", shirt_size: "M" },
      },
    });

    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_A2}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ shirt_size: "L" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { shirt_size: string | null };
    expect(body.shirt_size).toBe("L");

    const row = await prisma.attendee.findUniqueOrThrow({ where: { id: ATT_A2 } });
    const cd = row.custom_data as { agency_ref?: string; shirt_size?: string };
    expect(cd.agency_ref).toBe("REF-001");
    expect(cd.shirt_size).toBe("L");
  });

  it("syncs company edits into custom_data for operator parity", async () => {
    await prisma.attendee.update({
      where: { id: ATT_A2 },
      data: { company: null, custom_data: { company: "Old JSON Co" } },
    });

    const res = await app.request(`/api/admin/events/${EVENT_A}/attendees/${ATT_A2}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ company: "New Admin Co" }),
    });
    expect(res.status).toBe(200);

    const row = await prisma.attendee.findUniqueOrThrow({ where: { id: ATT_A2 } });
    expect(row.company).toBe("New Admin Co");
    const cd = row.custom_data as { company?: string };
    expect(cd.company).toBe("New Admin Co");
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
    const meta = log!.metadata as { to?: string; alternate?: boolean };
    expect(meta.to).toBe("alt@example.com");
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
