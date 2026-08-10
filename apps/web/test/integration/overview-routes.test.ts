import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
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
const EVENT_ACTIVITY = "evt-overview-activity";
const EVENT_REVOKED_CHECKIN = "evt-overview-revoked-checkin";
const EVENT_BOUNCE_RESOLUTION = "evt-overview-bounce-resolution";

const EMAIL_SUPER = "overview-super@example.com";
const EMAIL_ADMIN = "overview-admin@example.com";
const EMAIL_ADMIN_B = "overview-admin-b@example.com";
const EMAIL_OP = "overview-op@example.com";
const PASSWORD = "overview-test-pass-123";

const ATT_MAIN = Array.from({ length: 10 }, (_, i) => `att-overview-main-${i + 1}`);
const ATT_CAP = Array.from({ length: 150 }, (_, i) => `att-overview-cap-${i + 1}`);
const ATT_OTHER = "att-overview-other-1";
const ATT_EMAIL = Array.from({ length: 13 }, (_, i) => `att-overview-email-${i + 1}`);

const ATT_ACT_STD_1 = "att-overview-activity-std-1";
const ATT_ACT_STD_2 = "att-overview-activity-std-2";
const ATT_ACT_VIP_1 = "att-overview-activity-vip-1";
const ATT_ACT_NONE = "att-overview-activity-none";
const ATT_ACT_REVOKED = "att-overview-activity-revoked";

const ATT_REVOKED_1 = "att-overview-revoked-checkin-1";
const ATT_REVOKED_2 = "att-overview-revoked-checkin-2";

// One attendee per bounce-resolution scenario - see countCurrentlyBouncedAttendees.
const ATT_BOUNCE_RESOLVED_BY_RESEND = "att-overview-bounce-resolved-by-resend";
const ATT_BOUNCE_DISMISSED = "att-overview-bounce-dismissed";
const ATT_BOUNCE_REBOUNCED_AFTER_DISMISS = "att-overview-bounce-rebounced-after-dismiss";

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
  const eventIds = [
    EVENT_MAIN,
    EVENT_EMPTY,
    EVENT_ARCHIVED,
    EVENT_OTHER,
    EVENT_CAP,
    EVENT_ACTIVITY,
    EVENT_REVOKED_CHECKIN,
    EVENT_BOUNCE_RESOLUTION,
  ];
  await client.checkIn.deleteMany({ where: { event_id: { in: eventIds } } });
  await client.attendeeActionLog.deleteMany({ where: { event_id: { in: eventIds } } });
  await client.emailDelivery.deleteMany({ where: { event_id: { in: eventIds } } });
  await client.attendee.deleteMany({ where: { event_id: { in: eventIds } } });
  await client.ticketType.deleteMany({ where: { event_id: { in: eventIds } } });
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
      {
        id: EVENT_ACTIVITY,
        title: "Overview Activity Event",
        slug: "overview-activity",
        date: new Date("2027-02-01T12:00:00.000Z"),
        // UTC keeps hour-bucketing assertions below trivial to reason about.
        timezone: "UTC",
        organization_id: ORG_OV,
      },
      {
        id: EVENT_REVOKED_CHECKIN,
        title: "Overview Revoked Check-in Event",
        slug: "overview-revoked-checkin",
        date: new Date("2027-03-01T12:00:00.000Z"),
        timezone: "UTC",
        organization_id: ORG_OV,
      },
      {
        id: EVENT_BOUNCE_RESOLUTION,
        title: "Overview Bounce Resolution Event",
        slug: "overview-bounce-resolution",
        date: new Date("2027-04-01T12:00:00.000Z"),
        timezone: "UTC",
        organization_id: ORG_OV,
      },
    ],
  });

  await client.ticketType.createMany({
    data: [
      { event_id: EVENT_ACTIVITY, key: "standard", label: "Standard", color: "gray", sort_order: 0 },
      { event_id: EVENT_ACTIVITY, key: "vip", label: "VIP", color: "purple", sort_order: 1 },
      { event_id: EVENT_ACTIVITY, key: "press", label: "Press", color: "blue", sort_order: 2 },
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

  await client.attendee.createMany({
    data: [
      {
        id: ATT_ACT_STD_1,
        event_id: EVENT_ACTIVITY,
        email: "activity-std-1@example.com",
        name: "Activity Standard One",
        ticket_type: "standard",
        // Mirrors the matching VALID check-in below - admit.ts always sets both together.
        admitted_at: new Date("2027-02-01T08:00:00.000Z"),
      },
      {
        id: ATT_ACT_STD_2,
        event_id: EVENT_ACTIVITY,
        email: "activity-std-2@example.com",
        name: "Activity Standard Two",
        ticket_type: "standard",
        admitted_at: new Date("2027-02-01T08:30:00.000Z"),
      },
      {
        id: ATT_ACT_VIP_1,
        event_id: EVENT_ACTIVITY,
        email: "activity-vip-1@example.com",
        name: "Activity VIP One",
        ticket_type: "vip",
        admitted_at: new Date("2027-02-01T10:00:00.000Z"),
      },
      {
        id: ATT_ACT_NONE,
        event_id: EVENT_ACTIVITY,
        email: "activity-none@example.com",
        name: "Activity No Type",
      },
      {
        id: ATT_ACT_REVOKED,
        event_id: EVENT_ACTIVITY,
        email: "activity-revoked@example.com",
        name: "Activity Revoked",
        ticket_type: "standard",
        status: "revoked",
      },
    ],
  });

  // Two VALID check-ins land in the 08:00 hour (busiest), one in 10:00 (most recent overall).
  // The 23:00 ALREADY_CHECKED_IN row is later still but must not count for either stat.
  await client.checkIn.createMany({
    data: [
      {
        id: "checkin-overview-activity-1",
        attendee_id: ATT_ACT_STD_1,
        event_id: EVENT_ACTIVITY,
        checked_in_at: new Date("2027-02-01T08:00:00.000Z"),
        status: "VALID",
        source: "scan",
      },
      {
        id: "checkin-overview-activity-2",
        attendee_id: ATT_ACT_STD_2,
        event_id: EVENT_ACTIVITY,
        checked_in_at: new Date("2027-02-01T08:30:00.000Z"),
        status: "VALID",
        source: "manual",
      },
      {
        id: "checkin-overview-activity-3",
        attendee_id: ATT_ACT_VIP_1,
        event_id: EVENT_ACTIVITY,
        checked_in_at: new Date("2027-02-01T10:00:00.000Z"),
        status: "VALID",
        source: "scan",
      },
      {
        id: "checkin-overview-activity-noise",
        attendee_id: ATT_ACT_NONE,
        event_id: EVENT_ACTIVITY,
        checked_in_at: new Date("2027-02-01T23:00:00.000Z"),
        status: "ALREADY_CHECKED_IN",
        source: "scan",
      },
    ],
  });

  await client.emailDelivery.createMany({
    data: [
      {
        id: "del-overview-activity-bounced",
        organization_id: ORG_OV,
        event_id: EVENT_ACTIVITY,
        attendee_id: ATT_ACT_STD_1,
        purpose: "initial",
        provider: "export_only",
        status: "bounced",
        recipient_email: "bounced-guest@example.com",
        failed_at: new Date("2027-02-01T09:00:00.000Z"),
      },
      {
        id: "del-overview-activity-failed",
        organization_id: ORG_OV,
        event_id: EVENT_ACTIVITY,
        attendee_id: ATT_ACT_VIP_1,
        purpose: "initial",
        provider: "export_only",
        status: "failed",
        recipient_email: "failed-guest@example.com",
        failed_at: new Date("2027-02-01T07:00:00.000Z"),
      },
    ],
  });

  await client.attendeeActionLog.create({
    data: {
      id: "log-overview-activity-import",
      event_id: EVENT_ACTIVITY,
      action_type: "attendees_imported",
      created_at: new Date("2027-02-01T06:00:00.000Z"),
      metadata: { filename: "activity-guests.csv", created: 3, updated: 1, skipped: 0 },
    },
  });

  // Regression fixture for the "revoke all check-ins" bug: both attendees were checked in and
  // later had that check-in revoked (admitted_at cleared, mirroring revokeCheckInMutation), but
  // undo.ts never touches the original CheckIn row it superseded - it only appends a new UNDO row
  // - so a stale "status: VALID" row is still sitting in the table for each of them. Neither
  // attendee is currently admitted, so last_check_in_at/busiest_hour must come back null instead
  // of reflecting these now-stale rows.
  await client.attendee.createMany({
    data: [
      {
        id: ATT_REVOKED_1,
        event_id: EVENT_REVOKED_CHECKIN,
        email: "revoked-checkin-1@example.com",
        name: "Revoked Checkin One",
      },
      {
        id: ATT_REVOKED_2,
        event_id: EVENT_REVOKED_CHECKIN,
        email: "revoked-checkin-2@example.com",
        name: "Revoked Checkin Two",
      },
    ],
  });

  await client.checkIn.createMany({
    data: [
      {
        id: "checkin-overview-revoked-1-valid",
        attendee_id: ATT_REVOKED_1,
        event_id: EVENT_REVOKED_CHECKIN,
        checked_in_at: new Date("2027-03-01T09:00:00.000Z"),
        status: "VALID",
        source: "scan",
      },
      {
        id: "checkin-overview-revoked-1-undo",
        attendee_id: ATT_REVOKED_1,
        event_id: EVENT_REVOKED_CHECKIN,
        checked_in_at: new Date("2027-03-01T09:05:00.000Z"),
        status: "UNDO",
        source: "admin_revoke",
      },
      {
        id: "checkin-overview-revoked-2-valid",
        attendee_id: ATT_REVOKED_2,
        event_id: EVENT_REVOKED_CHECKIN,
        checked_in_at: new Date("2027-03-01T09:30:00.000Z"),
        status: "VALID",
        source: "scan",
      },
      {
        id: "checkin-overview-revoked-2-undo",
        attendee_id: ATT_REVOKED_2,
        event_id: EVENT_REVOKED_CHECKIN,
        checked_in_at: new Date("2027-03-01T09:35:00.000Z"),
        status: "UNDO",
        source: "admin_revoke",
      },
    ],
  });

  // Three attendees, one per countCurrentlyBouncedAttendees scenario - see the "currently
  // bounced" describe block below for what each must resolve to.
  await client.attendee.createMany({
    data: [
      {
        id: ATT_BOUNCE_RESOLVED_BY_RESEND,
        event_id: EVENT_BOUNCE_RESOLUTION,
        email: "bounce-resolved-by-resend@example.com",
        name: "Bounce Resolved By Resend",
      },
      {
        id: ATT_BOUNCE_DISMISSED,
        event_id: EVENT_BOUNCE_RESOLUTION,
        email: "bounce-dismissed@example.com",
        name: "Bounce Dismissed",
        email_bounce_dismissed_at: new Date("2027-04-01T09:10:00.000Z"),
      },
      {
        id: ATT_BOUNCE_REBOUNCED_AFTER_DISMISS,
        event_id: EVENT_BOUNCE_RESOLUTION,
        email: "bounce-rebounced-after-dismiss@example.com",
        name: "Bounce Rebounced After Dismiss",
        email_bounce_dismissed_at: new Date("2027-04-01T09:00:00.000Z"),
      },
    ],
  });

  await client.emailDelivery.createMany({
    data: [
      // Bounced, then a later successful resend - the latest row is what counts, so this
      // attendee must NOT be in the currently-bounced count.
      {
        id: "del-bounce-resolved-1",
        organization_id: ORG_OV,
        event_id: EVENT_BOUNCE_RESOLUTION,
        attendee_id: ATT_BOUNCE_RESOLVED_BY_RESEND,
        purpose: "initial",
        provider: "export_only",
        status: "bounced",
        recipient_email: "bounce-resolved-by-resend@example.com",
        created_at: new Date("2027-04-01T09:00:00.000Z"),
      },
      {
        id: "del-bounce-resolved-2",
        organization_id: ORG_OV,
        event_id: EVENT_BOUNCE_RESOLUTION,
        attendee_id: ATT_BOUNCE_RESOLVED_BY_RESEND,
        purpose: "resend",
        provider: "export_only",
        status: "sent",
        recipient_email: "bounce-resolved-by-resend@example.com",
        created_at: new Date("2027-04-01T09:05:00.000Z"),
      },
      // Bounced, then dismissed after that bounce - must NOT be in the count.
      {
        id: "del-bounce-dismissed-1",
        organization_id: ORG_OV,
        event_id: EVENT_BOUNCE_RESOLUTION,
        attendee_id: ATT_BOUNCE_DISMISSED,
        purpose: "initial",
        provider: "export_only",
        status: "bounced",
        recipient_email: "bounce-dismissed@example.com",
        created_at: new Date("2027-04-01T09:00:00.000Z"),
      },
      // Dismissed, then bounced again afterwards - new information, must be back in the count.
      {
        id: "del-bounce-rebounced-1",
        organization_id: ORG_OV,
        event_id: EVENT_BOUNCE_RESOLUTION,
        attendee_id: ATT_BOUNCE_REBOUNCED_AFTER_DISMISS,
        purpose: "initial",
        provider: "export_only",
        status: "bounced",
        recipient_email: "bounce-rebounced-after-dismiss@example.com",
        created_at: new Date("2027-04-01T09:10:00.000Z"),
      },
    ],
  });
}

beforeAll(async () => {
  prisma = createTestPrismaClient();
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
    // EVENT_EMPTY has no event-level operators, but ORG_OV admin can perform check-in
    expect(body.checkin_staff_count).toBe(1);
    expect(body.attendees_with_ticket).toBe(0);
    expect(body.last_check_in_at).toBeNull();
    expect(body.busiest_hour).toBeNull();
    expect(body.ticket_type_breakdown).toEqual([]);
    expect(body.recent_activity).toEqual([]);
  });

  it("returns admitted_count scoped to active attendees", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_MAIN}/overview`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EventOverviewResponse;
    expect(body.event.timezone).toBe("Europe/Warsaw");
    // 1 event-level operator (opId) + 1 org admin (adminId) for ORG_OV
    expect(body.checkin_staff_count).toBe(2);
    // 5 sent + 2 delivered + 1 accepted = 8 distinct attendees with initial ticket
    expect(body.attendees_with_ticket).toBe(8);
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

  it("email_bounced counts the attendee's latest delivery, not every historically-bounced row", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_BOUNCE_RESOLUTION}/overview`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EventOverviewResponse;
    // Only ATT_BOUNCE_REBOUNCED_AFTER_DISMISS's latest delivery is a live, undismissed bounce -
    // the resolved-by-resend and dismissed-before-rebounce attendees are both excluded.
    expect(body.email_bounced).toBe(1);
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

  it("returns last_check_in_at and busiest_hour scoped to VALID check-ins", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_ACTIVITY}/overview`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EventOverviewResponse;
    // Most recent VALID check-in is 10:00; the later 23:00 row is ALREADY_CHECKED_IN and must
    // not count.
    expect(body.last_check_in_at).toBe("2027-02-01T10:00:00.000Z");
    // Two VALID check-ins land in the 08:00 hour, one in 10:00 - 08:00 wins.
    expect(body.busiest_hour).toEqual({ hour: "08:00", count: 2 });
  });

  it("resets last_check_in_at and busiest_hour to null once every check-in is revoked", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_REVOKED_CHECKIN}/overview`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EventOverviewResponse;
    // Both attendees' original VALID check-in row is still sitting in the CheckIn table (undo.ts
    // never deletes it, see the seed fixture's comment) but neither is currently admitted -
    // reading last_check_in_at/busiest_hour off that stale row instead of admitted_at was exactly
    // the bug (#reported: "revoke all check-ins" still showed the old busiest hour/last check-in).
    expect(body.admitted_count).toBe(0);
    expect(body.last_check_in_at).toBeNull();
    expect(body.busiest_hour).toBeNull();
  });

  it("returns ticket_type_breakdown for active attendees only, zero-count types omitted", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_ACTIVITY}/overview`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EventOverviewResponse;
    // "press" has 0 attendees (omitted); the revoked "standard" attendee doesn't count.
    expect(body.ticket_type_breakdown).toEqual([
      { key: "standard", label: "Standard", color: "gray", count: 2 },
      { key: "vip", label: "VIP", color: "purple", count: 1 },
    ]);
  });

  it("returns recent_activity merged newest-first across check-ins, mail failures, and imports", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_ACTIVITY}/overview`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EventOverviewResponse;

    expect(body.recent_activity.map((entry) => entry.occurred_at)).toEqual([
      "2027-02-01T10:00:00.000Z",
      "2027-02-01T09:00:00.000Z",
      "2027-02-01T08:30:00.000Z",
      "2027-02-01T08:00:00.000Z",
      "2027-02-01T07:00:00.000Z",
      "2027-02-01T06:00:00.000Z",
    ]);

    const [checkin, bounced, , , failed, imported] = body.recent_activity;
    expect(checkin).toMatchObject({
      type: "checkin",
      tone: "ok",
      attendee_name: "Activity VIP One",
      attendee_id: ATT_ACT_VIP_1,
      message: "checked in",
    });
    expect(bounced).toMatchObject({
      type: "mail_bounced",
      tone: "error",
      attendee_id: ATT_ACT_STD_1,
      message: "Ticket email bounced for bounced-guest@example.com",
    });
    expect(failed).toMatchObject({
      type: "mail_failed",
      tone: "error",
      attendee_id: ATT_ACT_VIP_1,
      message: "Ticket email failed for failed-guest@example.com",
    });
    expect(imported).toMatchObject({
      type: "import",
      tone: "muted",
      attendee_id: null,
      message: "4 attendees imported",
    });
    // Length 6 (not 7) confirms the 23:00 ALREADY_CHECKED_IN noise row was excluded - a VALID-only
    // check-in there would otherwise sort first, ahead of the 10:00 entry asserted above.
    expect(body.recent_activity).toHaveLength(6);
  });
});
