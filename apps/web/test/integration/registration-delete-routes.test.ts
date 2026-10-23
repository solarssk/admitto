import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptToString } from "@admitto/crypto";
import { PrismaClient, type RegistrationStatus } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";
import {
  MAX_REGISTRATION_BULK_IDS,
  admitRegistrations,
  deleteRegistrations,
  issueTicket,
  parseRegistrationFilter,
  registrationListWhere,
  registrationSelectionDigest,
} from "@admitto/tickets";
import { subscribe } from "../../src/admin/sse-channel.js";
import type { DeleteRegistrationsDto } from "../../src/admin/registration-delete-routes.js";
import type { RegistrationListDto } from "../../src/admin/registrations-api-routes.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { enrollConfirmedTotp } from "../helpers/enroll-confirmed-totp.js";
import { sessionCookieFor } from "../helpers/session-cookie.js";

/**
 * The staff routes that delete guest registrations (by ids, and by filter), against a real database through the real app:
 * who may call them, what a request must look like, what an answer says, that an archived event allows them, that an
 * accepted registration erases its attendee (ticket, place, wallet pass), that a filter deletes exactly what the list
 * showed and no more than a request may carry, and that nothing of the guests ends up in an audit entry or a log line.
 */
const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };

const ORG_A = "org-regdel-a";
const ORG_B = "org-regdel-b";
const EVENT_A = "evt-regdel-a";
const EVENT_B = "evt-regdel-b";
const EVENT_ARCHIVED = "evt-regdel-archived";
const EVENT_WALLET = "evt-regdel-wallet";
const EVENT_IDS = [EVENT_A, EVENT_B, EVENT_ARCHIVED, EVENT_WALLET];

const EMAILS = {
  adminA: "regdel-admin-a@example.com",
  adminB: "regdel-admin-b@example.com",
  operator: "regdel-operator@example.com",
  superadmin: "regdel-super@example.com",
};

let prisma: PrismaClient;
let app: ReturnType<typeof buildTestApp>;
const cookies = { adminA: "", adminB: "", operator: "", superadmin: "" };
let sequence = 0;

/** A fresh app has a fresh rate limit store, so a test never spends the budget of another. */
function freshApp(): ReturnType<typeof buildTestApp> {
  return buildTestApp({ prisma, checkinToken: "regdel-checkin-token-32-characters!", adminDistRoot });
}

async function wipeEvents(client: PrismaClient): Promise<void> {
  await client.registration.deleteMany({ where: { event_id: { in: EVENT_IDS } } });
  await client.walletPass.deleteMany({ where: { attendee: { event_id: { in: EVENT_IDS } } } });
  await client.emailDelivery.deleteMany({ where: { event_id: { in: EVENT_IDS } } });
  await client.attendee.deleteMany({ where: { event_id: { in: EVENT_IDS } } });
  await client.attendeeActionLog.deleteMany({ where: { event_id: { in: EVENT_IDS } } });
  await client.adminJob.deleteMany({ where: { event_id: { in: EVENT_IDS } } });
  await client.adminAuditLog.deleteMany({ where: { organization_id: { in: [ORG_A, ORG_B] } } });
}

async function wipeAll(client: PrismaClient): Promise<void> {
  await wipeEvents(client);
  await client.eventRegistrationSettings.deleteMany({ where: { event_id: { in: EVENT_IDS } } });
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
      { id: ORG_A, name: "Regdel Org A", slug: "regdel-org-a" },
      { id: ORG_B, name: "Regdel Org B", slug: "regdel-org-b" },
    ],
  });
  await client.event.createMany({
    data: [
      { id: EVENT_A, title: "Regdel A", slug: "regdel-a", date: new Date("2099-10-01"), organization_id: ORG_A, capacity: 10 },
      { id: EVENT_B, title: "Regdel B", slug: "regdel-b", date: new Date("2099-10-03"), organization_id: ORG_B, capacity: 10 },
      {
        id: EVENT_ARCHIVED,
        title: "Regdel Archived",
        slug: "regdel-archived",
        date: new Date("2099-09-01"),
        organization_id: ORG_A,
        capacity: 10,
        archived_at: new Date(),
      },
      {
        id: EVENT_WALLET,
        title: "Regdel Wallet",
        slug: "regdel-wallet",
        date: new Date("2099-10-04"),
        organization_id: ORG_A,
        capacity: 1000,
        wallet_template_id: "tmpl-regdel",
        wallet_api_key_enc: encryptToString("regdel-wallet-key"),
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
  cookies.adminA = await sessionCookieFor(client, adminA!.id);
  cookies.adminB = await sessionCookieFor(client, adminB!.id);
  cookies.operator = await sessionCookieFor(client, operator!.id);
  cookies.superadmin = await sessionCookieFor(client, superadmin!.id);
}

beforeAll(async () => {
  prisma = createTestPrismaClient();
  await seed(prisma);
});

beforeEach(async () => {
  await wipeEvents(prisma);
  await prisma.event.updateMany({ where: { id: { in: [EVENT_A, EVENT_B] } }, data: { capacity: 10, archived_at: null } });
  resetSystemLogBufferForTest();
  app = freshApp();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

afterAll(async () => {
  if (prisma) await wipeAll(prisma);
  await prisma?.$disconnect();
});

type SeedRegistration = {
  eventId?: string;
  status?: RegistrationStatus;
  email?: string;
  firstName?: string;
  lastName?: string;
  createdAt?: Date;
};

/** A registration with what the table's constraints ask: one that waits for its address gets its expiry, an accepted one its attendee. */
async function addRegistration(seedRow: SeedRegistration = {}): Promise<{ id: string; email: string; attendeeId: string | null }> {
  const eventId = seedRow.eventId ?? EVENT_A;
  const status = seedRow.status ?? "pending";
  const n = ++sequence;
  const email = seedRow.email ?? `regdel-guest-${n}@example.com`;
  const firstName = seedRow.firstName ?? "Delphine";
  const lastName = seedRow.lastName ?? `Marlowe${n}`;
  const attendee =
    status === "accepted"
      ? await prisma.attendee.create({ data: { event_id: eventId, email, name: `${firstName} ${lastName}`, first_name: firstName, last_name: lastName }, select: { id: true } })
      : null;
  const row = await prisma.registration.create({
    data: {
      event_id: eventId,
      email,
      first_name: firstName,
      last_name: lastName,
      name: `${firstName} ${lastName}`,
      status,
      confirm_expires_at: status === "awaiting_email" ? new Date(Date.now() + 86_400_000) : null,
      attendee_id: attendee?.id ?? null,
      ...(seedRow.createdAt ? { created_at: seedRow.createdAt } : {}),
    },
    select: { id: true },
  });
  await prisma.registrationMail.create({
    data: { registration_id: row.id, event_id: eventId, template_name: status === "accepted" ? "ticket" : "registration-received" },
  });
  return { id: row.id, email, attendeeId: attendee?.id ?? null };
}

async function addRegistrations(count: number, seedRow: SeedRegistration = {}): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) ids.push((await addRegistration(seedRow)).id);
  return ids;
}

/** Many registrations at once, as `createMany` writes them (the answers of the routes are what is looked at, not the rows' mail). */
async function addManyRegistrations(count: number, eventId: string, status: "rejected" | "accepted"): Promise<void> {
  const base = ++sequence * 10_000;
  const emails = Array.from({ length: count }, (_, i) => `regdel-bulk-${base + i}@example.com`);
  if (status === "accepted") {
    await prisma.attendee.createMany({ data: emails.map((email, i) => ({ id: `regdel-att-${base + i}`, event_id: eventId, email, name: `Bulk Guest ${i}` })) });
  }
  await prisma.registration.createMany({
    data: emails.map((email, i) => ({
      event_id: eventId,
      email,
      first_name: "Bulk",
      last_name: `Guest${i}`,
      name: `Bulk Guest${i}`,
      status,
      attendee_id: status === "accepted" ? `regdel-att-${base + i}` : null,
    })),
  });
}

const url = (eventId: string, action: "delete" | "delete-by-filter") => `/api/admin/events/${eventId}/registrations/${action}`;

async function post(
  path: string,
  body: unknown,
  cookie: string = cookies.adminA,
  headers: Record<string, string> = sameOrigin,
): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers, "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const deleteIds = (ids: string[], eventId = EVENT_A, cookie?: string) => post(url(eventId, "delete"), { ids }, cookie);

/** The name a list read just before would give the registrations the body's filter selects: what a deletion by filter has to send back. */
async function digestFor(eventId: string, body: Record<string, unknown>): Promise<string> {
  const parsed = parseRegistrationFilter({
    status: typeof body.status === "string" ? body.status : undefined,
    olderThan: typeof body.older_than === "string" ? body.older_than : undefined,
    q: typeof body.q === "string" ? body.q : undefined,
  });
  // A filter the route refuses gets a digest of the right shape, so that the refusal under test is the filter's.
  if (!parsed.ok) return "0".repeat(64);
  const rows = await prisma.registration.findMany({ where: registrationListWhere(eventId, parsed.filter, new Date()), select: { id: true } });
  return registrationSelectionDigest(rows.map((row) => row.id));
}
/** The digest is the one of what the filter selects at the time of the call, unless the body brings its own. */
const deleteFiltered = async (body: Record<string, unknown>, eventId = EVENT_A, cookie?: string) =>
  post(url(eventId, "delete-by-filter"), { selection_digest: await digestFor(eventId, body), ...body }, cookie);

const countRegistrations = (eventId = EVENT_A) => prisma.registration.count({ where: { event_id: eventId } });
const exists = async (id: string) => (await prisma.registration.count({ where: { id } })) === 1;

describe("who may delete registrations", () => {
  const ROUTES = ["delete", "delete-by-filter"] as const;
  const bodyFor = (route: (typeof ROUTES)[number], id: string) =>
    route === "delete" ? { ids: [id] } : { status: "pending", expected: 1, selection_digest: registrationSelectionDigest([id]) };

  it.each(ROUTES)("%s: lets the administrator of the event's organisation delete, and no other", async (route) => {
    const mine = await addRegistration();

    const refused = await post(url(EVENT_A, route), bodyFor(route, mine.id), cookies.adminB);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "forbidden" });
    expect(await exists(mine.id)).toBe(true);

    const allowed = await post(url(EVENT_A, route), bodyFor(route, mine.id), cookies.adminA);
    expect(allowed.status).toBe(200);
    expect(await exists(mine.id)).toBe(false);
  });

  it.each(ROUTES)("%s: refuses a door operator of the event", async (route) => {
    const mine = await addRegistration();

    const res = await post(url(EVENT_A, route), bodyFor(route, mine.id), cookies.operator);

    expect(res.status).toBe(403);
    expect(await exists(mine.id)).toBe(true);
  });

  it.each(ROUTES)("%s: refuses a request without a session", async (route) => {
    const mine = await addRegistration();

    const res = await post(url(EVENT_A, route), bodyFor(route, mine.id), "");

    expect([401, 403]).toContain(res.status);
    expect(await exists(mine.id)).toBe(true);
  });

  it.each(ROUTES)("%s: refuses a request that does not come from the page itself (no same-origin proof)", async (route) => {
    const mine = await addRegistration();

    const res = await post(url(EVENT_A, route), bodyFor(route, mine.id), cookies.adminA, { Origin: "https://elsewhere.example.net" });

    expect(res.status).toBe(403);
    expect(await exists(mine.id)).toBe(true);
  });

  it.each(ROUTES)("%s: lets a superadmin delete in any organisation, and answers 404 for an event that is not there", async (route) => {
    const other = await addRegistration({ eventId: EVENT_B });

    const res = await post(url(EVENT_B, route), bodyFor(route, other.id), cookies.superadmin);
    expect(res.status).toBe(200);
    expect(await exists(other.id)).toBe(false);

    const missing = await post(
      url("evt-regdel-missing", route),
      route === "delete" ? { ids: ["x"] } : { status: "pending", expected: 0, selection_digest: "0".repeat(64) },
      cookies.superadmin,
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "not_found" });
  });

  it("answers 403, not a leak, to an administrator of another organisation asking about the id of a registration they cannot see", async () => {
    const mine = await addRegistration();

    const res = await deleteIds([mine.id], EVENT_A, cookies.adminB);

    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain(mine.id);
    expect(await exists(mine.id)).toBe(true);
  });

  it("never reaches the registrations of another event of the same caller: such an id is gone, and the registration stays", async () => {
    const elsewhere = await addRegistration({ eventId: EVENT_ARCHIVED });
    const mine = await addRegistration();

    const res = await deleteIds([elsewhere.id, mine.id]);

    expect(await res.json()).toMatchObject({ results: [{ id: elsewhere.id, outcome: "gone" }, { id: mine.id, outcome: "deleted" }], deleted: 1 });
    expect(await exists(elsewhere.id)).toBe(true);
  });
});

describe("what a request must look like", () => {
  it.each([
    ["not JSON", "{nope"],
    ["an array", "[]"],
    ["no ids", "{}"],
    ["an empty list", JSON.stringify({ ids: [] })],
    ["ids that are not texts", JSON.stringify({ ids: [1, 2] })],
    ["an id that is too long", JSON.stringify({ ids: ["x".repeat(129)] })],
    ["too many ids", JSON.stringify({ ids: Array.from({ length: MAX_REGISTRATION_BULK_IDS + 1 }, (_, i) => `id-${i}`) })],
    ["a key it does not know", JSON.stringify({ ids: ["x"], notify: true })],
  ])("delete: refuses %s with 400 and deletes nothing", async (_label, body) => {
    const mine = await addRegistration();

    const res = await post(url(EVENT_A, "delete"), body);

    expect(res.status).toBe(400);
    expect(await exists(mine.id)).toBe(true);
  });

  it("delete: names what was wrong with the body in a fixed word, never an echo of it", async () => {
    const notJson = await post(url(EVENT_A, "delete"), "{nope");
    const wrongShape = await post(url(EVENT_A, "delete"), { ids: "regdel-secret-value" });

    expect(await notJson.json()).toEqual({ error: "invalid json" });
    expect(await wrongShape.json()).toEqual({ error: "validation_failed" });
  });

  it("delete: takes the most ids a request may carry", async () => {
    const ids = Array.from({ length: MAX_REGISTRATION_BULK_IDS }, (_, i) => `regdel-none-${i}`);

    const res = await deleteIds(ids);

    expect(res.status).toBe(200);
    expect(((await res.json()) as DeleteRegistrationsDto).results).toHaveLength(MAX_REGISTRATION_BULK_IDS);
  });

  it("delete: refuses a body over the size cap before it reads it", async () => {
    const res = await post(url(EVENT_A, "delete"), JSON.stringify({ ids: ["x".repeat(600_000)] }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "request too large" });
  });

  it("delete: refuses an id with a NUL character without a server error", async () => {
    const res = await deleteIds([`bad${String.fromCodePoint(0)}id`]);

    expect(res.status).toBe(400);
  });

  it.each([
    ["no expected number", { status: "pending" }],
    ["an expected number that is negative", { status: "pending", expected: -1 }],
    ["an expected number that is not a whole number", { status: "pending", expected: 1.5 }],
    ["an expected number that is a text", { status: "pending", expected: "1" }],
    ["a key it does not know", { status: "pending", expected: 1, ids: ["x"] }],
    ["no selection digest", { status: "pending", expected: 1, selection_digest: undefined }],
    ["a selection digest that is not 64 hex digits", { status: "pending", expected: 1, selection_digest: "abc" }],
    ["a selection digest in capitals", { status: "pending", expected: 1, selection_digest: "A".repeat(64) }],
    ["a selection digest that is a number", { status: "pending", expected: 1, selection_digest: 1 }],
  ])("delete-by-filter: refuses %s with 400 validation_failed", async (_label, body) => {
    const mine = await addRegistration();

    const res = await deleteFiltered(body);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "validation_failed" });
    expect(await exists(mine.id)).toBe(true);
  });

  it.each([
    ["a status that is not one of the five", { status: "deleted", expected: 1 }, ["status"]],
    ["an age that is not on the list", { older_than: "2d", expected: 1 }, ["older_than"]],
    ["a search with a control character", { q: `a${String.fromCodePoint(7)}b`, expected: 1 }, ["q"]],
    ["a search of too many words", { q: "a b c d e f g h i", expected: 1 }, ["q"]],
    ["two things wrong at once", { status: "x", older_than: "y", expected: 1 }, ["status", "older_than"]],
  ])("delete-by-filter: refuses %s and names the parameter, not the value", async (_label, body, fields) => {
    const mine = await addRegistration();

    const res = await deleteFiltered(body);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "validation_failed", fields });
    expect(await exists(mine.id)).toBe(true);
  });

  it("delete-by-filter: refuses a filter that selects everything, whatever number is expected", async () => {
    const ids = await addRegistrations(3);

    for (const body of [{ expected: 3 }, { status: "", expected: 3 }, { q: "   ", expected: 3 }, { q: "", older_than: "", expected: 3 }]) {
      const res = await deleteFiltered(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "validation_failed", fields: ["status", "older_than", "q"] });
    }
    expect(await countRegistrations()).toBe(ids.length);
  });
});

describe("deleting by ids", () => {
  it("deletes one registration, in each state, with its queued mail, and answers for it", async () => {
    for (const status of ["awaiting_email", "pending", "waitlist", "rejected"] as const) {
      const row = await addRegistration({ status });

      const res = await deleteIds([row.id]);

      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(await res.json()).toEqual({
        results: [{ id: row.id, outcome: "deleted" }],
        deleted: 1,
        attendees_erased: 0,
        wallet_pending: 0,
      });
      expect(await exists(row.id)).toBe(false);
      expect(await prisma.registrationMail.count({ where: { registration_id: row.id } })).toBe(0);
    }
  });

  it("deletes a selection in the order asked, tells a repeated id once, and names the ones that are gone", async () => {
    const [a, b, c] = await addRegistrations(3);

    const res = await deleteIds([c!, "regdel-unknown", a!, c!, b!]);

    const body = (await res.json()) as DeleteRegistrationsDto;
    expect(body.results).toEqual([
      { id: c, outcome: "deleted" },
      { id: "regdel-unknown", outcome: "gone" },
      { id: a, outcome: "deleted" },
      { id: b, outcome: "deleted" },
    ]);
    expect(body).toMatchObject({ deleted: 3, attendees_erased: 0 });
    expect(await countRegistrations()).toBe(0);
  });

  it("answers gone, with nothing new in the audit, when the request is repeated (a double click)", async () => {
    const row = await addRegistration();
    await deleteIds([row.id]);
    const entries = () => prisma.attendeeActionLog.count({ where: { event_id: EVENT_A, action_type: "registrations_deleted" } });
    expect(await entries()).toBe(1);

    const again = await deleteIds([row.id]);

    expect(await again.json()).toMatchObject({ results: [{ id: row.id, outcome: "gone" }], deleted: 0 });
    expect(await entries()).toBe(1);
  });

  it("tells the open screens of the event once when something was deleted, and not when nothing was", async () => {
    const row = await addRegistration();
    const heard: unknown[] = [];
    const unsubscribe = subscribe(EVENT_A, (event) => heard.push(event));

    await deleteIds([row.id]);
    await deleteIds([row.id]);
    await deleteFiltered({ status: "pending", expected: 7 });
    unsubscribe();

    expect(heard).toEqual([{ type: "activity_changed" }]);
  });

  it("writes ids and counts, and nothing of the guests, to both audit logs", async () => {
    const accepted = await addRegistration({ status: "accepted", firstName: "Zephyrine", lastName: "Quillfeather" });
    const pending = await addRegistration({ firstName: "Barnaby", lastName: "Thistlewood" });

    await deleteIds([accepted.id, pending.id]);

    const eventLog = await prisma.attendeeActionLog.findMany({ where: { event_id: EVENT_A, action_type: "registrations_deleted" } });
    const central = await prisma.adminAuditLog.findMany({ where: { organization_id: ORG_A, action_type: "registrations_deleted" } });
    expect(eventLog).toHaveLength(1);
    expect(central).toHaveLength(1);
    for (const metadata of [eventLog[0]!.metadata, central[0]!.metadata]) {
      expect(metadata).toMatchObject({
        count: 2,
        registration_ids: [accepted.id, pending.id].sort(),
        attendee_ids: [accepted.attendeeId],
        reason: "staff",
        by: "ids",
      });
    }
    const everything = JSON.stringify([
      await prisma.attendeeActionLog.findMany({ where: { event_id: EVENT_A } }),
      await prisma.adminAuditLog.findMany({ where: { organization_id: ORG_A } }),
    ]);
    for (const personal of [accepted.email, pending.email, "Zephyrine", "Quillfeather", "Barnaby", "Thistlewood"]) {
      expect(everything).not.toContain(personal);
    }
  });

  it("writes no log line that holds a name or an address, for a deletion that worked and for one that was refused", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const accepted = await addRegistration({ status: "accepted", firstName: "Zephyrine", lastName: "Quillfeather" });
    const pending = await addRegistration({ firstName: "Barnaby", lastName: "Thistlewood" });

    await deleteIds([accepted.id, pending.id]);
    await deleteFiltered({ status: "pending", expected: 4 });
    await deleteIds([accepted.id], EVENT_A, cookies.operator);

    const written = JSON.stringify([querySystemLogs(), errorSpy.mock.calls, warnSpy.mock.calls, logSpy.mock.calls]);
    for (const personal of [accepted.email, pending.email, "Zephyrine", "Quillfeather", "Barnaby", "Thistlewood"]) {
      expect(written).not.toContain(personal);
    }
  });

  it("spends the budget of the bulk attendee actions: the 21st request in a minute is refused", async () => {
    for (let i = 0; i < 20; i += 1) expect((await deleteIds(["regdel-none"])).status).toBe(200);

    const refused = await deleteIds(["regdel-none"]);

    expect(refused.status).toBe(429);
  });
});

describe("an accepted registration is an attendee", () => {
  const eventSeats = async (eventId: string) => {
    const res = await app.request(`/api/admin/events/${eventId}`, { headers: { Cookie: cookies.adminA } });
    return ((await res.json()) as { event: { seats_in_use: number } }).event.seats_in_use;
  };

  /** A guest accepted by an organiser, with the ticket link they were sent (a token that works). */
  async function acceptedWithTicket() {
    const pending = await addRegistration({ status: "pending" });
    const admitted = await admitRegistrations(prisma, { eventId: EVENT_A, ids: [pending.id], actor: { operator: "regdel-staff" } });
    expect(admitted).toMatchObject({ status: "done", outcomes: [{ id: pending.id, outcome: "accepted" }] });
    const attendee = await prisma.attendee.findFirstOrThrow({ where: { event_id: EVENT_A, email: pending.email } });
    const ticket = await issueTicket(attendee.id, prisma, "https://tickets.example.com");
    if (ticket.status !== "issued") throw new Error("the ticket was not issued");
    return { registrationId: pending.id, attendeeId: attendee.id, token: ticket.token };
  }

  it("erases the attendee: the ticket link stops working and the place is free again", async () => {
    const guest = await acceptedWithTicket();
    expect((await app.request(`/t/${guest.token}`)).status).toBe(200);
    expect(await eventSeats(EVENT_A)).toBe(1);

    const res = await deleteIds([guest.registrationId]);

    expect(await res.json()).toEqual({
      results: [{ id: guest.registrationId, outcome: "deleted", attendee_id: guest.attendeeId }],
      deleted: 1,
      attendees_erased: 1,
      wallet_pending: 0,
    });
    expect((await app.request(`/t/${guest.token}`)).status).toBe(404);
    const attendee = await prisma.attendee.findUniqueOrThrow({ where: { id: guest.attendeeId } });
    expect(attendee).toMatchObject({ name: "Erased attendee", status: "cancelled", token_hash: null, token_enc: null });
    expect(attendee.erased_at).not.toBeNull();
    expect(await exists(guest.registrationId)).toBe(false);
    expect(await eventSeats(EVENT_A)).toBe(0);
  });

  it("writes the entries of an erasure for the attendee, so the page of the erased attendee says who erased them", async () => {
    const guest = await acceptedWithTicket();

    await deleteIds([guest.registrationId]);

    const eventLog = await prisma.attendeeActionLog.findFirstOrThrow({ where: { event_id: EVENT_A, action_type: "attendee_erased" } });
    const central = await prisma.adminAuditLog.findFirstOrThrow({ where: { organization_id: ORG_A, action_type: "attendee_erased" } });
    expect(eventLog.metadata).toMatchObject({ attendee_id: guest.attendeeId, method: "erase", removed: { registrations: 1 } });
    expect(central.metadata).toMatchObject({ event_id: EVENT_A, attendee_id: guest.attendeeId, method: "erase" });
    const erased = await app.request(`/api/admin/events/${EVENT_A}/attendees/${guest.attendeeId}`, { headers: { Cookie: cookies.adminA } });
    expect(await erased.json()).toMatchObject({ erased_at: expect.any(String), erasure: { via: "admin" } });
  });

  it("writes one erasure entry for a selection of several accepted guests, and one for the deletion", async () => {
    const one = await acceptedWithTicket();
    const two = await acceptedWithTicket();

    await deleteIds([one.registrationId, two.registrationId]);

    const erasures = await prisma.attendeeActionLog.findMany({ where: { event_id: EVENT_A, action_type: "attendees_bulk_erased" } });
    expect(erasures).toHaveLength(1);
    const erased = erasures[0]!.metadata as { attendee_ids: string[]; count: number; method: string };
    expect([...erased.attendee_ids].sort()).toEqual([one.attendeeId, two.attendeeId].sort());
    expect(erased).toMatchObject({ count: 2, method: "erase" });
    expect(await prisma.attendeeActionLog.count({ where: { event_id: EVENT_A, action_type: "registrations_deleted" } })).toBe(1);
  });

  it("keeps the place of a guest who was admitted at the door, and erases the data", async () => {
    const guest = await acceptedWithTicket();
    await prisma.attendee.update({ where: { id: guest.attendeeId }, data: { admitted_at: new Date() } });

    await deleteIds([guest.registrationId]);

    expect((await prisma.attendee.findUniqueOrThrow({ where: { id: guest.attendeeId } })).status).toBe("registered");
    expect(await eventSeats(EVENT_A)).toBe(1);
    expect((await app.request(`/t/${guest.token}`)).status).toBe(404);
  });

  it("works on an archived event, where the numbers stay as they were", async () => {
    const pending = await addRegistration({ eventId: EVENT_ARCHIVED, status: "pending" });
    const accepted = await addRegistration({ eventId: EVENT_ARCHIVED, status: "accepted" });

    const res = await deleteIds([pending.id, accepted.id], EVENT_ARCHIVED);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ deleted: 2, attendees_erased: 1 });
    expect(await countRegistrations(EVENT_ARCHIVED)).toBe(0);
    const attendee = await prisma.attendee.findUniqueOrThrow({ where: { id: accepted.attendeeId! } });
    expect(attendee).toMatchObject({ name: "Erased attendee", status: "registered" });
  });

  it("frees the place for the next guest, for whom an admission then succeeds", async () => {
    await prisma.event.update({ where: { id: EVENT_A }, data: { capacity: 1 } });
    const guest = await acceptedWithTicket();
    const waiting = await addRegistration({ status: "waitlist" });
    expect(await admitRegistrations(prisma, { eventId: EVENT_A, ids: [waiting.id], actor: { operator: "regdel-staff" } })).toMatchObject({
      status: "not_enough_seats",
    });

    await deleteIds([guest.registrationId]);

    expect(await admitRegistrations(prisma, { eventId: EVENT_A, ids: [waiting.id], actor: { operator: "regdel-staff" } })).toMatchObject({
      status: "done",
    });
  });
});

describe("the wallet pass of an erased attendee", () => {
  /** An accepted guest of the event that has wallet credentials, with a pass recorded at the provider. */
  async function acceptedWithPass() {
    const guest = await addRegistration({ eventId: EVENT_WALLET, status: "accepted" });
    await prisma.walletPass.create({
      data: {
        attendee_id: guest.attendeeId!,
        status: "active",
        provider_pass_id: `pc-${guest.attendeeId}`,
        issued_at: new Date(Date.now() - 3 * 24 * 3_600_000),
      },
    });
    return guest;
  }

  /** The provider as the follow-up meets it: the delete of a pass answers 200, and the question for the reserved id finds no pass. */
  const providerThatHoldsNothing = () =>
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const { pathname } = new URL(String(input));
      if (init?.method === "GET" && pathname.startsWith("/api/pass/")) return new Response(null, { status: 404 });
      return new Response(null, { status: 200 });
    });

  it("is deleted at the provider after the commit, and the answer says nothing is pending", async () => {
    const guest = await acceptedWithPass();
    const provider = providerThatHoldsNothing();
    vi.stubGlobal("fetch", provider);

    const res = await deleteIds([guest.id], EVENT_WALLET);

    expect(await res.json()).toMatchObject({ deleted: 1, attendees_erased: 1, wallet_pending: 0 });
    expect(provider.mock.calls.map(([input, init]) => `${init?.method} ${new URL(String(input)).pathname}`)).toContain(
      `DELETE /api/v3/pass/pc-${guest.attendeeId}`,
    );
    expect((await prisma.walletPass.findUniqueOrThrow({ where: { attendee_id: guest.attendeeId! } })).provider_removed_at).not.toBeNull();
  });

  it("is reported as pending when the provider fails, and the erase of the erased attendee finishes it", async () => {
    const guest = await acceptedWithPass();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 500 })));

    const res = await deleteIds([guest.id], EVENT_WALLET);

    expect(await res.json()).toMatchObject({ deleted: 1, attendees_erased: 1, wallet_pending: 1 });
    expect(await exists(guest.id)).toBe(false);

    vi.stubGlobal("fetch", providerThatHoldsNothing());
    const retry = await post(`/api/admin/events/${EVENT_WALLET}/attendees/${guest.attendeeId}/erase`, {});

    expect(await retry.json()).toMatchObject({ erased: 0, already_erased: 1, wallet_pending: 0, wallet_removed_ids: [guest.attendeeId] });
  });

  it("calls the provider for nobody when the deletion erases no attendee", async () => {
    const pending = await addRegistration({ eventId: EVENT_WALLET, status: "pending" });
    const provider = vi.fn();
    vi.stubGlobal("fetch", provider);

    const res = await deleteIds([pending.id], EVENT_WALLET);

    expect(await res.json()).toMatchObject({ deleted: 1, attendees_erased: 0, wallet_pending: 0 });
    expect(provider).not.toHaveBeenCalled();
  });

  it("refuses more accepted registrations than the wallet follow-up can take in one request, and deletes nothing", async () => {
    await addManyRegistrations(101, EVENT_WALLET, "accepted");

    const res = await deleteFiltered({ status: "accepted", expected: 101 }, EVENT_WALLET);

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "too_many_accepted", accepted: 101, limit: 100 });
    expect(await countRegistrations(EVENT_WALLET)).toBe(101);
    expect(await prisma.attendee.count({ where: { event_id: EVENT_WALLET, erased_at: { not: null } } })).toBe(0);
  });

  it("takes as many accepted registrations as the cap allows, and more where no pass can be at a provider", async () => {
    await addManyRegistrations(100, EVENT_WALLET, "accepted");
    vi.stubGlobal("fetch", providerThatHoldsNothing());
    const withWallet = await deleteFiltered({ status: "accepted", expected: 100 }, EVENT_WALLET);
    expect(await withWallet.json()).toMatchObject({ deleted: 100, attendees_erased: 100 });

    await addManyRegistrations(101, EVENT_A, "accepted");
    const withoutWallet = await deleteFiltered({ status: "accepted", expected: 101 });
    expect(await withoutWallet.json()).toMatchObject({ deleted: 101, attendees_erased: 101 });
    expect(await countRegistrations()).toBe(0);
  }, 60_000);
});

describe("deleting by filter", () => {
  const DAY_MS = 86_400_000;

  async function mixed() {
    const old = new Date(Date.now() - 40 * DAY_MS);
    const fresh = new Date(Date.now() - 2 * 3_600_000);
    return {
      oldRejected: await addRegistration({ status: "rejected", createdAt: old, firstName: "Olwen", lastName: "Ashgrove" }),
      oldRejected2: await addRegistration({ status: "rejected", createdAt: old, firstName: "Perdita", lastName: "Fenwick" }),
      freshRejected: await addRegistration({ status: "rejected", createdAt: fresh, firstName: "Olwen", lastName: "Brightwater" }),
      oldPending: await addRegistration({ status: "pending", createdAt: old }),
      oldWaiting: await addRegistration({ status: "awaiting_email", createdAt: old }),
    };
  }

  async function listTotal(query: string): Promise<number> {
    const res = await app.request(`/api/admin/events/${EVENT_A}/registrations?${query}`, { headers: { Cookie: cookies.adminA } });
    return ((await res.json()) as { total: number }).total;
  }

  it("deletes exactly the registrations the list shows for the same parameters, and answers for each", async () => {
    const rows = await mixed();
    const total = await listTotal("status=rejected&older_than=30d");
    expect(total).toBe(2);

    const res = await deleteFiltered({ status: "rejected", older_than: "30d", expected: total });

    expect(res.status).toBe(200);
    const body = (await res.json()) as DeleteRegistrationsDto;
    expect(body.results.map((result) => result.id).sort()).toEqual([rows.oldRejected.id, rows.oldRejected2.id].sort());
    expect(body).toMatchObject({ deleted: 2, attendees_erased: 0, wallet_pending: 0 });
    for (const kept of [rows.freshRejected, rows.oldPending, rows.oldWaiting]) expect(await exists(kept.id)).toBe(true);
  });

  it("takes the search of the list too, and says in the audit entry that a search was used, not what it was", async () => {
    await mixed();
    const total = await listTotal("q=olwen");
    expect(total).toBe(2);

    await deleteFiltered({ q: "olwen", expected: total });

    const [entry] = await prisma.attendeeActionLog.findMany({ where: { event_id: EVENT_A, action_type: "registrations_deleted" } });
    expect(entry?.metadata).toMatchObject({ by: "filter", reason: "staff", count: 2, filter: { search: true } });
    expect(JSON.stringify(entry)).not.toContain("olwen");
  });

  it("deletes nothing when the number is no longer the one that was shown, and says both numbers", async () => {
    const rows = await mixed();

    const stale = await deleteFiltered({ status: "rejected", expected: 2 });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: "registration_count_changed", expected: 2, matched: 3 });
    const none = await deleteFiltered({ status: "rejected", expected: 0 });
    expect(none.status).toBe(409);

    expect(await countRegistrations()).toBe(5);
    expect(await exists(rows.oldRejected.id)).toBe(true);
    expect(await prisma.attendeeActionLog.count({ where: { event_id: EVENT_A, action_type: "registrations_deleted" } })).toBe(0);
  });

  it("deletes nothing, with 409, when the filter selects the same number but not the registrations that were shown", async () => {
    const rows = await mixed();
    const shown = await digestFor(EVENT_A, { status: "rejected" });
    // One left the filter (deleted by someone else) and another joined it (rejected since): three of them, as before.
    await prisma.registration.delete({ where: { id: rows.freshRejected.id } });
    await prisma.registration.update({ where: { id: rows.oldPending.id }, data: { status: "rejected" } });

    const res = await deleteFiltered({ status: "rejected", expected: 3, selection_digest: shown });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "registration_selection_changed", matched: 3 });
    expect(await countRegistrations()).toBe(4);
    expect(await exists(rows.oldPending.id)).toBe(true);
    expect(await prisma.attendeeActionLog.count({ where: { event_id: EVENT_A, action_type: "registrations_deleted" } })).toBe(0);
  });

  it("deletes what the list showed, with the digest and the total the list gave", async () => {
    const rows = await mixed();
    const listed = await app.request(`/api/admin/events/${EVENT_A}/registrations?status=rejected&q=olwen`, {
      headers: { Cookie: cookies.adminA },
    });
    const shown = (await listed.json()) as RegistrationListDto;
    expect(shown.total).toBe(2);

    const res = await deleteFiltered({ status: "rejected", q: "olwen", expected: shown.total, selection_digest: shown.selection_digest });

    expect(res.status).toBe(200);
    expect(((await res.json()) as DeleteRegistrationsDto).deleted).toBe(2);
    expect(await exists(rows.oldRejected.id)).toBe(false);
    expect(await exists(rows.freshRejected.id)).toBe(false);
    expect(await exists(rows.oldRejected2.id)).toBe(true);
  });

  it("deletes nothing, with 422, when the filter selects more than a request may carry", async () => {
    await addManyRegistrations(MAX_REGISTRATION_BULK_IDS + 1, EVENT_A, "rejected");

    const res = await deleteFiltered({ status: "rejected", expected: MAX_REGISTRATION_BULK_IDS + 1 });

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "too_many_registrations", matched: MAX_REGISTRATION_BULK_IDS + 1, limit: MAX_REGISTRATION_BULK_IDS });
    expect(await countRegistrations()).toBe(MAX_REGISTRATION_BULK_IDS + 1);

    // A narrower filter, which selects nothing here, is still a request that goes through.
    const narrower = await deleteFiltered({ status: "rejected", older_than: "1h", expected: 0 });
    expect(await narrower.json()).toMatchObject({ deleted: 0 });
  });

  it("takes as many as a request may carry", async () => {
    await addManyRegistrations(MAX_REGISTRATION_BULK_IDS, EVENT_A, "rejected");

    const res = await deleteFiltered({ status: "rejected", expected: MAX_REGISTRATION_BULK_IDS });

    expect(await res.json()).toMatchObject({ deleted: MAX_REGISTRATION_BULK_IDS });
    expect(await countRegistrations()).toBe(0);
  });

  it("is limited to the event of the address, and to who may manage it", async () => {
    await mixed();
    const other = await addRegistration({ eventId: EVENT_B, status: "rejected" });

    const refused = await deleteFiltered({ status: "rejected", expected: 3 }, EVENT_B, cookies.adminA);
    expect(refused.status).toBe(403);
    expect(await exists(other.id)).toBe(true);

    await deleteFiltered({ status: "rejected", expected: 3 });
    expect(await exists(other.id)).toBe(true);
  });

  it("works on an archived event", async () => {
    await addRegistration({ eventId: EVENT_ARCHIVED, status: "rejected" });
    await addRegistration({ eventId: EVENT_ARCHIVED, status: "accepted" });

    const res = await deleteFiltered({ status: "accepted", expected: 1 }, EVENT_ARCHIVED);

    expect(await res.json()).toMatchObject({ deleted: 1, attendees_erased: 1 });
    expect(await countRegistrations(EVENT_ARCHIVED)).toBe(1);
  });
});

describe("a manual add and a deletion for the last place", () => {
  const addByHand = () =>
    post(`/api/admin/events/${EVENT_A}/attendees`, { first_name: "Walk", last_name: "In", email: `regdel-walk-in-${++sequence}@example.com` });

  it("frees the place only when the deletion commits, and neither request waits for the other", async () => {
    await prisma.event.update({ where: { id: EVENT_A }, data: { capacity: 1 } });
    const guest = await addRegistration({ status: "accepted" });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let erased!: () => void;
    const hasDeleted = new Promise<void>((resolve) => {
      erased = resolve;
    });
    const deleting = prisma.$transaction(
      async (tx) => {
        await deleteRegistrations(tx, { eventId: EVENT_A, target: { kind: "ids", ids: [guest.id] }, actor: { operator: "regdel-staff" } });
        erased();
        await held;
      },
      { timeout: 30_000 },
    );
    await hasDeleted;

    // The deletion has done its work and not committed: the place is still the guest's, and the add is not kept waiting.
    const whileOpen = await addByHand();
    expect(whileOpen.status).toBe(409);
    expect(await whileOpen.json()).toMatchObject({ code: "event_full" });
    release();
    await deleting;

    const afterCommit = await addByHand();
    expect(afterCommit.status).toBe(201);
    expect(await prisma.attendee.count({ where: { event_id: EVENT_A, erased_at: null, status: { notIn: ["cancelled", "revoked"] } } })).toBe(1);
  });

  it("never ends over the limit when an add and a deletion race for the place of an accepted guest", async () => {
    await prisma.event.update({ where: { id: EVENT_A }, data: { capacity: 1 } });
    const guest = await addRegistration({ status: "accepted" });

    const [deletion, add] = await Promise.all([deleteIds([guest.id]), addByHand()]);

    expect(deletion.status).toBe(200);
    // Either the add counted the guest's place before the commit (event full), or after it (created): never over the limit.
    expect([201, 409]).toContain(add.status);
    expect(await prisma.attendee.count({ where: { event_id: EVENT_A, status: { notIn: ["cancelled", "revoked"] } } })).toBeLessThanOrEqual(1);
  });
});

describe("requests at the same time", () => {
  it("deletes each registration once between two deletions and a filter: the other request finds it gone, and no request fails", async () => {
    const ids = await addRegistrations(6);
    const accepted = await addRegistration({ status: "accepted" });
    const all = [...ids, accepted.id];

    const answers = await Promise.all([deleteIds(all), deleteIds([...all].reverse()), deleteFiltered({ status: "pending", expected: 6 })]);

    expect(answers.map((res) => res.status).filter((status) => status >= 500)).toEqual([]);
    expect(await countRegistrations()).toBe(0);
    const attendee = await prisma.attendee.findUniqueOrThrow({ where: { id: accepted.attendeeId! } });
    expect(attendee.erased_at).not.toBeNull();
    const deleted = await Promise.all(
      answers.filter((res) => res.status === 200).map(async (res) => ((await res.json()) as DeleteRegistrationsDto).deleted),
    );
    // The registrations are deleted once between the requests that went through: the accepted one erased its attendee once.
    expect(await prisma.attendeeActionLog.count({ where: { event_id: EVENT_A, action_type: "attendee_erased" } })).toBe(1);
    expect(deleted.reduce((sum, count) => sum + count, 0)).toBe(all.length);
  });

  it("settles an admission and a deletion of the same registration on one of two states, never half of each", async () => {
    const [row] = await addRegistrations(1);

    const [admission, deletion] = await Promise.all([
      admitRegistrations(prisma, { eventId: EVENT_A, ids: [row!], actor: { operator: "regdel-staff" } }),
      deleteIds([row!]),
    ]);

    expect(deletion.status).toBe(200);
    expect(await exists(row!)).toBe(false);
    expect(admission).toMatchObject({ status: "done" });
    // Either the admission found it gone (nobody was made), or it made an attendee that the deletion then erased.
    expect(await prisma.attendee.count({ where: { event_id: EVENT_A, erased_at: null } })).toBe(0);
  });
});
