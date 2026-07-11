import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createSession, hashPassword, SESSION_STAGE } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { createApp } from "../../src/app.js";
import { createRateLimitStore } from "../../src/rate-limit/index.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };

const ORG_DEL = "org-event-deletion";
const EMAIL_SUPER = "event-deletion-super@example.com";
const EMAIL_ADMIN = "event-deletion-admin@example.com";
const PASSWORD = "event-deletion-pass-123";

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let superId: string;
let adminId: string;
let superCookie = "";
let adminCookie = "";
let eventSeq = 0;

/** Create a fresh event scoped to ORG_DEL, with a unique id/slug per call. */
async function createEvent(overrides: {
  archived?: boolean;
  pinnedNote?: string | null;
}): Promise<string> {
  eventSeq += 1;
  const id = `evt-event-deletion-${eventSeq}`;
  await prisma.event.create({
    data: {
      id,
      title: `Deletion Test Event ${eventSeq}`,
      slug: `event-deletion-${eventSeq}`,
      date: new Date("2026-10-01T12:00:00.000Z"),
      organization_id: ORG_DEL,
      archived_at: overrides.archived ? new Date() : null,
      pinned_note: overrides.pinnedNote ?? null,
    },
  });
  return id;
}

async function seed(client: PrismaClient) {
  await client.adminAuditLog.deleteMany({ where: { organization_id: ORG_DEL } });
  await client.roleAssignment.deleteMany({ where: { scope_id: ORG_DEL } });
  await client.session.deleteMany({
    where: { user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN] } } },
  });
  await client.userMfaMethod.deleteMany({
    where: { user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN] } } },
  });
  await client.user.deleteMany({ where: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN] } } });
  // Attendee/MailTemplate rows block Event deletion (Restrict, not Cascade) — clean up any
  // leftovers from "has activity" test events (which intentionally never get deleted via the
  // API, since the guard blocks them) before removing the events themselves.
  await client.attendee.deleteMany({ where: { event: { organization_id: ORG_DEL } } });
  await client.mailTemplate.deleteMany({
    where: { scope_type: "event", scope_id: { startsWith: "evt-event-deletion-" } },
  });
  await client.event.deleteMany({ where: { organization_id: ORG_DEL } });
  await client.organization.deleteMany({ where: { id: ORG_DEL } });

  const password_hash = await hashPassword(PASSWORD);
  await client.organization.create({ data: { id: ORG_DEL, name: "Deletion Org", slug: "event-deletion-org" } });

  const superUser = await client.user.create({ data: { email: EMAIL_SUPER, password_hash } });
  const adminUser = await client.user.create({ data: { email: EMAIL_ADMIN, password_hash } });
  superId = superUser.id;
  adminId = adminUser.id;

  await client.roleAssignment.createMany({
    data: [
      { user_id: superId, role: "superadmin", scope_type: "instance", scope_id: null },
      { user_id: adminId, role: "admin", scope_type: "organization", scope_id: ORG_DEL },
    ],
  });

  for (const userId of [superId, adminId]) {
    await client.userMfaMethod.create({
      data: {
        user_id: userId,
        type: "totp",
        secret_enc: encryptTotpSecret(generateTotpSecret()),
        confirmed_at: new Date(),
      },
    });
  }
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
  superCookie = `admitto_session=${superSession.rawToken}`;
  adminCookie = `admitto_session=${adminSession.rawToken}`;
});

afterEach(async () => {
  await prisma.adminAuditLog.deleteMany({ where: { organization_id: ORG_DEL } });
});

afterAll(async () => {
  await prisma?.$disconnect();
});

async function deleteEventRequest(eventId: string, cookie: string, headers: Record<string, string> = sameOrigin) {
  return app.request(`/api/admin/events/${eventId}`, {
    method: "DELETE",
    headers: { Cookie: cookie, ...headers },
  });
}

describe("DELETE /api/admin/events/:eventId", () => {
  it("returns 401 without auth", async () => {
    const eventId = await createEvent({ archived: true });
    const res = await app.request(`/api/admin/events/${eventId}`, {
      method: "DELETE",
      headers: sameOrigin,
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 for org admin (superadmin only)", async () => {
    const eventId = await createEvent({ archived: true });
    const res = await deleteEventRequest(eventId, adminCookie);
    expect(res.status).toBe(403);

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    expect(event).not.toBeNull();
  });

  it("rejects missing CSRF origin", async () => {
    const eventId = await createEvent({ archived: true });
    const res = await app.request(`/api/admin/events/${eventId}`, {
      method: "DELETE",
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(403);
  });

  it("returns 404 for non-existent event", async () => {
    const res = await deleteEventRequest("evt-event-deletion-missing", superCookie);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });

  it("permanently deletes a truly-empty ACTIVE event (archiving is not required)", async () => {
    const eventId = await createEvent({ archived: false });
    const res = await deleteEventRequest(eventId, superCookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    expect(event).toBeNull();
  });

  it("returns 409 when active (not archived) but has an attendee", async () => {
    const eventId = await createEvent({ archived: false });
    await prisma.attendee.create({
      data: { event_id: eventId, email: "guest-active@example.com", name: "Guest" },
    });

    const res = await deleteEventRequest(eventId, superCookie);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("event_not_deletable");

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    expect(event).not.toBeNull();
  });

  it("returns 409 when archived but has an attendee", async () => {
    const eventId = await createEvent({ archived: true });
    await prisma.attendee.create({
      data: { event_id: eventId, email: "guest@example.com", name: "Guest" },
    });

    const res = await deleteEventRequest(eventId, superCookie);
    expect(res.status).toBe(409);

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    expect(event).not.toBeNull();
  });

  it("returns 409 when archived but has a non-badge event item", async () => {
    const eventId = await createEvent({ archived: true });
    await prisma.eventItem.create({
      data: { event_id: eventId, key: "giftbag", label: "Gift bag", enabled: true },
    });

    const res = await deleteEventRequest(eventId, superCookie);
    expect(res.status).toBe(409);

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    expect(event).not.toBeNull();
  });

  it("allows delete when the only event item is the structural badge", async () => {
    const eventId = await createEvent({ archived: true });
    await prisma.eventItem.create({
      data: { event_id: eventId, key: "badge", label: "Badge", enabled: true },
    });

    const res = await deleteEventRequest(eventId, superCookie);
    expect(res.status).toBe(200);

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    expect(event).toBeNull();
  });

  it("returns 409 when archived but has an event contact", async () => {
    const eventId = await createEvent({ archived: true });
    await prisma.eventContact.create({ data: { event_id: eventId, name: "Jane Doe" } });

    const res = await deleteEventRequest(eventId, superCookie);
    expect(res.status).toBe(409);

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    expect(event).not.toBeNull();
  });

  it("returns 409 when archived but has an event resource", async () => {
    const eventId = await createEvent({ archived: true });
    await prisma.eventResource.create({
      data: { event_id: eventId, title: "Floor plan", url: "https://example.com/plan.pdf" },
    });

    const res = await deleteEventRequest(eventId, superCookie);
    expect(res.status).toBe(409);

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    expect(event).not.toBeNull();
  });

  it("returns 409 when archived but has a pinned note", async () => {
    const eventId = await createEvent({ archived: true, pinnedNote: "Remember the fire exits" });

    const res = await deleteEventRequest(eventId, superCookie);
    expect(res.status).toBe(409);

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    expect(event).not.toBeNull();
  });

  it("returns 409 when archived but has an event-scoped mail template", async () => {
    const eventId = await createEvent({ archived: true });
    await prisma.mailTemplate.create({
      data: {
        scope_type: "event",
        scope_id: eventId,
        name: "ticket",
        label: "Ticket email",
        subject_template: "Subject",
        body_template: "Body",
        template_format: "html",
        compiled_html_template: "<p>Body</p>",
      },
    });

    const res = await deleteEventRequest(eventId, superCookie);
    expect(res.status).toBe(409);

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    expect(event).not.toBeNull();
  });

  it("returns 409 when archived but has an event-scoped action log entry with no attendee", async () => {
    const eventId = await createEvent({ archived: true });
    await prisma.attendeeActionLog.create({
      data: { event_id: eventId, attendee_id: null, action_type: "reports_exported" },
    });

    const res = await deleteEventRequest(eventId, superCookie);
    expect(res.status).toBe(409);

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    expect(event).not.toBeNull();
  });

  it("permanently deletes a truly-empty archived event and writes AdminAuditLog", async () => {
    const eventId = await createEvent({ archived: true });

    const res = await deleteEventRequest(eventId, superCookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    expect(event).toBeNull();

    const audit = await prisma.adminAuditLog.findFirst({
      where: { organization_id: ORG_DEL, action_type: "event_deleted" },
    });
    expect(audit).not.toBeNull();
    expect(audit!.actor_user_id).toBe(superId);
    const meta = audit!.metadata as { eventId?: string };
    expect(meta.eventId).toBe(eventId);
  });
});
