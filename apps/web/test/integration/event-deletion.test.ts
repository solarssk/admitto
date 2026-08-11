import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { createSession, hashPassword, SESSION_STAGE } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";
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
  superCookie = `admitto_session=${superSession.rawToken}`;
  adminCookie = `admitto_session=${adminSession.rawToken}`;
});

beforeEach(() => {
  resetSystemLogBufferForTest();
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

async function createEventTemplateRequest(eventId: string) {
  return app.request(`/api/admin/events/${eventId}/templates`, {
    method: "POST",
    headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "Concurrent reminder",
      template_format: "mjml",
    }),
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

  it("returns 409 when archived but has a custom ticket type", async () => {
    const eventId = await createEvent({ archived: true });
    await prisma.ticketType.create({
      data: { event_id: eventId, key: "vip", label: "VIP", color: "purple" },
    });

    const res = await deleteEventRequest(eventId, superCookie);
    expect(res.status).toBe(409);

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    expect(event).not.toBeNull();
  });

  it("allows delete when the only ticket type is the auto-seeded standard one", async () => {
    const eventId = await createEvent({ archived: true });
    await prisma.ticketType.create({
      data: { event_id: eventId, key: "standard", label: "Standard", color: "gray" },
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

  it("allows delete when the only event-scoped mail template is the saved ticket override", async () => {
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
    expect(res.status).toBe(200);

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    expect(event).toBeNull();

    const template = await prisma.mailTemplate.findFirst({
      where: { scope_type: "event", scope_id: eventId },
    });
    expect(template).toBeNull();
  });

  it("serializes template creation with deletion so no orphaned MailTemplate can remain", async () => {
    const eventId = await createEvent({ archived: true });
    // Both requests take the same advisory lock inside their mutations. The order is intentionally
    // unspecified: creation first makes deletion see real content, while deletion first makes the
    // creation re-check find no event. Either outcome is safe; an event that was deleted can never
    // retain a polymorphic MailTemplate row with no foreign key to remove it.
    const [createResponse, deleteResponse] = await Promise.all([
      createEventTemplateRequest(eventId),
      deleteEventRequest(eventId, superCookie),
    ]);
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    const templates = await prisma.mailTemplate.findMany({
      where: { scope_type: "event", scope_id: eventId },
    });

    if (event === null) {
      expect(deleteResponse.status).toBe(200);
      // The access check runs before the locked re-check, so a request that reached the route
      // after deletion can be rejected as either no-longer-in-scope (403) or not found (404).
      expect([403, 404]).toContain(createResponse.status);
      expect(templates).toEqual([]);
    } else {
      expect(deleteResponse.status).toBe(409);
      expect(createResponse.status).toBe(201);
      expect(templates).toHaveLength(1);
    }
  });

  it("returns 404 without creating a template when deletion wins after access validation", async () => {
    const eventId = await createEvent({ archived: false });
    // The initial access check completed. Permanent deletion then lands while the request waits
    // for its transaction, so the locked re-check must turn the stale create into a 404.
    const transaction = vi.spyOn(prisma, "$transaction").mockImplementation(
      (async (callback: unknown) => {
        await prisma.event.delete({ where: { id: eventId } });
        return (callback as (tx: PrismaClient) => Promise<unknown>)(prisma);
      }) as never,
    );

    try {
      const res = await createEventTemplateRequest(eventId);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
      expect(
        await prisma.mailTemplate.count({ where: { scope_type: "event", scope_id: eventId } }),
      ).toBe(0);
    } finally {
      transaction.mockRestore();
    }
  });

  it("returns 409 when archived but has an additional event-scoped mail template", async () => {
    const eventId = await createEvent({ archived: true });
    await prisma.mailTemplate.create({
      data: {
        scope_type: "event",
        scope_id: eventId,
        name: "reminder",
        label: "Reminder",
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

  it("allows delete when the only leftover is an event-scoped action log entry with no attendee", async () => {
    const eventId = await createEvent({ archived: true });
    await prisma.attendeeActionLog.create({
      data: { event_id: eventId, attendee_id: null, action_type: "reports_exported" },
    });

    const res = await deleteEventRequest(eventId, superCookie);
    expect(res.status).toBe(200);

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    expect(event).toBeNull();
  });

  it("allows delete when the only leftover is a named image asset row", async () => {
    const eventId = await createEvent({ archived: true });
    await prisma.eventImageAsset.create({
      data: {
        event_id: eventId,
        token: "hero",
        filename: "hero.png",
        url: `/uploads/default/event/${eventId}/hero.png`,
        size_bytes: 128,
        mime_type: "image/png",
      },
    });

    const res = await deleteEventRequest(eventId, superCookie);
    expect(res.status).toBe(200);

    expect(await prisma.event.findUnique({ where: { id: eventId } })).toBeNull();
    expect(await prisma.eventImageAsset.count({ where: { event_id: eventId } })).toBe(0);
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

    const logs = querySystemLogs({ source: "admin" });
    expect(
      logs.some((entry) => entry.message === "event_deleted" && entry.fields?.eventId === eventId),
    ).toBe(true);
  });
});
