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

const ORG_TT = "org-ticket-types";
const EVENT_TT = "evt-ticket-types";
const EVENT_TT_OTHER = "evt-ticket-types-other";

const EMAIL_ADMIN = "ticket-types-admin@example.com";
const EMAIL_OP = "ticket-types-op@example.com";
const PASSWORD = "ticket-types-pass-123";

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let adminId: string;
let opId: string;
let adminCookie = "";
let opCookie = "";

// Same rationale as event-custom-fields-routes.test.ts: the 422/lock-race tests each create their
// own event with a fixed id rather than reusing EVENT_TT/EVENT_TT_OTHER, and delete it at the end
// - include those ids here too so an aborted run doesn't leave orphaned rows breaking the next run.
const EXTRA_FIXTURE_EVENT_IDS = ["evt-ticket-types-limit", "evt-ticket-types-lock-race"];

async function seed(client: PrismaClient) {
  const fixtureEventIds = [EVENT_TT, EVENT_TT_OTHER, ...EXTRA_FIXTURE_EVENT_IDS];
  await client.attendee.deleteMany({ where: { event_id: { in: fixtureEventIds } } });
  await client.ticketType.deleteMany({ where: { event_id: { in: fixtureEventIds } } });
  await client.roleAssignment.deleteMany({ where: { scope_id: { in: [ORG_TT, EVENT_TT, EVENT_TT_OTHER] } } });
  await client.session.deleteMany({ where: { user: { email: { in: [EMAIL_ADMIN, EMAIL_OP] } } } });
  await client.userMfaMethod.deleteMany({ where: { user: { email: EMAIL_ADMIN } } });
  await client.user.deleteMany({ where: { email: { in: [EMAIL_ADMIN, EMAIL_OP] } } });
  await client.event.deleteMany({ where: { id: { in: fixtureEventIds } } });
  await client.organization.deleteMany({ where: { id: ORG_TT } });

  const password_hash = await hashPassword(PASSWORD);
  await client.organization.create({ data: { id: ORG_TT, name: "Ticket Types Org", slug: "ticket-types-org" } });
  await client.event.createMany({
    data: [
      {
        id: EVENT_TT,
        title: "Ticket Types Event",
        slug: "ticket-types-event",
        date: new Date("2026-10-01"),
        organization_id: ORG_TT,
      },
      {
        id: EVENT_TT_OTHER,
        title: "Ticket Types Other Event",
        slug: "ticket-types-other-event",
        date: new Date("2026-10-02"),
        organization_id: ORG_TT,
      },
    ],
  });

  const adminUser = await client.user.create({ data: { email: EMAIL_ADMIN, password_hash } });
  const opUser = await client.user.create({ data: { email: EMAIL_OP, password_hash } });
  adminId = adminUser.id;
  opId = opUser.id;

  await client.roleAssignment.createMany({
    data: [
      { user_id: adminId, role: "admin", scope_type: "organization", scope_id: ORG_TT },
      { user_id: opId, role: "operator", scope_type: "event", scope_id: EVENT_TT },
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
    checkinToken: "ticket-types-checkin-token-32-chr!!",
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

describe("GET /api/admin/events/:eventId/ticket-types", () => {
  it("returns 403 for operator", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_TT}/ticket-types`, {
      headers: { Cookie: opCookie },
    });
    expect(res.status).toBe(403);
  });

  it("returns empty list for a fresh event", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_TT_OTHER}/ticket-types`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items).toEqual([]);
  });

  it("includes a live attendee_count per type", async () => {
    const type = await prisma.ticketType.create({
      data: { event_id: EVENT_TT, key: "counted", label: "Counted", sort_order: 0 },
    });
    await prisma.attendee.createMany({
      data: [
        { event_id: EVENT_TT, email: "count-a@example.com", name: "A", ticket_type: "counted" },
        { event_id: EVENT_TT, email: "count-b@example.com", name: "B", ticket_type: "counted" },
      ],
    });

    const res = await app.request(`/api/admin/events/${EVENT_TT}/ticket-types`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { id: string; attendee_count: number }[] };
    const row = body.items.find((item) => item.id === type.id);
    expect(row?.attendee_count).toBe(2);

    await prisma.attendee.deleteMany({ where: { event_id: EVENT_TT, ticket_type: "counted" } });
    await prisma.ticketType.delete({ where: { id: type.id } });
  });
});

describe("POST /api/admin/events/:eventId/ticket-types", () => {
  it("rejects malformed JSON body", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_TT}/ticket-types`, {
      method: "POST",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: "{not valid json",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid json");
  });

  it("creates a type with a slugified key and default color", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_TT}/ticket-types`, {
      method: "POST",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ label: "Press Pass" }),
    });
    expect(res.status).toBe(201);
    const row = (await res.json()) as { key: string; label: string; color: string; attendee_count: number };
    expect(row.key).toBe("press_pass");
    expect(row.label).toBe("Press Pass");
    expect(row.color).toBe("gray");
    expect(row.attendee_count).toBe(0);

    const log = await prisma.attendeeActionLog.findFirst({
      where: { event_id: EVENT_TT, action_type: "ticket_type_created" },
      orderBy: { created_at: "desc" },
    });
    expect(log?.attendee_id).toBeNull();
    expect(log?.metadata).toEqual({ key: "press_pass" });
  });

  it("creates a type with an explicit color", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_TT}/ticket-types`, {
      method: "POST",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ label: "Speaker", color: "teal" }),
    });
    expect(res.status).toBe(201);
    const row = (await res.json()) as { color: string };
    expect(row.color).toBe("teal");
  });

  it("dedupes the generated key when the label slugifies to an existing one", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_TT}/ticket-types`, {
      method: "POST",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ label: "Press Pass" }),
    });
    expect(res.status).toBe(201);
    const row = (await res.json()) as { key: string };
    expect(row.key).toBe("press_pass_2");
  });

  it("rejects an invalid color", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_TT}/ticket-types`, {
      method: "POST",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ label: "Bad color", color: "chartreuse" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects an empty label", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_TT}/ticket-types`, {
      method: "POST",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ label: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 422 once the per-event type limit is reached", async () => {
    const seedEventId = "evt-ticket-types-limit";
    await prisma.event.create({
      data: {
        id: seedEventId,
        title: "Limit event",
        slug: "ticket-types-limit-event",
        date: new Date("2026-10-05"),
        organization_id: ORG_TT,
      },
    });
    await prisma.ticketType.createMany({
      data: Array.from({ length: 20 }, (_, i) => ({
        event_id: seedEventId,
        key: `type_${i}`,
        label: `Type ${i}`,
        sort_order: i,
      })),
    });

    const res = await app.request(`/api/admin/events/${seedEventId}/ticket-types`, {
      method: "POST",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ label: "One too many" }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; limit: number };
    expect(body.error).toBe("type_limit_reached");
    expect(body.limit).toBe(20);

    await prisma.event.delete({ where: { id: seedEventId } });
  });

  // Genuinely concurrent requests (no mocking) at the cap boundary - mirrors
  // event-custom-fields-routes.test.ts's identical advisory-lock race test.
  it("never exceeds the cap under two genuinely concurrent creates at the boundary (advisory lock)", async () => {
    const seedEventId = "evt-ticket-types-lock-race";
    await prisma.event.create({
      data: {
        id: seedEventId,
        title: "Lock race event",
        slug: "ticket-types-lock-race-event",
        date: new Date("2026-10-06"),
        organization_id: ORG_TT,
      },
    });
    await prisma.ticketType.createMany({
      data: Array.from({ length: 19 }, (_, i) => ({
        event_id: seedEventId,
        key: `lockrace_seed_${i}`,
        label: `Seed ${i}`,
        sort_order: i,
      })),
    });

    const [resA, resB] = await Promise.all([
      app.request(`/api/admin/events/${seedEventId}/ticket-types`, {
        method: "POST",
        headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
        body: JSON.stringify({ label: "Lock race A" }),
      }),
      app.request(`/api/admin/events/${seedEventId}/ticket-types`, {
        method: "POST",
        headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
        body: JSON.stringify({ label: "Lock race B" }),
      }),
    ]);

    const statuses = [resA.status, resB.status].sort((a, b) => a - b);
    expect(statuses).toEqual([201, 422]);

    const finalCount = await prisma.ticketType.count({ where: { event_id: seedEventId } });
    expect(finalCount).toBe(20);

    await prisma.event.delete({ where: { id: seedEventId } });
  });

  it("returns 403 for cross-event admin scope", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_TT_OTHER}/ticket-types`, {
      method: "POST",
      headers: { Cookie: opCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ label: "X" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/admin/events/:eventId/ticket-types/:typeId", () => {
  it("rejects malformed JSON body", async () => {
    const created = await prisma.ticketType.create({
      data: { event_id: EVENT_TT, key: "bad_json_patch", label: "Bad json patch", sort_order: 90 },
    });
    const res = await app.request(`/api/admin/events/${EVENT_TT}/ticket-types/${created.id}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: "{not valid json",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid json");
  });

  it("updates label and color - key is immutable", async () => {
    const created = await prisma.ticketType.create({
      data: { event_id: EVENT_TT, key: "staff", label: "Staff", sort_order: 91 },
    });

    const res = await app.request(`/api/admin/events/${EVENT_TT}/ticket-types/${created.id}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ label: "Crew", color: "blue" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { key: string; label: string; color: string };
    expect(body.key).toBe("staff");
    expect(body.label).toBe("Crew");
    expect(body.color).toBe("blue");

    const log = await prisma.attendeeActionLog.findFirst({
      where: { event_id: EVENT_TT, action_type: "ticket_type_updated" },
      orderBy: { created_at: "desc" },
    });
    expect(log?.metadata).toEqual({ key: "staff" });
  });

  it("rejects key in the PATCH body (unknown key, strict schema)", async () => {
    const created = await prisma.ticketType.create({
      data: { event_id: EVENT_TT, key: "immutable_check", label: "Immutable check", sort_order: 92 },
    });
    const res = await app.request(`/api/admin/events/${EVENT_TT}/ticket-types/${created.id}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ key: "renamed" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 403 for a type belonging to a different event", async () => {
    const created = await prisma.ticketType.create({
      data: { event_id: EVENT_TT_OTHER, key: "other_type", label: "Other", sort_order: 0 },
    });
    const res = await app.request(`/api/admin/events/${EVENT_TT}/ticket-types/${created.id}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ label: "Hijacked" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/admin/events/:eventId/ticket-types/:typeId", () => {
  it("deletes an unreferenced type", async () => {
    const created = await prisma.ticketType.create({
      data: { event_id: EVENT_TT, key: "to_delete", label: "To delete", sort_order: 93 },
    });
    const res = await app.request(`/api/admin/events/${EVENT_TT}/ticket-types/${created.id}`, {
      method: "DELETE",
      headers: { Cookie: adminCookie, ...sameOrigin },
    });
    expect(res.status).toBe(200);
    const deleted = await prisma.ticketType.findUnique({ where: { id: created.id } });
    expect(deleted).toBeNull();
  });

  it("returns 409 type_in_use while an attendee still has this type", async () => {
    const created = await prisma.ticketType.create({
      data: { event_id: EVENT_TT, key: "in_use_type", label: "In use", sort_order: 94 },
    });
    const attendee = await prisma.attendee.create({
      data: { event_id: EVENT_TT, email: "in-use@example.com", name: "In Use", ticket_type: "in_use_type" },
    });

    const res = await app.request(`/api/admin/events/${EVENT_TT}/ticket-types/${created.id}`, {
      method: "DELETE",
      headers: { Cookie: adminCookie, ...sameOrigin },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("type_in_use");

    const stillThere = await prisma.ticketType.findUnique({ where: { id: created.id } });
    expect(stillThere).not.toBeNull();

    // Once no attendee has this type, deletion proceeds.
    await prisma.attendee.update({ where: { id: attendee.id }, data: { ticket_type: null } });
    const retryRes = await app.request(`/api/admin/events/${EVENT_TT}/ticket-types/${created.id}`, {
      method: "DELETE",
      headers: { Cookie: adminCookie, ...sameOrigin },
    });
    expect(retryRes.status).toBe(200);

    await prisma.attendee.delete({ where: { id: attendee.id } });
  });

  it("returns 403 for a type belonging to a different event", async () => {
    const created = await prisma.ticketType.create({
      data: { event_id: EVENT_TT_OTHER, key: "cross_event_delete", label: "Cross event", sort_order: 1 },
    });
    const res = await app.request(`/api/admin/events/${EVENT_TT}/ticket-types/${created.id}`, {
      method: "DELETE",
      headers: { Cookie: adminCookie, ...sameOrigin },
    });
    expect(res.status).toBe(403);
  });
});
