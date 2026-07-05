import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createSession, hashPassword, SESSION_STAGE } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { createApp } from "../../src/app.js";
import { createRateLimitStore } from "../../src/rate-limit/index.js";
import type { EventOverviewResponse } from "../../src/admin/overview-routes.js";
import { CAPACITY_EXCLUDED_STATUSES } from "../../src/admin/event-capacity.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");

const ORG_OV = "org-overview-test";
const ORG_OV_B = "org-overview-test-b";
const EVENT_MAIN = "evt-overview-main";
const EVENT_EMPTY = "evt-overview-empty";
const EVENT_ARCHIVED = "evt-overview-archived";
const EVENT_OTHER = "evt-overview-other";
const EVENT_CAP = "evt-overview-capacity";
const EVENT_MISSING = "evt-overview-missing";

const EMAIL_SUPER = "overview-super@example.com";
const EMAIL_ADMIN = "overview-admin@example.com";
const EMAIL_ADMIN_B = "overview-admin-b@example.com";
const EMAIL_OP = "overview-op@example.com";
const PASSWORD = "overview-test-pass-123";

const ATT_MAIN = Array.from({ length: 10 }, (_, i) => `att-overview-main-${i + 1}`);
const ATT_CAP = Array.from({ length: 150 }, (_, i) => `att-overview-cap-${i + 1}`);
const ATT_OTHER = "att-overview-other-1";
const ATT_EMAIL = Array.from({ length: 13 }, (_, i) => `att-overview-email-${i + 1}`);

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let superId: string;
let adminId: string;
let adminBId: string;
let opId: string;
let superCookie = "";
let adminCookie = "";
let adminBCookie = "";
let opCookie = "";

async function seed(client: PrismaClient) {
  const eventIds = [EVENT_MAIN, EVENT_EMPTY, EVENT_ARCHIVED, EVENT_OTHER, EVENT_CAP];
  await client.emailDelivery.deleteMany({ where: { event_id: { in: eventIds } } });
  await client.attendee.deleteMany({ where: { event_id: { in: eventIds } } });
  await client.roleAssignment.deleteMany({
    where: { OR: [{ scope_id: { in: [ORG_OV, ORG_OV_B, ...eventIds] } }] },
  });
  await client.session.deleteMany({
    where: { user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN, EMAIL_ADMIN_B, EMAIL_OP] } } },
  });
  await client.userMfaMethod.deleteMany({
    where: { user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN, EMAIL_ADMIN_B] } } },
  });
  await client.user.deleteMany({
    where: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN, EMAIL_ADMIN_B, EMAIL_OP] } },
  });
  await client.roleAssignment.deleteMany({
    where: { user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN, EMAIL_ADMIN_B, EMAIL_OP] } } },
  });
  await client.event.deleteMany({ where: { id: { in: eventIds } } });
  await client.organization.deleteMany({ where: { id: { in: [ORG_OV, ORG_OV_B] } } });

  const password_hash = await hashPassword(PASSWORD);

  await client.organization.createMany({
    data: [
      { id: ORG_OV, name: "Overview Org", slug: "overview-org" },
      { id: ORG_OV_B, name: "Overview Org B", slug: "overview-org-b" },
    ],
  });

  await client.event.createMany({
    data: [
      {
        id: EVENT_MAIN,
        title: "Overview Main Event",
        slug: "overview-main",
        date: new Date("2026-10-01T12:00:00.000Z"),
        timezone: "Europe/Warsaw",
        organization_id: ORG_OV,
      },
      {
        id: EVENT_EMPTY,
        title: "Overview Empty Event",
        slug: "overview-empty",
        date: new Date("2026-11-01T12:00:00.000Z"),
        organization_id: ORG_OV,
      },
      {
        id: EVENT_ARCHIVED,
        title: "Overview Archived Event",
        slug: "overview-archived",
        date: new Date("2026-09-01T12:00:00.000Z"),
        organization_id: ORG_OV,
        archived_at: new Date("2026-08-15T10:00:00.000Z"),
      },
      {
        id: EVENT_OTHER,
        title: "Overview Other Event",
        slug: "overview-other",
        date: new Date("2026-12-01T12:00:00.000Z"),
        organization_id: ORG_OV,
      },
      {
        id: EVENT_CAP,
        title: "Overview Capacity Event",
        slug: "overview-capacity",
        date: new Date("2027-01-01T12:00:00.000Z"),
        capacity: 200,
        organization_id: ORG_OV,
      },
    ],
  });

  const superUser = await client.user.create({ data: { email: EMAIL_SUPER, password_hash } });
  const adminUser = await client.user.create({ data: { email: EMAIL_ADMIN, password_hash } });
  const adminBUser = await client.user.create({ data: { email: EMAIL_ADMIN_B, password_hash } });
  const opUser = await client.user.create({ data: { email: EMAIL_OP, password_hash } });
  superId = superUser.id;
  adminId = adminUser.id;
  adminBId = adminBUser.id;
  opId = opUser.id;

  await client.roleAssignment.createMany({
    data: [
      { user_id: adminId, role: "admin", scope_type: "organization", scope_id: ORG_OV },
      { user_id: adminBId, role: "admin", scope_type: "organization", scope_id: ORG_OV_B },
      { user_id: opId, role: "operator", scope_type: "event", scope_id: EVENT_MAIN },
    ],
  });

  const existingInstanceSuper = await client.roleAssignment.findFirst({
    where: { role: "superadmin", scope_type: "instance" },
    select: { id: true },
  });
  if (existingInstanceSuper) {
    await client.roleAssignment.update({
      where: { id: existingInstanceSuper.id },
      data: { user_id: superId },
    });
  } else {
    await client.roleAssignment.create({
      data: { user_id: superId, role: "superadmin", scope_type: "instance", scope_id: null },
    });
  }

  for (const userId of [superId, adminId, adminBId]) {
    await client.userMfaMethod.create({
      data: {
        user_id: userId,
        type: "totp",
        secret_enc: encryptTotpSecret(generateTotpSecret()),
        confirmed_at: new Date(),
      },
    });
  }

  await client.attendee.createMany({
    data: ATT_MAIN.map((id, i) => ({
      id,
      event_id: EVENT_MAIN,
      email: `guest-main-${i + 1}@example.com`,
      name: `Guest Main ${i + 1}`,
      admitted_at: i < 4 ? new Date("2026-10-01T14:00:00.000Z") : null,
    })),
  });

  await client.attendee.createMany({
    data: ATT_CAP.map((id, i) => ({
      id,
      event_id: EVENT_CAP,
      email: `guest-cap-${i + 1}@example.com`,
      name: `Guest Cap ${i + 1}`,
    })),
  });

  await client.attendee.create({
    data: {
      id: ATT_OTHER,
      event_id: EVENT_OTHER,
      email: "other-guest@example.com",
      name: "Other Guest",
    },
  });

  await client.attendee.createMany({
    data: ATT_EMAIL.map((id, i) => ({
      id,
      event_id: EVENT_MAIN,
      email: `guest-email-${i + 1}@example.com`,
      name: `Guest Email ${i + 1}`,
    })),
  });

  const emailStatuses: Array<{ id: string; attendee_id: string; status: string }> = [
    ...ATT_EMAIL.slice(0, 5).map((attendee_id, i) => ({
      id: `del-overview-sent-${i + 1}`,
      attendee_id,
      status: "sent",
    })),
    ...ATT_EMAIL.slice(5, 7).map((attendee_id, i) => ({
      id: `del-overview-delivered-${i + 1}`,
      attendee_id,
      status: "delivered",
    })),
    { id: "del-overview-accepted-1", attendee_id: ATT_EMAIL[7]!, status: "accepted" },
    { id: "del-overview-failed-1", attendee_id: ATT_EMAIL[8]!, status: "failed" },
    { id: "del-overview-bounced-1", attendee_id: ATT_EMAIL[9]!, status: "bounced" },
    ...ATT_EMAIL.slice(10, 13).map((attendee_id, i) => ({
      id: `del-overview-queued-${i + 1}`,
      attendee_id,
      status: "queued",
    })),
  ];

  for (const row of emailStatuses) {
    await client.emailDelivery.create({
      data: {
        id: row.id,
        organization_id: ORG_OV,
        event_id: EVENT_MAIN,
        attendee_id: row.attendee_id,
        purpose: "initial",
        provider: "export_only",
        status: row.status,
        recipient_email: "guest@example.com",
      },
    });
  }

  await client.emailDelivery.create({
    data: {
      id: "del-overview-other-sent",
      organization_id: ORG_OV,
      event_id: EVENT_OTHER,
      attendee_id: ATT_OTHER,
      purpose: "initial",
      provider: "export_only",
      status: "sent",
      recipient_email: "other-guest@example.com",
    },
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

  const superSession = await createSession(prisma, { userId: superId, stage: SESSION_STAGE.FULL });
  const adminSession = await createSession(prisma, { userId: adminId, stage: SESSION_STAGE.FULL });
  const adminBSession = await createSession(prisma, { userId: adminBId, stage: SESSION_STAGE.FULL });
  const opSession = await createSession(prisma, { userId: opId, stage: SESSION_STAGE.FULL });
  superCookie = `admitto_session=${superSession.rawToken}`;
  adminCookie = `admitto_session=${adminSession.rawToken}`;
  adminBCookie = `admitto_session=${adminBSession.rawToken}`;
  opCookie = `admitto_session=${opSession.rawToken}`;
});

afterAll(async () => {
  await prisma?.$disconnect();
});

describe("GET /api/admin/events/:eventId/overview", () => {
  it("returns 401 without auth", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_MAIN}/overview`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("authentication_required");
  });

  it("returns 403 for operator (staff admin gate)", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_MAIN}/overview`, {
      headers: { Cookie: opCookie },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("forbidden");
  });

  it("returns 403 for admin without event org access", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_MAIN}/overview`, {
      headers: { Cookie: adminBCookie },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("forbidden");
  });

  it("returns 403 for missing event (no existence leak to org admins)", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_MISSING}/overview`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("forbidden");
  });

  it("returns 403 for cross-org admin on missing event (same as forbidden)", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_MISSING}/overview`, {
      headers: { Cookie: adminBCookie },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("forbidden");
  });

  it("returns 404 for non-existent event (superadmin)", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_MISSING}/overview`, {
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });

  it("returns zero stats for empty event", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_EMPTY}/overview`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EventOverviewResponse;
    expect(body.admitted_count).toBe(0);
    expect(body.attendee_count).toBe(0);
    expect(body.email_sent).toBe(0);
    expect(body.email_failed).toBe(0);
    expect(body.email_bounced).toBe(0);
    expect(body.email_queued).toBe(0);
    expect(body.requirements_count).toBe(0);
    expect(body.checkin_staff_count).toBe(0);
  });

  it("returns admitted_count scoped to active attendees", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_MAIN}/overview`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EventOverviewResponse;
    expect(body.event.timezone).toBe("Europe/Warsaw");
    expect(body.checkin_staff_count).toBe(1);
    const activeWhere = {
      event_id: EVENT_MAIN,
      status: { notIn: [...CAPACITY_EXCLUDED_STATUSES] },
    };
    const activeAdmitted = await prisma.attendee.count({
      where: { ...activeWhere, admitted_at: { not: null } },
    });
    expect(body.admitted_count).toBe(4);
    expect(body.admitted_count).toBe(activeAdmitted);
    expect(body.admitted_count).toBeLessThanOrEqual(body.attendee_count);
    expect(body.attendee_count).toBe(await prisma.attendee.count({ where: activeWhere }));
  });

  it("excludes revoked attendees from attendee_count and admitted_count", async () => {
    const prior = await prisma.attendee.findUniqueOrThrow({
      where: { id: ATT_MAIN[0] },
      select: { status: true },
    });
    try {
      await prisma.attendee.update({
        where: { id: ATT_MAIN[0] },
        data: { status: "revoked" },
      });
      const res = await app.request(`/api/admin/events/${EVENT_MAIN}/overview`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as EventOverviewResponse;
      const activeWhere = {
        event_id: EVENT_MAIN,
        status: { notIn: [...CAPACITY_EXCLUDED_STATUSES] },
      };
      expect(body.attendee_count).toBe(await prisma.attendee.count({ where: activeWhere }));
      expect(body.admitted_count).toBe(
        await prisma.attendee.count({
          where: { ...activeWhere, admitted_at: { not: null } },
        }),
      );
      expect(body.admitted_count).toBeLessThanOrEqual(body.attendee_count);
    } finally {
      await prisma.attendee.update({
        where: { id: ATT_MAIN[0] },
        data: { status: prior.status },
      });
    }
  });

  it("aggregates email delivery stats", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_MAIN}/overview`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EventOverviewResponse;
    expect(body.email_sent).toBe(8);
    expect(body.email_failed).toBe(1);
    expect(body.email_bounced).toBe(1);
    expect(body.email_queued).toBe(3);
  });

  it("returns capacity and attendee_count", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_CAP}/overview`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EventOverviewResponse;
    expect(body.event.capacity).toBe(200);
    expect(body.attendee_count).toBe(150);
  });

  it("returns archived_at for archived event", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_ARCHIVED}/overview`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EventOverviewResponse;
    expect(body.event.archived_at).not.toBeNull();
  });

  it("does not include email deliveries from other events", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_EMPTY}/overview`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EventOverviewResponse;
    expect(body.email_sent).toBe(0);
    expect(body.email_failed).toBe(0);
    expect(body.email_bounced).toBe(0);
    expect(body.email_queued).toBe(0);
  });
});
