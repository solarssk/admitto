import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, PrismaClient, type RegistrationStatus } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { acquireEventCapacityLock, lockRegistrationQueue, MAX_REGISTRATION_BULK_IDS } from "@admitto/tickets";
import { subscribe } from "../../src/admin/sse-channel.js";
import type {
  AcceptRegistrationsDto,
  RejectRegistrationsDto,
  RetryRegistrationMailsDto,
} from "../../src/admin/registration-decisions-routes.js";
import type { RegistrationDetailDto, RegistrationListDto } from "../../src/admin/registrations-api-routes.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { enrollConfirmedTotp } from "../helpers/enroll-confirmed-totp.js";
import { sessionCookieFor } from "../helpers/session-cookie.js";

/**
 * The staff routes that decide on guest registrations (accept, reject, send a failed mail again), against a real
 * database through the real app: who may call them, what a request must look like, what an answer says, that an
 * archived event refuses, and that decisions made at the same time (two clicks, two organisers, an import, an
 * archive) leave the seats, the states and the mail queue consistent (family C of the plan).
 */
const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };

const ORG_A = "org-decisions-a";
const ORG_B = "org-decisions-b";
const EVENT_A = "evt-decisions-a";
const EVENT_B = "evt-decisions-b";
const EVENT_ARCHIVED = "evt-decisions-archived";
const EVENT_IDS = [EVENT_A, EVENT_B, EVENT_ARCHIVED];

const EMAILS = {
  adminA: "decisions-admin-a@example.com",
  adminB: "decisions-admin-b@example.com",
  operator: "decisions-operator@example.com",
  superadmin: "decisions-super@example.com",
};

let prisma: PrismaClient;
let other: PrismaClient;
let app: ReturnType<typeof buildTestApp>;
const cookies = { adminA: "", adminB: "", operator: "", superadmin: "" };
const users = { adminA: "", superadmin: "" };
let sequence = 0;

/** A fresh app has a fresh rate limit store, so a test never spends the budget of another. */
function freshApp(): ReturnType<typeof buildTestApp> {
  return buildTestApp({ prisma, checkinToken: "decisions-checkin-token-32-chars!", adminDistRoot });
}

async function wipeEvents(client: PrismaClient): Promise<void> {
  await client.registration.deleteMany({ where: { event_id: { in: EVENT_IDS } } });
  await client.emailDelivery.deleteMany({ where: { event_id: { in: EVENT_IDS } } });
  await client.attendee.deleteMany({ where: { event_id: { in: EVENT_IDS } } });
  await client.attendeeActionLog.deleteMany({ where: { event_id: { in: EVENT_IDS } } });
}

async function wipeAll(client: PrismaClient): Promise<void> {
  await wipeEvents(client);
  await client.eventRegistrationSettings.deleteMany({ where: { event_id: { in: EVENT_IDS } } });
  await client.adminAuditLog.deleteMany({ where: { organization_id: { in: [ORG_A, ORG_B] } } });
  await client.roleAssignment.deleteMany({ where: { scope_id: { in: [ORG_A, ORG_B, ...EVENT_IDS] } } });
  await client.session.deleteMany({ where: { user: { email: { in: Object.values(EMAILS) } } } });
  await client.userMfaMethod.deleteMany({ where: { user: { email: { in: Object.values(EMAILS) } } } });
  await client.user.deleteMany({ where: { email: { in: Object.values(EMAILS) } } });
  await client.event.deleteMany({ where: { id: { in: EVENT_IDS } } });
  await client.organization.deleteMany({ where: { id: { in: [ORG_A, ORG_B] } } });
}

async function seed(client: PrismaClient): Promise<void> {
  await wipeAll(client);
  await client.organization.createMany({
    data: [
      { id: ORG_A, name: "Decisions Org A", slug: "decisions-org-a" },
      { id: ORG_B, name: "Decisions Org B", slug: "decisions-org-b" },
    ],
  });
  await client.event.createMany({
    data: [
      { id: EVENT_A, title: "Decisions A", slug: "decisions-a", date: new Date("2026-10-01"), organization_id: ORG_A, capacity: 10 },
      { id: EVENT_B, title: "Decisions B", slug: "decisions-b", date: new Date("2026-10-03"), organization_id: ORG_B, capacity: 10 },
      {
        id: EVENT_ARCHIVED,
        title: "Decisions Archived",
        slug: "decisions-archived",
        date: new Date("2026-09-01"),
        organization_id: ORG_A,
        capacity: 10,
        archived_at: new Date(),
      },
    ],
  });
  const [adminA, adminB, operator, superadmin] = await Promise.all(
    Object.values(EMAILS).map((email) => client.user.create({ data: { email } })),
  );
  await client.roleAssignment.createMany({
    data: [
      { user_id: adminA!.id, role: "admin", scope_type: "organization", scope_id: ORG_A },
      { user_id: adminB!.id, role: "admin", scope_type: "organization", scope_id: ORG_B },
      { user_id: operator!.id, role: "operator", scope_type: "event", scope_id: EVENT_A },
      { user_id: superadmin!.id, role: "superadmin", scope_type: "instance", scope_id: null },
    ],
  });
  for (const user of [adminA!, adminB!, superadmin!]) await enrollConfirmedTotp(client, user.id);
  users.adminA = adminA!.id;
  users.superadmin = superadmin!.id;
  cookies.adminA = await sessionCookieFor(client, adminA!.id);
  cookies.adminB = await sessionCookieFor(client, adminB!.id);
  cookies.operator = await sessionCookieFor(client, operator!.id);
  cookies.superadmin = await sessionCookieFor(client, superadmin!.id);
}

beforeAll(async () => {
  prisma = createTestPrismaClient();
  other = createTestPrismaClient();
  await seed(prisma);
});

beforeEach(async () => {
  await wipeEvents(prisma);
  await prisma.event.updateMany({ where: { id: { in: [EVENT_A, EVENT_B] } }, data: { capacity: 10, archived_at: null } });
  app = freshApp();
});

afterAll(async () => {
  if (prisma) await wipeAll(prisma);
  await Promise.all([prisma?.$disconnect(), other?.$disconnect()]);
});

type SeedRegistration = {
  eventId?: string;
  status?: RegistrationStatus;
  companions?: Prisma.InputJsonValue;
  email?: string;
};

/** A registration with what the table's constraints ask: one that waits for its address gets its expiry, an accepted one its attendee. */
async function addRegistration(seedRow: SeedRegistration = {}): Promise<{ id: string; email: string }> {
  const eventId = seedRow.eventId ?? EVENT_A;
  const status = seedRow.status ?? "pending";
  const email = seedRow.email ?? `decisions-guest-${++sequence}@example.com`;
  const attendee =
    status === "accepted"
      ? await prisma.attendee.create({ data: { event_id: eventId, email, name: "Guest Accepted" }, select: { id: true } })
      : null;
  const row = await prisma.registration.create({
    data: {
      event_id: eventId,
      email,
      first_name: "Guest",
      last_name: `Number${sequence}`,
      name: `Guest Number${sequence}`,
      status,
      confirm_expires_at: status === "awaiting_email" ? new Date(Date.now() + 86_400_000) : null,
      attendee_id: attendee?.id ?? null,
      companions: seedRow.companions ?? [],
    },
    select: { id: true },
  });
  return { id: row.id, email };
}

async function addRegistrations(count: number, seedRow: SeedRegistration = {}): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) ids.push((await addRegistration(seedRow)).id);
  return ids;
}

/** A mail that failed for good, unless the test says otherwise. */
async function addFailedMail(
  registrationId: string,
  extra: Partial<Prisma.RegistrationMailUncheckedCreateInput> = {},
  eventId = EVENT_A,
): Promise<string> {
  const mail = await prisma.registrationMail.create({
    data: {
      registration_id: registrationId,
      event_id: eventId,
      template_name: "registration-received",
      status: "failed",
      attempts: 8,
      retryable: false,
      queued_at: new Date("2026-01-01T10:00:00Z"),
      attempted_at: new Date("2026-01-01T10:05:00Z"),
      error_code: "send_rejected",
      error: "The mail provider refused the message.",
      ...extra,
    },
    select: { id: true },
  });
  return mail.id;
}

const url = (eventId: string, action: string) => `/api/admin/events/${eventId}/registrations/${action}`;
const ACTIONS = ["accept", "reject", "retry-mail"] as const;

async function post(
  action: string,
  body: unknown,
  init: { eventId?: string; cookie?: string; headers?: Record<string, string>; application?: ReturnType<typeof buildTestApp> } = {},
): Promise<Response> {
  const { eventId = EVENT_A, cookie = cookies.adminA, headers = sameOrigin, application = app } = init;
  return await application.request(url(eventId, action), {
    method: "POST",
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers, "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const accept = async (ids: string[], init: Parameters<typeof post>[2] = {}) => await post("accept", { ids }, init);
const reject = async (ids: string[], notify?: boolean, init: Parameters<typeof post>[2] = {}) =>
  await post("reject", notify === undefined ? { ids } : { ids, notify }, init);
const retryMail = async (ids: string[], init: Parameters<typeof post>[2] = {}) => await post("retry-mail", { ids }, init);

async function acceptOk(ids: string[], init: Parameters<typeof post>[2] = {}): Promise<AcceptRegistrationsDto> {
  const res = await accept(ids, init);
  expect(res.status).toBe(200);
  return (await res.json()) as AcceptRegistrationsDto;
}

const outcomes = (body: { results: { outcome: string }[] }) => body.results.map((entry) => entry.outcome);
const statusOf = async (id: string) => (await prisma.registration.findUnique({ where: { id } }))?.status;
const attendeeCount = (eventId = EVENT_A) => prisma.attendee.count({ where: { event_id: eventId } });
const mailTemplates = async (registrationId: string) =>
  (await prisma.registrationMail.findMany({ where: { registration_id: registrationId }, orderBy: { template_name: "asc" } })).map(
    (mail) => mail.template_name,
  );
const logCount = (actionType: string, eventId = EVENT_A) =>
  prisma.attendeeActionLog.count({ where: { event_id: eventId, action_type: actionType } });

/** Everything a decision can change in an event, to show that a refused one changed none of it. */
async function snapshot(eventId = EVENT_A) {
  return {
    registrations: await prisma.registration.findMany({ where: { event_id: eventId }, orderBy: { id: "asc" } }),
    mails: await prisma.registrationMail.findMany({ where: { event_id: eventId }, orderBy: { id: "asc" } }),
    attendees: await prisma.attendee.count({ where: { event_id: eventId } }),
    logs: await prisma.attendeeActionLog.count({ where: { event_id: eventId } }),
  };
}

describe("who may decide", () => {
  it.each(ACTIONS)("%s: an unauthenticated caller gets 401", async (action) => {
    const id = (await addRegistration()).id;
    expect((await post(action, { ids: [id] }, { cookie: "" })).status).toBe(401);
    expect(await statusOf(id)).toBe("pending");
  });

  it.each(ACTIONS)("%s: an operator of the event, and an admin of another organisation, get 403 and change nothing", async (action) => {
    const id = (await addRegistration()).id;
    await addFailedMail(id);
    const before = await snapshot();

    for (const cookie of [cookies.operator, cookies.adminB]) {
      const res = await post(action, { ids: [id] }, { cookie });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "forbidden" });
    }

    expect(await snapshot()).toEqual(before);
  });

  it.each(ACTIONS)("%s: an admin of the organisation and a superadmin may", async (action) => {
    for (const cookie of [cookies.adminA, cookies.superadmin]) {
      const id = (await addRegistration()).id;
      await addFailedMail(id);
      expect((await post(action, { ids: [id] }, { cookie, application: freshApp() })).status).toBe(200);
    }
  });

  it.each(ACTIONS)("%s: answers 404 for an event that does not exist to a superadmin, and 403 to anyone else", async (action) => {
    const body = { ids: ["some-id"] };
    const asSuperadmin = await post(action, body, { eventId: "no-such-event", cookie: cookies.superadmin });
    expect(asSuperadmin.status).toBe(404);
    expect(await asSuperadmin.json()).toEqual({ error: "not_found" });
    expect((await post(action, body, { eventId: "no-such-event", cookie: cookies.adminA })).status).toBe(403);
  });

  it.each(ACTIONS)("%s: refuses a cross-site request before it reads anything", async (action) => {
    const id = (await addRegistration()).id;
    const res = await post(action, { ids: [id] }, { headers: { Origin: "https://evil.example" } });
    expect(res.status).toBe(403);
    expect(await statusOf(id)).toBe("pending");
  });

  it.each(ACTIONS)("%s: spends the bulk-mutation budget of the user and the event (20 a minute)", async (action) => {
    for (let i = 0; i < 20; i += 1) expect((await post(action, { ids: ["no-such-registration"] })).status).toBe(200); // NOSONAR - counts requests in order
    const res = await post(action, { ids: ["no-such-registration"] });
    expect(res.status).toBe(429);
    // Another user, and another event of the same user, have budgets of their own.
    expect((await post(action, { ids: ["no-such-registration"] }, { cookie: cookies.superadmin })).status).toBe(200);
    expect((await post(action, { ids: ["no-such-registration"] }, { eventId: EVENT_B, cookie: cookies.superadmin })).status).toBe(200);
  });
});

describe("what a request must look like", () => {
  it.each(ACTIONS)("%s: answers 400 for a body that is not JSON", async (action) => {
    const res = await post(action, "{ not json");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid json" });
  });

  it.each(ACTIONS)("%s: refuses a body that is not exactly a non-empty list of up to 500 short ids", async (action) => {
    const bad: unknown[] = [
      {},
      { ids: [] },
      { ids: "one-id" },
      { ids: [1, 2] },
      { ids: [null] },
      { ids: ["x".repeat(129)] },
      { ids: Array.from({ length: MAX_REGISTRATION_BULK_IDS + 1 }, (_, i) => `id-${i}`) },
      { ids: ["a"], unknown_key: true },
      [],
      '"text"',
      null,
    ];
    for (const body of bad) {
      const res = await post(action, body, { application: freshApp() });
      expect(res.status, JSON.stringify(body).slice(0, 80)).toBe(400);
      expect(await res.json()).toEqual({ error: "validation_failed" });
    }
  });

  it.each(ACTIONS)("%s: takes exactly 500 ids, and an id of 128 characters", async (action) => {
    const ids = Array.from({ length: MAX_REGISTRATION_BULK_IDS }, (_, i) => `no-such-${i}`);
    ids[0] = "y".repeat(128);
    const res = await post(action, { ids });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: { id: string; outcome: string }[] };
    expect(body.results).toHaveLength(MAX_REGISTRATION_BULK_IDS);
    expect(new Set(outcomes(body))).toEqual(new Set(["gone"]));
  });

  it.each(ACTIONS)("%s: refuses a body over the cap before it is parsed", async (action) => {
    const res = await post(action, { ids: ["x"], padding: "p".repeat(600 * 1024) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "request too large" });
  });

  it.each(ACTIONS)("%s: answers 400 for an id with U+0000, which the database cannot store, and changes nothing", async (action) => {
    const id = (await addRegistration()).id;
    const before = await snapshot();

    const res = await post(action, { ids: [id, "a\u0000b"] });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request" });
    expect(await snapshot()).toEqual(before);
  });

  it("accepts `notify` for a rejection only, and only as a boolean", async () => {
    const id = (await addRegistration()).id;
    expect((await post("reject", { ids: [id], notify: "yes" })).status).toBe(400);
    expect((await post("reject", { ids: [id], notify: 1 })).status).toBe(400);
    expect((await post("accept", { ids: [id], notify: true })).status).toBe(400);
    expect((await post("retry-mail", { ids: [id], notify: true })).status).toBe(400);
    expect(await statusOf(id)).toBe("pending");
  });
});

describe("accept", () => {
  it("decides while registration is switched off for the event: closing the form takes no decision from the organiser", async () => {
    await prisma.eventRegistrationSettings.create({ data: { event_id: EVENT_A, mode: null } });
    const [toAccept, toReject] = await addRegistrations(2);

    expect(outcomes(await acceptOk([toAccept!]))).toEqual(["accepted"]);
    const rejected = await reject([toReject!]);

    expect(rejected.status).toBe(200);
    expect(outcomes((await rejected.json()) as RejectRegistrationsDto)).toEqual(["rejected"]);
    expect(await statusOf(toAccept!)).toBe("accepted");
    expect(await statusOf(toReject!)).toBe("rejected");
  });

  it("makes the attendee, decides the registration for the staff member, queues the ticket mail and logs it", async () => {
    const guest = await addRegistration();
    const heard: unknown[] = [];
    const unsubscribe = subscribe(EVENT_A, (event) => heard.push(event));

    const body = await acceptOk([guest.id]);
    unsubscribe();

    const attendee = await prisma.attendee.findFirstOrThrow({ where: { event_id: EVENT_A, email: guest.email } });
    expect(body).toEqual({ results: [{ id: guest.id, outcome: "accepted", attendee_id: attendee.id }] });
    expect(attendee).toMatchObject({ status: "registered", name: expect.stringContaining("Guest") });
    expect(await prisma.registration.findUniqueOrThrow({ where: { id: guest.id } })).toMatchObject({
      status: "accepted",
      attendee_id: attendee.id,
      decided_by: users.adminA,
      decided_at: expect.any(Date),
    });
    expect(await mailTemplates(guest.id)).toEqual(["ticket"]);
    const log = await prisma.attendeeActionLog.findFirstOrThrow({ where: { event_id: EVENT_A, action_type: "registration_accepted" } });
    expect(log).toMatchObject({ actor_user_id: users.adminA, attendee_id: null });
    expect(log.metadata).toEqual({ count: 1, registration_ids: [guest.id], attendee_ids: [attendee.id] });
    expect(JSON.stringify(log)).not.toContain(guest.email);
    // The central audit log has the decision too, for the staff member, with ids and counts only.
    const central = await prisma.adminAuditLog.findMany({
      where: { organization_id: ORG_A, action_type: "registration_accepted", metadata: { path: ["registration_ids"], array_contains: [guest.id] } },
    });
    expect(central).toHaveLength(1);
    expect(central[0]).toMatchObject({ actor_user_id: users.adminA });
    expect(central[0]?.metadata).toMatchObject({ event_id: EVENT_A, count: 1, registration_ids: [guest.id], attendee_ids: [attendee.id] });
    expect(JSON.stringify(central[0])).not.toContain(guest.email);
    // The attendees list and the Overview of the event are told that people were added.
    expect(heard).toEqual([{ type: "activity_changed" }]);

    // The detail of the registration says the same to the staff member who opens it.
    const detailRes = await app.request(`/api/admin/events/${EVENT_A}/registrations/${guest.id}`, { headers: { Cookie: cookies.adminA } });
    const detail = (await detailRes.json()) as RegistrationDetailDto;
    expect(detail).toMatchObject({ status: "accepted", attendee_id: attendee.id, decided_by: { id: users.adminA } });
    expect(detail.mails.map((mail) => mail.template_name)).toEqual(["ticket"]);
  });

  it("admits from the waiting list and from rejected (D-B8), and treats a repeated id once", async () => {
    const pending = (await addRegistration()).id;
    const waiting = (await addRegistration({ status: "waitlist" })).id;
    const rejected = (await addRegistration({ status: "rejected" })).id;

    const body = await acceptOk([pending, waiting, rejected, pending]);

    expect(body.results.map((entry) => entry.id)).toEqual([pending, waiting, rejected]);
    expect(outcomes(body)).toEqual(["accepted", "accepted", "accepted"]);
    expect(await attendeeCount()).toBe(3);
  });

  it("answers for each id in the order asked, and says why nothing happened for the others", async () => {
    const [pending] = await addRegistrations(1);
    const [done] = await addRegistrations(1, { status: "accepted" });
    const [unconfirmed] = await addRegistrations(1, { status: "awaiting_email" });
    const [foreign] = await addRegistrations(1, { eventId: EVENT_B });
    const taken = await addRegistration();
    await prisma.attendee.create({ data: { event_id: EVENT_A, email: taken.email, name: "Imported Earlier" } });
    const beforeForeign = await snapshot(EVENT_B);

    const body = await acceptOk([unconfirmed!, pending!, "no-such-registration", done!, foreign!, taken.id]);

    expect(body.results).toEqual([
      { id: unconfirmed, outcome: "awaiting_email" },
      { id: pending, outcome: "accepted", attendee_id: expect.any(String) },
      { id: "no-such-registration", outcome: "gone" },
      { id: done, outcome: "already_decided" },
      { id: foreign, outcome: "gone" },
      { id: taken.id, outcome: "already_attendee" },
    ]);
    expect(await snapshot(EVENT_B)).toEqual(beforeForeign);
    // The address that an attendee holds is no registration any more: kept, it could be deleted with that attendee.
    expect(await prisma.registration.count({ where: { id: taken.id } })).toBe(0);
    expect(await statusOf(unconfirmed!)).toBe("awaiting_email");
  });

  it("answers a second click on the same registration with `already_decided`, and makes one attendee", async () => {
    const [id] = await addRegistrations(1);

    expect(outcomes(await acceptOk([id!]))).toEqual(["accepted"]);
    expect(outcomes(await acceptOk([id!]))).toEqual(["already_decided"]);

    expect(await attendeeCount()).toBe(1);
    expect(await mailTemplates(id!)).toEqual(["ticket"]);
    expect(await logCount("registration_accepted")).toBe(1);
  });

  it("takes up to 500 registrations in one request: one attendee and one ticket row each, and one log entry", async () => {
    await prisma.event.update({ where: { id: EVENT_A }, data: { capacity: null } });
    const ids = await addRegistrations(MAX_REGISTRATION_BULK_IDS);

    const body = await acceptOk(ids);

    expect(body.results).toHaveLength(MAX_REGISTRATION_BULK_IDS);
    expect(new Set(outcomes(body))).toEqual(new Set(["accepted"]));
    expect(await attendeeCount()).toBe(MAX_REGISTRATION_BULK_IDS);
    expect(await prisma.registrationMail.count({ where: { event_id: EVENT_A, template_name: "ticket" } })).toBe(MAX_REGISTRATION_BULK_IDS);
    expect(await logCount("registration_accepted")).toBe(1);
  }, 120_000);

  describe("the seats (D-B4)", () => {
    async function almostFull(free: number, capacity = 10) {
      await prisma.event.update({ where: { id: EVENT_A }, data: { capacity } });
      for (let i = 0; i < capacity - free; i += 1) {
        await prisma.attendee.create({ data: { event_id: EVENT_A, email: `decisions-seat-${++sequence}@example.com`, name: "Seat Taker" } });
      }
    }

    it("refuses with 409 `not_enough_seats` and the numbers when the selection needs more seats than are free, and changes nothing", async () => {
      await almostFull(2);
      const ids = await addRegistrations(3);
      const before = await snapshot();

      const res = await accept(ids);

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "not_enough_seats", free: 2, needed: 3 });
      expect(await snapshot()).toEqual(before);
    });

    it("admits exactly as many as are free, and then refuses one more", async () => {
      await almostFull(2);
      const ids = await addRegistrations(3);

      expect(outcomes(await acceptOk(ids.slice(0, 2)))).toEqual(["accepted", "accepted"]);

      const res = await accept([ids[2]!]);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "not_enough_seats", free: 0, needed: 1 });
      expect(await attendeeCount()).toBe(10);
    });

    it("counts the companion of a registration as a seat", async () => {
      await almostFull(1);
      const [withCompanion] = await addRegistrations(1, { companions: [{ name: "Plus One", custom_data: null }] });

      const res = await accept([withCompanion!]);

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "not_enough_seats", free: 1, needed: 2 });
      expect(await statusOf(withCompanion!)).toBe("pending");
    });

    it("takes no partial decision: what would have fitted, and what would have been deleted, stay as they were", async () => {
      await almostFull(3);
      const [fits] = await addRegistrations(1);
      const [doesNotFit] = await addRegistrations(1, { companions: [{ name: "Plus One", custom_data: null }] });
      const held = await addRegistration();
      // An import came first with this address: the registration would be deleted by an acceptance. The attendee takes the third seat.
      await prisma.attendee.create({ data: { event_id: EVENT_A, email: held.email, name: "Imported Earlier" } });
      const before = await snapshot();

      const res = await accept([fits!, doesNotFit!, held.id]);

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "not_enough_seats", free: 2, needed: 3 });
      expect(await snapshot()).toEqual(before);
      expect(await prisma.registration.count({ where: { id: held.id } })).toBe(1);
    });

    it("has no limit to respect in an event without one, and refuses everyone in one that is over its limit (D-B7)", async () => {
      await prisma.event.update({ where: { id: EVENT_A }, data: { capacity: null } });
      const many = await addRegistrations(12);
      expect(new Set(outcomes(await acceptOk(many)))).toEqual(new Set(["accepted"]));

      await prisma.event.update({ where: { id: EVENT_A }, data: { capacity: 5 } });
      const [late] = await addRegistrations(1);
      const res = await accept([late!], { application: freshApp() });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "not_enough_seats", free: 0, needed: 1 });
    });
  });
});

describe("reject", () => {
  it("rejects pending and waiting registrations for the staff member, mails nobody by default, and logs it", async () => {
    const [pending, waiting] = [(await addRegistration()).id, (await addRegistration({ status: "waitlist" })).id];

    const res = await reject([pending, waiting]);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      results: [
        { id: pending, outcome: "rejected" },
        { id: waiting, outcome: "rejected" },
      ],
    });
    for (const id of [pending, waiting]) {
      expect(await prisma.registration.findUniqueOrThrow({ where: { id } })).toMatchObject({
        status: "rejected",
        decided_by: users.adminA,
        attendee_id: null,
      });
      expect(await mailTemplates(id)).toEqual([]);
    }
    const log = await prisma.attendeeActionLog.findFirstOrThrow({ where: { event_id: EVENT_A, action_type: "registration_rejected" } });
    expect(log).toMatchObject({ actor_user_id: users.adminA });
    expect(log.metadata).toEqual({ count: 2, registration_ids: [pending, waiting], notify: false });
    const central = await prisma.adminAuditLog.findMany({
      where: { organization_id: ORG_A, action_type: "registration_rejected", metadata: { path: ["registration_ids"], array_contains: [pending, waiting] } },
    });
    expect(central).toHaveLength(1);
    expect(central[0]).toMatchObject({ actor_user_id: users.adminA });
    expect(central[0]?.metadata).toMatchObject({ event_id: EVENT_A, count: 2, registration_ids: [pending, waiting], notify: false });
    expect(await attendeeCount()).toBe(0);
  });

  it("queues the rejection mail only when the organiser asks to inform the guest", async () => {
    const [id] = await addRegistrations(1);
    const [silent] = await addRegistrations(1);

    await reject([silent!], false);
    await reject([id!], true);

    expect(await mailTemplates(silent!)).toEqual([]);
    expect(await mailTemplates(id!)).toEqual(["registration-rejected"]);
    expect((await prisma.attendeeActionLog.findFirstOrThrow({ where: { event_id: EVENT_A, metadata: { path: ["notify"], equals: true } } })).action_type).toBe(
      "registration_rejected",
    );
  });

  it("says why nothing happened for a registration that cannot be rejected", async () => {
    const [accepted] = await addRegistrations(1, { status: "accepted" });
    const [unconfirmed] = await addRegistrations(1, { status: "awaiting_email" });
    const [already] = await addRegistrations(1, { status: "rejected" });
    const [foreign] = await addRegistrations(1, { eventId: EVENT_B });

    const res = await reject([accepted!, unconfirmed!, already!, foreign!, "no-such-registration"]);

    expect((await res.json()) as RejectRegistrationsDto).toEqual({
      results: [
        { id: accepted, outcome: "already_decided" },
        { id: unconfirmed, outcome: "awaiting_email" },
        { id: already, outcome: "already_decided" },
        { id: foreign, outcome: "gone" },
        { id: "no-such-registration", outcome: "gone" },
      ],
    });
    expect(await statusOf(accepted!)).toBe("accepted");
    expect(await statusOf(foreign!)).toBe("pending");
  });

  it("needs no seat, so a full event can turn guests down; and a rejected guest can be accepted later (D-B8)", async () => {
    await prisma.event.update({ where: { id: EVENT_A }, data: { capacity: 1 } });
    await prisma.attendee.create({ data: { event_id: EVENT_A, email: "decisions-holder@example.com", name: "Holder" } });
    const [waiting] = await addRegistrations(1, { status: "waitlist" });

    expect(outcomes((await (await reject([waiting!])).json()) as RejectRegistrationsDto)).toEqual(["rejected"]);

    await prisma.event.update({ where: { id: EVENT_A }, data: { capacity: 2 } });
    expect(outcomes(await acceptOk([waiting!]))).toEqual(["accepted"]);
    expect(await statusOf(waiting!)).toBe("accepted");
  });
});

describe("retry-mail (D-B15)", () => {
  const listOf = async (): Promise<RegistrationListDto> => {
    const res = await app.request(`/api/admin/events/${EVENT_A}/registrations`, { headers: { Cookie: cookies.adminA } });
    return (await res.json()) as RegistrationListDto;
  };

  it("puts the failed mail back in the queue, and the list stops offering the retry", async () => {
    const [id] = await addRegistrations(1);
    const mailId = await addFailedMail(id!);
    expect((await listOf()).items[0]?.last_mail).toMatchObject({ status: "failed", can_retry: true });

    const res = await retryMail([id!]);

    expect(res.status).toBe(200);
    expect((await res.json()) as RetryRegistrationMailsDto).toEqual({ results: [{ id, outcome: "retried" }] });
    expect(await prisma.registrationMail.findUniqueOrThrow({ where: { id: mailId } })).toMatchObject({
      status: "queued",
      attempts: 0,
      retryable: null,
      error: null,
      error_code: null,
    });
    expect((await listOf()).items[0]?.last_mail).toMatchObject({ status: "queued", can_retry: false });
    expect(await statusOf(id!)).toBe("pending");
    const log = await prisma.attendeeActionLog.findFirstOrThrow({ where: { event_id: EVENT_A, action_type: "registration_mail_retried" } });
    expect(log).toMatchObject({ actor_user_id: users.adminA, attendee_id: null });
    expect(log.metadata).toEqual({ count: 1, registration_ids: [id] });
  });

  it("does not queue again a mail the worker would cancel, because the registration has moved on", async () => {
    // Turned down with no notice: the failed "received" mail is still the last one, and the registration no longer fits it.
    const [id] = await addRegistrations(1, { status: "rejected" });
    const mailId = await addFailedMail(id!);
    expect((await listOf()).items[0]?.last_mail).toMatchObject({ status: "failed", can_retry: false });
    const before = await prisma.registrationMail.findUniqueOrThrow({ where: { id: mailId } });

    const res = await retryMail([id!]);

    expect(res.status).toBe(200);
    expect((await res.json()) as RetryRegistrationMailsDto).toEqual({ results: [{ id, outcome: "not_retryable" }] });
    expect(await prisma.registrationMail.findUniqueOrThrow({ where: { id: mailId } })).toEqual(before);
    expect(await logCount("registration_mail_retried")).toBe(0);
  });

  it("answers for each registration, and leaves a mail that cannot be sent again alone", async () => {
    const [failed, tried, silent] = await addRegistrations(3);
    await addFailedMail(failed!);
    const stillTried = await addFailedMail(tried!, { attempts: 2, retryable: true });
    const [foreign] = await addRegistrations(1, { eventId: EVENT_B });
    await addFailedMail(foreign!, {}, EVENT_B);

    const res = await retryMail([silent!, failed!, tried!, foreign!, "no-such-registration"]);

    expect((await res.json()) as RetryRegistrationMailsDto).toEqual({
      results: [
        { id: silent, outcome: "not_retryable" },
        { id: failed, outcome: "retried" },
        { id: tried, outcome: "not_retryable" },
        { id: foreign, outcome: "gone" },
        { id: "no-such-registration", outcome: "gone" },
      ],
    });
    expect((await prisma.registrationMail.findUniqueOrThrow({ where: { id: stillTried } })).status).toBe("failed");
    expect((await prisma.registrationMail.findFirstOrThrow({ where: { registration_id: foreign! } })).status).toBe("failed");
  });
});

describe("an archived event refuses every decision (SEC-08, DP-16)", () => {
  it.each(ACTIONS)("%s: answers 403 `event_archived` to an admin and to a superadmin, and changes nothing", async (action) => {
    const id = (await addRegistration({ eventId: EVENT_ARCHIVED })).id;
    await addFailedMail(id, {}, EVENT_ARCHIVED);
    const before = await snapshot(EVENT_ARCHIVED);

    for (const cookie of [cookies.adminA, cookies.superadmin]) {
      const res = await post(action, { ids: [id] }, { eventId: EVENT_ARCHIVED, cookie, application: freshApp() });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ code: "event_archived" });
    }

    expect(await snapshot(EVENT_ARCHIVED)).toEqual(before);
    expect(await attendeeCount(EVENT_ARCHIVED)).toBe(0);
  });
});

/** A transaction that runs `work`, reports it, and stays open until `commit` is called (`then` runs in it first): its locks are the test's to release. */
function holdTransaction<T>(
  client: PrismaClient,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
  then?: (tx: Prisma.TransactionClient) => Promise<unknown>,
) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: (value: T) => void;
  const hasStarted = new Promise<T>((resolve) => {
    started = resolve;
  });
  const transaction = client.$transaction(
    async (tx) => {
      started(await work(tx));
      await released;
      await then?.(tx);
    },
    { timeout: 30_000 },
  );
  return {
    started: hasStarted,
    commit: async () => {
      release();
      await transaction;
    },
  };
}

const waitUntilWaitingForAdvisoryLock = (client: PrismaClient, key: Prisma.Sql) =>
  vi.waitFor(
    async () => {
      const rows = await client.$queryRaw<{ waiting: bigint }[]>`
        SELECT count(*)::bigint AS "waiting"
        FROM pg_locks l, (SELECT (${key})::bigint AS "k") wanted
        WHERE l.locktype = 'advisory' AND NOT l.granted
          AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
          AND l.classid = ((wanted."k" >> 32) & 4294967295)::oid
          AND l.objid = (wanted."k" & 4294967295)::oid
      `;
      expect(Number(rows[0]?.waiting ?? 0)).toBeGreaterThan(0);
    },
    { timeout: 10_000, interval: 25 },
  );

const waitForRegistrationQueue = (eventId: string) =>
  waitUntilWaitingForAdvisoryLock(prisma, Prisma.sql`hashtextextended(${`registration-queue:${eventId}`}, 0)`);
const waitForCapacityLock = (eventId: string) =>
  waitUntilWaitingForAdvisoryLock(prisma, Prisma.sql`hashtext(${`event-capacity:${eventId}`})`);

// Tests that make requests wait for each other are bound by waits, not by work: a slow machine needs more than 5 s.
describe("decisions at the same time (family C)", { timeout: 60_000 }, () => {
  it("lets two organisers who click on the same registration at once accept it once", async () => {
    const [id] = await addRegistrations(1);

    const answers = await Promise.all([
      accept([id!], { application: freshApp() }),
      accept([id!], { cookie: cookies.superadmin, application: freshApp() }),
    ]);

    expect(answers.map((res) => res.status)).toEqual([200, 200]);
    const outcomeOf = async (res: Response) => outcomes((await res.json()) as AcceptRegistrationsDto)[0];
    expect((await Promise.all(answers.map(outcomeOf))).sort()).toEqual(["accepted", "already_decided"]);
    expect(await attendeeCount()).toBe(1);
    expect(await mailTemplates(id!)).toEqual(["ticket"]);
    expect(await logCount("registration_accepted")).toBe(1);
  });

  it("rejects a registration once when two organisers click at the same time, and mails the guest once", async () => {
    const [id] = await addRegistrations(1);

    const answers = await Promise.all([
      reject([id!], true, { application: freshApp() }),
      reject([id!], true, { cookie: cookies.superadmin, application: freshApp() }),
    ]);

    const outcomeOf = async (res: Response) => outcomes((await res.json()) as RejectRegistrationsDto)[0];
    expect((await Promise.all(answers.map(outcomeOf))).sort()).toEqual(["already_decided", "rejected"]);
    expect(await statusOf(id!)).toBe("rejected");
    expect(await mailTemplates(id!)).toEqual(["registration-rejected"]);
    expect(await logCount("registration_rejected")).toBe(1);
  });

  it("ends overlapping selections the same whichever request goes first: whoever is accepted stays accepted", async () => {
    await prisma.event.update({ where: { id: EVENT_A }, data: { capacity: null } });
    const ids = await addRegistrations(20);
    const toAccept = ids.slice(0, 12);
    const toReject = ids.slice(8);

    const answers = await Promise.all([
      accept(toAccept, { application: freshApp() }),
      reject(toReject, false, { cookie: cookies.superadmin, application: freshApp() }),
    ]);

    expect(answers.map((res) => res.status)).toEqual([200, 200]);
    // A rejected guest can be accepted (D-B8), and a reject finds an accepted one decided: acceptance wins either way.
    expect(await prisma.registration.count({ where: { id: { in: toAccept }, status: "accepted" } })).toBe(12);
    expect(await prisma.registration.count({ where: { id: { in: ids.slice(12) }, status: "rejected" } })).toBe(8);
    expect(await attendeeCount()).toBe(12);
    expect(await prisma.registrationMail.count({ where: { event_id: EVENT_A, template_name: "ticket" } })).toBe(12);
  });

  it("leaves one registration consistent when an accept and a reject of it arrive together", async () => {
    const [id] = await addRegistrations(1);

    const [accepted, rejected] = await Promise.all([
      accept([id!], { application: freshApp() }),
      reject([id!], true, { cookie: cookies.superadmin, application: freshApp() }),
    ]);

    // The reject first and then the accept (D-B8: a rejected guest can be accepted), or the accept first and then a reject
    // that finds the guest decided. Either way the guest ends accepted, once, and the log tells what each request did.
    expect(outcomes((await accepted!.json()) as AcceptRegistrationsDto)).toEqual(["accepted"]);
    const rejectedOutcome = outcomes((await rejected!.json()) as RejectRegistrationsDto)[0];
    expect(["rejected", "already_decided"]).toContain(rejectedOutcome);
    expect(await statusOf(id!)).toBe("accepted");
    expect(await attendeeCount()).toBe(1);
    expect(await logCount("registration_rejected")).toBe(rejectedOutcome === "rejected" ? 1 : 0);
    const rejectionMails = (await mailTemplates(id!)).filter((template) => template === "registration-rejected");
    expect(rejectionMails).toHaveLength(rejectedOutcome === "rejected" ? 1 : 0);
  });

  it("gives the seats to exactly as many single accepts as there are, and refuses the rest with the numbers", async () => {
    await prisma.event.update({ where: { id: EVENT_A }, data: { capacity: 5 } });
    const ids = await addRegistrations(12);

    const answers = await Promise.all(
      ids.map((id, index) => accept([id], { cookie: index % 2 === 0 ? cookies.adminA : cookies.superadmin })),
    );

    const statuses = answers.map((res) => res.status);
    expect(statuses.filter((status) => status === 200)).toHaveLength(5);
    expect(statuses.filter((status) => status === 409)).toHaveLength(7);
    for (const res of answers.filter((entry) => entry.status === 409)) {
      expect(await res.json()).toEqual({ error: "not_enough_seats", free: 0, needed: 1 });
    }
    expect(await attendeeCount()).toBe(5);
    expect(await prisma.registration.count({ where: { event_id: EVENT_A, status: "accepted" } })).toBe(5);
    expect(await prisma.registrationMail.count({ where: { event_id: EVENT_A, template_name: "ticket" } })).toBe(5);
  });

  it("lets only one of three overlapping selections that each need all the seats take them", async () => {
    const ids = await addRegistrations(20);

    const answers = await Promise.all([
      accept(ids.slice(0, 10), { application: freshApp() }),
      accept(ids.slice(10), { application: freshApp() }),
      accept(ids.slice(5, 15), { application: freshApp() }),
    ]);

    expect(answers.map((res) => res.status).sort()).toEqual([200, 409, 409]);
    expect(await attendeeCount()).toBe(10);
    expect(await prisma.registration.count({ where: { event_id: EVENT_A, status: "accepted" } })).toBe(10);
    expect(await logCount("registration_accepted")).toBe(1);
  });

  it("shares the last seat with a staff member who adds an attendee by hand: one of them gets it", async () => {
    await prisma.event.update({ where: { id: EVENT_A }, data: { capacity: 1 } });
    const [id] = await addRegistrations(1);

    const [accepted, created] = await Promise.all([
      accept([id!]),
      app.request(`/api/admin/events/${EVENT_A}/attendees`, {
        method: "POST",
        headers: { Cookie: cookies.superadmin, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ first_name: "Added", last_name: "ByHand", email: "decisions-by-hand@example.com" }),
      }),
    ]);

    // Either the acceptance came first (200, then the add is refused with 409) or the add did (201, then the acceptance is refused).
    expect([[200, 409], [409, 201]]).toContainEqual([accepted!.status, created!.status]);
    if (accepted!.status === 409) {
      expect(await accepted!.json()).toEqual({ error: "not_enough_seats", free: 0, needed: 1 });
      expect(await statusOf(id!)).toBe("pending");
    } else {
      expect(await statusOf(id!)).toBe("accepted");
    }
    expect(await attendeeCount()).toBe(1);
  });

  it("waits for a writer that holds the capacity lock, as an import does, and then finds the seat gone", async () => {
    await prisma.event.update({ where: { id: EVENT_A }, data: { capacity: 1 } });
    const [id] = await addRegistrations(1);
    const writer = holdTransaction(other, async (tx) => {
      await acquireEventCapacityLock(tx, EVENT_A);
      await tx.attendee.create({ data: { event_id: EVENT_A, email: "decisions-import@example.com", name: "Imported" } });
    });
    await writer.started;

    const accepting = accept([id!]);
    await waitForCapacityLock(EVENT_A);
    await writer.commit();

    const res = await accepting;
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "not_enough_seats", free: 0, needed: 1 });
    expect(await statusOf(id!)).toBe("pending");
    expect(await attendeeCount()).toBe(1);
  });

  it.each([
    ["accept", async (id: string) => await accept([id])],
    ["reject", async (id: string) => await reject([id], true)],
    ["retry-mail", async (id: string) => await retryMail([id])],
  ] as const)("%s: finds the event archived when the archive came while it waited for the queue", async (action, request) => {
    const id = (await addRegistration()).id;
    await addFailedMail(id);
    const before = await snapshot();
    // The request passes the guard (the event is not archived yet) and waits for the queue; the archive commits first.
    const archiver = holdTransaction(
      other,
      (tx) => lockRegistrationQueue(tx, EVENT_A),
      (tx) => tx.event.update({ where: { id: EVENT_A }, data: { archived_at: new Date() } }),
    );
    await archiver.started;

    const deciding = request(id);
    await waitForRegistrationQueue(EVENT_A);
    await archiver.commit();

    const res = await deciding;
    expect(res.status, action).toBe(403);
    expect(await res.json()).toEqual({ code: "event_archived" });
    expect(await snapshot()).toEqual(before);
  });

  it("answers a person who was erased meanwhile with `gone`: the erasure took the registration with it", async () => {
    const [id] = await addRegistrations(1);
    const eraser = holdTransaction(
      other,
      (tx) => lockRegistrationQueue(tx, EVENT_A),
      (tx) => tx.registration.delete({ where: { id: id! } }),
    );
    await eraser.started;

    const accepting = accept([id!]);
    await waitForRegistrationQueue(EVENT_A);
    await eraser.commit();

    expect(outcomes((await (await accepting).json()) as AcceptRegistrationsDto)).toEqual(["gone"]);
    expect(await attendeeCount()).toBe(0);
  });
});
