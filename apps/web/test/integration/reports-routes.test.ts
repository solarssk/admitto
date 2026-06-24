import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createSession, hashPassword, SESSION_STAGE } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { encryptToString } from "@admitto/crypto";
import { generateToken, hashToken } from "@admitto/tickets";
import { createApp } from "../../src/app.js";
import { createRateLimitStore } from "../../src/rate-limit/index.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");

const ORG_REP = "org-reports-test";
const ORG_REP_B = "org-reports-test-b";
const EVENT_REP = "evt-reports-test";
const EVENT_REP_B = "evt-reports-test-b";
const EVENT_EMPTY = "evt-reports-empty";
const EVENT_MISSING = "evt-reports-missing";

const EMAIL_ADMIN = "reports-admin@example.com";
const EMAIL_ADMIN_B = "reports-admin-b@example.com";
const EMAIL_OP = "reports-op@example.com";
const PASSWORD = "reports-test-pass-123";

const ATT_VIP_1 = "att-reports-vip-1";
const ATT_VIP_2 = "att-reports-vip-2";
const ATT_STD_1 = "att-reports-std-1";
const ATT_STD_2 = "att-reports-std-2";
const ATT_STD_3 = "att-reports-std-3";
const ATT_NO_SHOW = "att-reports-no-show";

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let adminId: string;
let adminBId: string;
let opId: string;
let adminCookie = "";
let adminBCookie = "";
let opCookie = "";

function mkAttendeeToken() {
  const token = generateToken();
  return {
    token_hash: hashToken(token),
    token_enc: encryptToString(token),
  };
}

async function seed(client: PrismaClient) {
  const eventIds = [EVENT_REP, EVENT_REP_B, EVENT_EMPTY];
  await client.checkIn.deleteMany({ where: { event_id: { in: eventIds } } });
  await client.attendeeActionLog.deleteMany({ where: { event_id: { in: eventIds } } });
  await client.attendee.deleteMany({ where: { event_id: { in: eventIds } } });
  await client.roleAssignment.deleteMany({
    where: { OR: [{ scope_id: { in: [ORG_REP, ORG_REP_B, ...eventIds] } }] },
  });
  await client.session.deleteMany({
    where: { user: { email: { in: [EMAIL_ADMIN, EMAIL_ADMIN_B, EMAIL_OP] } } },
  });
  await client.userMfaMethod.deleteMany({
    where: { user: { email: { in: [EMAIL_ADMIN, EMAIL_ADMIN_B] } } },
  });
  await client.user.deleteMany({ where: { email: { in: [EMAIL_ADMIN, EMAIL_ADMIN_B, EMAIL_OP] } } });
  await client.event.deleteMany({ where: { id: { in: eventIds } } });
  await client.organization.deleteMany({ where: { id: { in: [ORG_REP, ORG_REP_B] } } });

  const password_hash = await hashPassword(PASSWORD);

  await client.organization.createMany({
    data: [
      { id: ORG_REP, name: "Reports Org", slug: "reports-org" },
      { id: ORG_REP_B, name: "Reports Org B", slug: "reports-org-b" },
    ],
  });

  await client.event.createMany({
    data: [
      {
        id: EVENT_REP,
        title: "Reports Event",
        slug: "reports-event",
        date: new Date("2026-10-01T12:00:00.000Z"),
        capacity: 500,
        organization_id: ORG_REP,
      },
      {
        id: EVENT_REP_B,
        title: "Reports Event B",
        slug: "reports-event-b",
        date: new Date("2026-11-01T12:00:00.000Z"),
        organization_id: ORG_REP_B,
      },
      {
        id: EVENT_EMPTY,
        title: "Empty Reports Event",
        slug: "reports-empty",
        date: new Date("2026-12-01T12:00:00.000Z"),
        organization_id: ORG_REP,
      },
    ],
  });

  const adminUser = await client.user.create({ data: { email: EMAIL_ADMIN, password_hash } });
  const adminBUser = await client.user.create({ data: { email: EMAIL_ADMIN_B, password_hash } });
  const opUser = await client.user.create({ data: { email: EMAIL_OP, password_hash } });
  adminId = adminUser.id;
  adminBId = adminBUser.id;
  opId = opUser.id;

  await client.roleAssignment.createMany({
    data: [
      { user_id: adminId, role: "admin", scope_type: "organization", scope_id: ORG_REP },
      { user_id: adminBId, role: "admin", scope_type: "organization", scope_id: ORG_REP_B },
      { user_id: opId, role: "operator", scope_type: "event", scope_id: EVENT_REP },
    ],
  });

  for (const userId of [adminId, adminBId]) {
    await client.userMfaMethod.create({
      data: {
        user_id: userId,
        type: "totp",
        secret_enc: encryptTotpSecret(generateTotpSecret()),
        confirmed_at: new Date(),
      },
    });
  }

  const admittedMorning = new Date("2026-10-01T08:15:00.000Z");
  const admittedPeak1 = new Date("2026-10-01T14:05:00.000Z");
  const admittedPeak2 = new Date("2026-10-01T14:22:00.000Z");
  const admittedPeak3 = new Date("2026-10-01T14:40:00.000Z");
  const admittedEvening = new Date("2026-10-01T18:30:00.000Z");

  await client.attendee.createMany({
    data: [
      {
        id: ATT_VIP_1,
        event_id: EVENT_REP,
        email: "vip1@example.com",
        name: "VIP One",
        ticket_type: "VIP",
        admitted_at: admittedMorning,
        ...mkAttendeeToken(),
      },
      {
        id: ATT_VIP_2,
        event_id: EVENT_REP,
        email: "vip2@example.com",
        name: "VIP Two",
        ticket_type: "VIP",
        admitted_at: admittedPeak1,
        ...mkAttendeeToken(),
      },
      {
        id: ATT_STD_1,
        event_id: EVENT_REP,
        email: "std1@example.com",
        name: "Standard One",
        ticket_type: "Standard",
        admitted_at: admittedPeak2,
        ...mkAttendeeToken(),
      },
      {
        id: ATT_STD_2,
        event_id: EVENT_REP,
        email: "std2@example.com",
        name: "Standard Two",
        ticket_type: "Standard",
        admitted_at: admittedPeak3,
        ...mkAttendeeToken(),
      },
      {
        id: ATT_STD_3,
        event_id: EVENT_REP,
        email: "std3@example.com",
        name: "Standard Three",
        ticket_type: "Standard",
        admitted_at: admittedEvening,
        ...mkAttendeeToken(),
      },
      {
        id: ATT_NO_SHOW,
        event_id: EVENT_REP,
        email: "noshow@example.com",
        name: "No Show Guest",
        ticket_type: "Standard",
        ...mkAttendeeToken(),
      },
    ],
  });

  await client.checkIn.createMany({
    data: [
      {
        attendee_id: ATT_VIP_1,
        event_id: EVENT_REP,
        checked_in_at: admittedMorning,
        status: "VALID",
        source: "scan",
        device_id: "scanner-01",
      },
      {
        attendee_id: ATT_VIP_2,
        event_id: EVENT_REP,
        checked_in_at: admittedPeak1,
        status: "VALID",
        source: "manual",
        device_id: "desk-01",
      },
      {
        attendee_id: ATT_STD_1,
        event_id: EVENT_REP,
        checked_in_at: admittedPeak2,
        status: "VALID",
        source: "scan",
        device_id: "scanner-02",
      },
    ],
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

  const adminSession = await createSession(prisma, { userId: adminId, stage: SESSION_STAGE.FULL });
  const adminBSession = await createSession(prisma, { userId: adminBId, stage: SESSION_STAGE.FULL });
  const opSession = await createSession(prisma, { userId: opId, stage: SESSION_STAGE.FULL });
  adminCookie = `admitto_session=${adminSession.rawToken}`;
  adminBCookie = `admitto_session=${adminBSession.rawToken}`;
  opCookie = `admitto_session=${opSession.rawToken}`;
});

afterAll(async () => {
  await prisma?.$disconnect();
});

describe("GET /api/admin/events/:eventId/reports", () => {
  it("returns 401 without auth", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_REP}/reports`);
    expect(res.status).toBe(401);
  });

  it("returns 403 for operator (staff admin gate)", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_REP}/reports`, {
      headers: { Cookie: opCookie },
    });
    expect(res.status).toBe(403);
  });

  it("returns 403 for admin without event org access", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_REP}/reports`, {
      headers: { Cookie: adminBCookie },
    });
    expect(res.status).toBe(403);
  });

  it("returns 404 for missing event", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_MISSING}/reports`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });

  it("returns zero-admission summary for empty event", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_EMPTY}/reports`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      summary: { total_attendees: number; admitted: number; no_shows: number };
      by_hour: Array<{ hour: string; count: number }>;
      admission_log: unknown[];
    };
    expect(body.summary.total_attendees).toBe(0);
    expect(body.summary.admitted).toBe(0);
    expect(body.summary.no_shows).toBe(0);
    expect(body.by_hour).toHaveLength(24);
    expect(body.by_hour.every((row) => row.count === 0)).toBe(true);
    expect(body.admission_log).toEqual([]);
  });

  it("returns aggregated stats, hourly buckets, ticket types, and admission log", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_REP}/reports`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      event: { id: string; title: string; capacity: number | null };
      summary: {
        total_attendees: number;
        admitted: number;
        no_shows: number;
        admission_rate_pct: number;
        peak_hour: string | null;
        peak_hour_count: number;
      };
      by_hour: Array<{ hour: string; count: number }>;
      by_ticket_type: Array<{
        type: string;
        total: number;
        admitted: number;
        admission_pct: number;
      }>;
      admission_log: Array<{
        attendee_id: string;
        name: string;
        device_id: string | null;
      }>;
      admission_log_truncated: boolean;
      admission_log_total: number;
    };

    expect(body.event.id).toBe(EVENT_REP);
    expect(body.event.capacity).toBe(500);
    expect(body.summary.total_attendees).toBe(6);
    expect(body.summary.admitted).toBe(5);
    expect(body.summary.no_shows).toBe(1);
    expect(body.summary.admission_rate_pct).toBe(83.3);
    expect(body.summary.peak_hour).toBe("14:00");
    expect(body.summary.peak_hour_count).toBe(3);

    expect(body.by_hour).toHaveLength(24);
    const hour08 = body.by_hour.find((row) => row.hour === "08:00");
    const hour14 = body.by_hour.find((row) => row.hour === "14:00");
    const hour18 = body.by_hour.find((row) => row.hour === "18:00");
    expect(hour08?.count).toBe(1);
    expect(hour14?.count).toBe(3);
    expect(hour18?.count).toBe(1);

    expect(body.by_ticket_type).toHaveLength(2);
    const standard = body.by_ticket_type.find((row) => row.type === "Standard");
    const vip = body.by_ticket_type.find((row) => row.type === "VIP");
    expect(standard).toMatchObject({ total: 4, admitted: 3, admission_pct: 75 });
    expect(vip).toMatchObject({ total: 2, admitted: 2, admission_pct: 100 });
    expect(body.by_ticket_type[0]!.type).toBe("Standard");

    expect(body.admission_log).toHaveLength(5);
    expect(body.admission_log_truncated).toBe(false);
    expect(body.admission_log_total).toBe(5);
    expect(body.admission_log[0]!.attendee_id).toBe(ATT_VIP_1);
    expect(body.admission_log[0]!.device_id).toBe("scanner-01");
    expect(body.admission_log[1]!.device_id).toBe("desk-01");
  });
});

describe("GET /api/admin/events/:eventId/reports/export", () => {
  it("returns 401 without auth", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_REP}/reports/export?format=csv`);
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid format", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_REP}/reports/export?format=xlsx`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("format must be csv or pdf");
  });

  it("returns CSV with BOM, headers, and admitted rows", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_REP}/reports/export?format=csv`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain('filename="admissions-reports-event-');

    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    expect(bytes[0]).toBe(0xef);
    expect(bytes[1]).toBe(0xbb);
    expect(bytes[2]).toBe(0xbf);
    const text = new TextDecoder().decode(buf);
    const lines = text.replace(/^\uFEFF/, "").split("\r\n");
    expect(lines[0]).toBe('"Name","Email","Ticket type","Admitted at","Device"');
    expect(lines.length).toBe(6);
    expect(lines[1]).toContain('"VIP One"');
    expect(lines[1]).toContain('"scanner-01"');
  });

  it("returns CSV headers only when no admissions", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_EMPTY}/reports/export?format=csv`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    const lines = text.replace(/^\uFEFF/, "").split("\r\n");
    expect(lines).toEqual(['"Name","Email","Ticket type","Admitted at","Device"']);
  });

  it("returns printable HTML for pdf format", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_REP}/reports/export?format=pdf`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("Reports Event");
    expect(html).toContain("By ticket type");
    expect(html).toContain("VIP One");
  });
});
