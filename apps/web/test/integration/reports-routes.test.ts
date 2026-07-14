import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, Prisma } from "@prisma/client";
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

/** Simulates an attendee row whose ticket_type doesn't (or won't) match any TicketType row - data
 * written outside the app's normal write paths, which the (event_id, ticket_type) FK (migration
 * 20260714210009_add_attendee_ticket_type_fk) now enforces for every real insert. Bypassed here
 * with Postgres's standard session_replication_role mechanism (same technique used in
 * packages/db/test/backfill-ticket-types.test.ts), scoped to one transaction so it can't leak. */
async function createUnvalidatedAttendees(
  client: PrismaClient,
  data: Prisma.AttendeeCreateManyInput[],
): Promise<void> {
  await client.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET session_replication_role = replica`);
    await tx.attendee.createMany({ data });
    await tx.$executeRawUnsafe(`SET session_replication_role = DEFAULT`);
  });
}

async function seed(client: PrismaClient) {
  const eventIds = [EVENT_REP, EVENT_REP_B, EVENT_EMPTY];
  await client.checkIn.deleteMany({ where: { event_id: { in: eventIds } } });
  await client.attendeeActionLog.deleteMany({ where: { event_id: { in: eventIds } } });
  await client.attendee.deleteMany({ where: { event_id: { in: eventIds } } });
  await client.ticketType.deleteMany({ where: { event_id: { in: eventIds } } });
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

  await client.ticketType.createMany({
    data: [
      { event_id: EVENT_REP, key: "Standard", label: "Standard", sort_order: 0 },
      { event_id: EVENT_REP, key: "VIP", label: "VIP", color: "purple", sort_order: 1 },
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

  it("returns 403 for missing event (no existence leak to org admins)", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_MISSING}/reports`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("forbidden");
  });

  it("returns 403 for cross-org admin on missing event (same as forbidden)", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_MISSING}/reports`, {
      headers: { Cookie: adminBCookie },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("forbidden");
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
    expect(body.by_ticket_type[0]).toMatchObject({ key: "Standard", color: "gray" });
    expect(body.by_ticket_type[1]).toMatchObject({ key: "VIP", color: "purple" });
  });

  it("shows a catalog type with zero attendees, and a trailing (none) bucket for untyped attendees (batch 04 / #387)", async () => {
    const EVENT_CAT = "evt-reports-catalog";
    await prisma.attendee.deleteMany({ where: { event_id: EVENT_CAT } });
    await prisma.ticketType.deleteMany({ where: { event_id: EVENT_CAT } });
    await prisma.event.deleteMany({ where: { id: EVENT_CAT } });
    await prisma.event.create({
      data: {
        id: EVENT_CAT,
        title: "Catalog Reports Event",
        slug: "reports-event-catalog",
        date: new Date("2026-10-01T12:00:00.000Z"),
        organization_id: ORG_REP,
      },
    });
    await prisma.ticketType.createMany({
      data: [
        { event_id: EVENT_CAT, key: "standard", label: "Standard", sort_order: 0 },
        { event_id: EVENT_CAT, key: "press", label: "Press", color: "teal", sort_order: 1 },
      ],
    });
    await prisma.attendee.createMany({
      data: [
        {
          id: "att-rep-cat-1",
          event_id: EVENT_CAT,
          email: "cat1@example.com",
          name: "Typed",
          ticket_type: "standard",
          admitted_at: new Date("2026-10-01T09:00:00.000Z"),
          ...mkAttendeeToken(),
        },
        {
          id: "att-rep-cat-2",
          event_id: EVENT_CAT,
          email: "cat2@example.com",
          name: "Untyped",
          admitted_at: new Date("2026-10-01T09:05:00.000Z"),
          ...mkAttendeeToken(),
        },
      ],
    });

    try {
      const res = await app.request(`/api/admin/events/${EVENT_CAT}/reports`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        by_ticket_type: Array<{ key: string | null; type: string; color: string; total: number }>;
      };
      // "press" has 0 attendees but still appears (catalog-driven, not grouped from raw data).
      expect(body.by_ticket_type).toHaveLength(3);
      expect(body.by_ticket_type[0]).toMatchObject({ key: "standard", type: "Standard", total: 1 });
      expect(body.by_ticket_type[1]).toMatchObject({ key: "press", type: "Press", total: 0 });
      expect(body.by_ticket_type[2]).toMatchObject({ key: null, type: "(none)", total: 1 });
    } finally {
      await prisma.attendee.deleteMany({ where: { event_id: EVENT_CAT } });
      await prisma.ticketType.deleteMany({ where: { event_id: EVENT_CAT } });
      await prisma.event.deleteMany({ where: { id: EVENT_CAT } });
    }
  });

  it("folds a literal empty-string ticket_type into the (none) bucket instead of a confusing separate entry (CodeRabbit review)", async () => {
    const EVENT_BLANK = "evt-reports-blank";
    await prisma.attendee.deleteMany({ where: { event_id: EVENT_BLANK } });
    await prisma.ticketType.deleteMany({ where: { event_id: EVENT_BLANK } });
    await prisma.event.deleteMany({ where: { id: EVENT_BLANK } });
    await prisma.event.create({
      data: {
        id: EVENT_BLANK,
        title: "Blank Reports Event",
        slug: "reports-event-blank",
        date: new Date("2026-10-01T12:00:00.000Z"),
        organization_id: ORG_REP,
      },
    });
    await prisma.attendee.create({
      data: {
        id: "att-rep-blank-null",
        event_id: EVENT_BLANK,
        email: "blank-null@example.com",
        name: "Null Type",
        admitted_at: new Date("2026-10-01T09:00:00.000Z"),
        ...mkAttendeeToken(),
      },
    });
    // Every app write path normalizes a blank submission to null before persisting - this
    // simulates data written outside those paths (e.g. raw SQL), which the DB column itself
    // doesn't forbid.
    await createUnvalidatedAttendees(prisma, [
      {
        id: "att-rep-blank-empty",
        event_id: EVENT_BLANK,
        email: "blank-empty@example.com",
        name: "Empty String Type",
        ticket_type: "",
        admitted_at: new Date("2026-10-01T09:05:00.000Z"),
        ...mkAttendeeToken(),
      },
    ]);

    try {
      const res = await app.request(`/api/admin/events/${EVENT_BLANK}/reports`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        by_ticket_type: Array<{ key: string | null; type: string; total: number }>;
      };
      expect(body.by_ticket_type).toHaveLength(1);
      expect(body.by_ticket_type[0]).toMatchObject({ key: null, type: "(none)", total: 2 });
    } finally {
      await prisma.attendee.deleteMany({ where: { event_id: EVENT_BLANK } });
      await prisma.ticketType.deleteMany({ where: { event_id: EVENT_BLANK } });
      await prisma.event.deleteMany({ where: { id: EVENT_BLANK } });
    }
  });

  it("still shows an attendee whose stored ticket_type has no matching catalog row, instead of dropping it from the breakdown (Codex review)", async () => {
    const EVENT_ORPHAN = "evt-reports-orphan";
    await prisma.attendee.deleteMany({ where: { event_id: EVENT_ORPHAN } });
    await prisma.ticketType.deleteMany({ where: { event_id: EVENT_ORPHAN } });
    await prisma.event.deleteMany({ where: { id: EVENT_ORPHAN } });
    await prisma.event.create({
      data: {
        id: EVENT_ORPHAN,
        title: "Orphan Reports Event",
        slug: "reports-event-orphan",
        date: new Date("2026-10-01T12:00:00.000Z"),
        organization_id: ORG_REP,
      },
    });
    await prisma.ticketType.create({
      data: { event_id: EVENT_ORPHAN, key: "standard", label: "Standard", sort_order: 0 },
    });
    await prisma.attendee.create({
      data: {
        id: "att-rep-orphan-1",
        event_id: EVENT_ORPHAN,
        email: "orphan1@example.com",
        name: "Typed",
        ticket_type: "standard",
        admitted_at: new Date("2026-10-01T09:00:00.000Z"),
        ...mkAttendeeToken(),
      },
    });
    // Simulates a type deleted after assignment, or data seeded outside the app's normal write
    // paths - the same scenario AttendeeDetailPage.tsx already shows as "(not in catalog)"
    // instead of silently dropping.
    await createUnvalidatedAttendees(prisma, [
      {
        id: "att-rep-orphan-2",
        event_id: EVENT_ORPHAN,
        email: "orphan2@example.com",
        name: "Stray",
        ticket_type: "deleted_type",
        admitted_at: new Date("2026-10-01T09:05:00.000Z"),
        ...mkAttendeeToken(),
      },
    ]);

    try {
      const res = await app.request(`/api/admin/events/${EVENT_ORPHAN}/reports`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        summary: { total_attendees: number };
        by_ticket_type: Array<{ key: string | null; type: string; color: string; total: number }>;
      };
      expect(body.summary.total_attendees).toBe(2);
      expect(body.by_ticket_type).toHaveLength(2);
      expect(body.by_ticket_type[0]).toMatchObject({ key: "standard", type: "Standard", total: 1 });
      expect(body.by_ticket_type[1]).toMatchObject({
        key: "deleted_type",
        type: "deleted_type (not in catalog)",
        color: "gray",
        total: 1,
      });
    } finally {
      await prisma.attendee.deleteMany({ where: { event_id: EVENT_ORPHAN } });
      await prisma.ticketType.deleteMany({ where: { event_id: EVENT_ORPHAN } });
      await prisma.event.deleteMany({ where: { id: EVENT_ORPHAN } });
    }
  });

  it("buckets hourly admissions in the event timezone, not raw UTC (#268)", async () => {
    const EVENT_TZ = "evt-reports-warsaw";
    await prisma.attendee.deleteMany({ where: { event_id: EVENT_TZ } });
    await prisma.event.deleteMany({ where: { id: EVENT_TZ } });
    await prisma.event.create({
      data: {
        id: EVENT_TZ,
        title: "Warsaw Reports Event",
        slug: "reports-event-warsaw",
        date: new Date("2026-10-01T12:00:00.000Z"),
        timezone: "Europe/Warsaw",
        organization_id: ORG_REP,
      },
    });
    await prisma.attendee.createMany({
      data: [
        {
          id: "att-rep-tz-1",
          event_id: EVENT_TZ,
          email: "tz1@example.com",
          name: "Afternoon Warsaw",
          // 14:05Z = 16:05 in Europe/Warsaw (CEST, +02:00)
          admitted_at: new Date("2026-10-01T14:05:00.000Z"),
          ...mkAttendeeToken(),
        },
        {
          id: "att-rep-tz-2",
          event_id: EVENT_TZ,
          email: "tz2@example.com",
          name: "Midnight Warsaw",
          // 22:30Z = 00:30 next day in Europe/Warsaw — crosses local midnight
          admitted_at: new Date("2026-10-01T22:30:00.000Z"),
          ...mkAttendeeToken(),
        },
      ],
    });

    try {
      const res = await app.request(`/api/admin/events/${EVENT_TZ}/reports`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { by_hour: Array<{ hour: string; count: number }> };
      const byHour = new Map(body.by_hour.map((row) => [row.hour, row.count]));
      expect(byHour.get("16:00")).toBe(1);
      expect(byHour.get("00:00")).toBe(1);
      // Raw-UTC buckets must stay empty — regression guard for the AT TIME ZONE fix.
      expect(byHour.get("14:00")).toBe(0);
      expect(byHour.get("22:00")).toBe(0);
    } finally {
      await prisma.attendee.deleteMany({ where: { event_id: EVENT_TZ } });
      await prisma.event.deleteMany({ where: { id: EVENT_TZ } });
    }
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

  it("returns 403 for operator on CSV export", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_REP}/reports/export?format=csv`, {
      headers: { Cookie: opCookie },
    });
    expect(res.status).toBe(403);
  });

  it("returns 403 for cross-org admin on PDF export", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_REP}/reports/export?format=pdf`, {
      headers: { Cookie: adminBCookie },
    });
    expect(res.status).toBe(403);
  });

  it("returns CSV with BOM, headers, and admitted rows", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_REP}/reports/export?format=csv`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain('filename="admissions-reports-event-');
    expect(res.headers.get("X-Admission-Log-Total")).toBe("5");
    expect(res.headers.get("X-Admission-Log-Truncated")).toBe("false");

    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    expect(bytes[0]).toBe(0xef);
    expect(bytes[1]).toBe(0xbb);
    expect(bytes[2]).toBe(0xbf);
    const text = new TextDecoder().decode(buf);
    const lines = text.replace(/^\uFEFF/, "").split("\r\n");
    expect(lines[0]).toContain('"Admitted at (');
    expect(lines.length).toBe(6);
    expect(lines[1]).toContain('"VIP One"');
    expect(lines[1]).toContain('"scanner-01"');
    expect(lines[1]).not.toMatch(/T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
  });

  it("returns CSV headers only when no admissions", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_EMPTY}/reports/export?format=csv`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Admission-Log-Total")).toBe("0");
    expect(res.headers.get("X-Admission-Log-Truncated")).toBe("false");
    const text = await res.text();
    const lines = text.replace(/^\uFEFF/, "").split("\r\n");
    expect(lines[0]).toContain('"Admitted at (');
    expect(lines.length).toBe(1);
  });

  it("returns printable HTML for pdf format", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_REP}/reports/export?format=pdf`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    expect(res.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    const html = await res.text();
    expect(html).toContain("Reports Event");
    expect(html).toContain("By ticket type");
    expect(html).toContain("VIP One");
  });

  it("audit: reports_exported with format and count after CSV export", async () => {
    await prisma.attendeeActionLog.deleteMany({
      where: { event_id: EVENT_REP, action_type: "reports_exported" },
    });

    const res = await app.request(`/api/admin/events/${EVENT_REP}/reports/export?format=csv`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);

    const log = await prisma.attendeeActionLog.findFirst({
      where: { event_id: EVENT_REP, action_type: "reports_exported" },
      orderBy: { created_at: "desc" },
    });
    expect(log).not.toBeNull();
    expect(log!.attendee_id).toBeNull();
    const meta = log!.metadata as Record<string, unknown>;
    expect(meta.format).toBe("csv");
    expect(meta.count).toBe(5);
    expect(meta.truncated).toBe(false);
  });
});
