/**
 * The administrator's deliberate "Show" of the answers to sensitive questions (D-E6, 117b), against a real database and
 * the real app: `POST .../registrations/:id/reveal` and `POST .../attendees/:id/reveal-sensitive`. Who may use them (an
 * administrator of the organisation and a superadmin, never an operator or another organisation), what they return (the
 * answers to the questions that are sensitive now, of the guest and the companion, and no ordinary answer), a person who
 * was erased or deleted, an erasure that is open, an archived event, the entries of both audit logs (keys and counts,
 * never a value), the budget per user, and that no answer reaches a log, an error or an audit entry, also when the
 * entry cannot be written.
 */
import { randomUUID } from "node:crypto";
import { inspect } from "node:util";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma, PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";
import { deleteRegistrations, eraseAttendees } from "@admitto/tickets";
import { buildTestApp } from "../helpers/build-test-app.js";
import { enrollConfirmedTotp } from "../helpers/enroll-confirmed-totp.js";
import { sessionCookieFor } from "../helpers/session-cookie.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");

const ORG_A = "org-reveal-a";
const ORG_B = "org-reveal-b";
const EVENT_ID = "evt-reveal";
const OTHER_EVENT_ID = "evt-reveal-other";
const ARCHIVED_EVENT_ID = "evt-reveal-archived";
const EVENT_IDS = [EVENT_ID, OTHER_EVENT_ID, ARCHIVED_EVENT_ID];
const EMAILS = {
  admin: "reveal-admin@example.com",
  superadmin: "reveal-super@example.com",
  operator: "reveal-operator@example.com",
  otherOrgAdmin: "reveal-other-admin@example.com",
  secondAdmin: "reveal-second-admin@example.com",
};
const ACTION = "sensitive_data_revealed";

let prisma: PrismaClient;
let app: ReturnType<typeof buildTestApp>;
const cookies = { admin: "", superadmin: "", operator: "", otherOrgAdmin: "", secondAdmin: "" };
const userIds = { admin: "", superadmin: "" };
let sequence = 0;

async function wipeAll(client: PrismaClient): Promise<void> {
  await client.attendee.deleteMany({ where: { event_id: { in: EVENT_IDS } } });
  await client.registration.deleteMany({ where: { event_id: { in: EVENT_IDS } } });
  await client.attendeeActionLog.deleteMany({ where: { event_id: { in: EVENT_IDS } } });
  await client.adminAuditLog.deleteMany({ where: { organization_id: { in: [ORG_A, ORG_B] } } });
  await client.eventCustomField.deleteMany({ where: { event_id: { in: EVENT_IDS } } });
  await client.roleAssignment.deleteMany({ where: { scope_id: { in: [ORG_A, ORG_B, ...EVENT_IDS] } } });
  await client.session.deleteMany({ where: { user: { email: { in: Object.values(EMAILS) } } } });
  await client.userMfaMethod.deleteMany({ where: { user: { email: { in: Object.values(EMAILS) } } } });
  await client.user.deleteMany({ where: { email: { in: Object.values(EMAILS) } } });
  await client.event.deleteMany({ where: { id: { in: EVENT_IDS } } });
  await client.organization.deleteMany({ where: { id: { in: [ORG_A, ORG_B] } } });
}

beforeAll(async () => {
  prisma = createTestPrismaClient();
  await wipeAll(prisma);
  await prisma.organization.createMany({
    data: [
      { id: ORG_A, name: "Reveal Org A", slug: "reveal-org-a" },
      { id: ORG_B, name: "Reveal Org B", slug: "reveal-org-b" },
    ],
  });
  await prisma.event.createMany({
    data: [
      { id: EVENT_ID, title: "Reveal", slug: "reveal", date: new Date("2030-10-01"), organization_id: ORG_A, capacity: 50 },
      { id: OTHER_EVENT_ID, title: "Reveal Other", slug: "reveal-other", date: new Date("2030-10-02"), organization_id: ORG_A, capacity: 50 },
      { id: ARCHIVED_EVENT_ID, title: "Reveal Archived", slug: "reveal-archived", date: new Date("2030-10-03"), archived_at: new Date("2030-10-04"), organization_id: ORG_A, capacity: 50 },
    ],
  });
  // Two sensitive questions (one about the guest, one about a companion) and two ordinary ones next to them.
  for (const eventId of EVENT_IDS) {
    await prisma.eventCustomField.createMany({
      data: [
        { event_id: eventId, source_field: "allergy", label: "Allergy", type: "text", sensitive: true, show_on_form: true },
        { event_id: eventId, source_field: "shirt", label: "Shirt", type: "text", show_on_form: true },
        { event_id: eventId, source_field: "access", label: "Access needs", type: "text", sensitive: true, applies_to: "companion", show_on_form: true },
        { event_id: eventId, source_field: "diet", label: "Diet", type: "text", applies_to: "companion", show_on_form: true },
      ],
    });
  }
  const users = await Promise.all(Object.values(EMAILS).map((email) => prisma.user.create({ data: { email } })));
  const [admin, superadmin, operator, otherOrgAdmin, secondAdmin] = users;
  await prisma.roleAssignment.createMany({
    data: [
      { user_id: admin!.id, role: "admin", scope_type: "organization", scope_id: ORG_A },
      { user_id: superadmin!.id, role: "superadmin", scope_type: "instance", scope_id: null },
      { user_id: operator!.id, role: "operator", scope_type: "event", scope_id: EVENT_ID },
      { user_id: otherOrgAdmin!.id, role: "admin", scope_type: "organization", scope_id: ORG_B },
      { user_id: secondAdmin!.id, role: "admin", scope_type: "organization", scope_id: ORG_A },
    ],
  });
  for (const user of users) await enrollConfirmedTotp(prisma, user.id);
  userIds.admin = admin!.id;
  userIds.superadmin = superadmin!.id;
  cookies.admin = await sessionCookieFor(prisma, admin!.id);
  cookies.superadmin = await sessionCookieFor(prisma, superadmin!.id);
  cookies.operator = await sessionCookieFor(prisma, operator!.id);
  cookies.otherOrgAdmin = await sessionCookieFor(prisma, otherOrgAdmin!.id);
  cookies.secondAdmin = await sessionCookieFor(prisma, secondAdmin!.id);
});

beforeEach(async () => {
  resetSystemLogBufferForTest();
  // The entries of the tests before: each test reads the logs whole.
  await prisma.attendeeActionLog.deleteMany({ where: { event_id: { in: EVENT_IDS } } });
  await prisma.adminAuditLog.deleteMany({ where: { organization_id: { in: [ORG_A, ORG_B] } } });
  app = buildTestApp({ prisma, checkinToken: "reveal-checkin-token-32-characters!", adminDistRoot });
});

afterAll(async () => {
  if (prisma) await wipeAll(prisma);
  await prisma?.$disconnect();
});

const consoleMethods = ["log", "info", "warn", "error", "debug"] as const;
const spies: Array<{ mock: { calls: unknown[][] } }> = [];
beforeEach(() => {
  for (const method of consoleMethods) spies.push(vi.spyOn(console, method).mockImplementation(() => {}));
});
afterEach(() => {
  vi.restoreAllMocks();
  spies.length = 0;
});

/** Everything written to the console or to the system log since the test began, as one lower-case text. */
function written(): string {
  const lines = spies.flatMap((spy) => spy.mock.calls.map((call) => call.map((arg) => inspect(arg, { depth: 6 })).join(" ")));
  return [...lines, ...querySystemLogs().map((entry) => JSON.stringify(entry))].join("\n").toLowerCase();
}

/** A marker no other test writes: the scans below read whole tables. */
const uniqueMarker = () => `Zzyzx-${randomUUID()}`;

type Person = {
  attendeeId: string;
  registrationId: string;
  /** The text of the sensitive answer of the guest. */
  guestAnswer: string;
  /** The text of the sensitive answer of the companion. */
  companionAnswer: string;
  /** The text of the ordinary answers, which a reveal must never return. */
  ordinary: string;
};

/**
 * An accepted guest with a companion, in the attendee and in the registration (which keeps its own copy). Each holds a
 * sensitive answer and an ordinary one for the guest and for the companion, and a key no question has.
 */
async function person(options: { eventId?: string; sensitive?: boolean; companion?: boolean } = {}): Promise<Person> {
  sequence += 1;
  const eventId = options.eventId ?? EVENT_ID;
  const withAnswers = options.sensitive !== false;
  const guestAnswer = uniqueMarker();
  const companionAnswer = uniqueMarker();
  const ordinary = uniqueMarker();
  const guestData = { shirt: ordinary, ghost: ordinary, ...(withAnswers ? { allergy: guestAnswer } : {}) };
  const companionData = { diet: ordinary, ...(withAnswers ? { access: companionAnswer } : {}) };
  const email = `reveal-${sequence}@example.com`;
  const attendee = await prisma.attendee.create({
    data: {
      event_id: eventId,
      email,
      name: `Guest ${sequence}`,
      first_name: "Guest",
      last_name: `Number${sequence}`,
      status: "registered",
      custom_data: guestData,
      ...(options.companion === false ? {} : { companions: { create: { slot: 1, name: `Companion ${sequence}`, custom_data: companionData } } }),
    },
  });
  const registration = await prisma.registration.create({
    data: {
      event_id: eventId,
      email,
      first_name: "Guest",
      last_name: `Number${sequence}`,
      name: `Guest Number${sequence}`,
      status: "accepted",
      attendee_id: attendee.id,
      custom_data: guestData,
      companions: options.companion === false ? [] : [{ name: `Companion ${sequence}`, custom_data: companionData }],
    },
  });
  return { attendeeId: attendee.id, registrationId: registration.id, guestAnswer, companionAnswer, ordinary };
}

/** A registration that waits for a decision (no attendee yet), with the same answers. */
async function pendingRegistration(): Promise<Person> {
  sequence += 1;
  const guestAnswer = uniqueMarker();
  const companionAnswer = uniqueMarker();
  const ordinary = uniqueMarker();
  const registration = await prisma.registration.create({
    data: {
      event_id: EVENT_ID,
      email: `reveal-pending-${sequence}@example.com`,
      first_name: "Pending",
      last_name: `Number${sequence}`,
      name: `Pending Number${sequence}`,
      status: "pending",
      custom_data: { shirt: ordinary, allergy: guestAnswer },
      companions: [{ name: `Companion ${sequence}`, custom_data: { diet: ordinary, access: companionAnswer } }],
    },
  });
  return { attendeeId: "", registrationId: registration.id, guestAnswer, companionAnswer, ordinary };
}

type CallInit = { cookie?: string | null; origin?: string | null; eventId?: string };

function call(kind: "registration" | "attendee", id: string, init: CallInit = {}): Promise<Response> {
  const origin = init.origin === undefined ? "http://localhost" : init.origin;
  const cookie = init.cookie === undefined ? cookies.admin : init.cookie;
  const tail = kind === "registration" ? `registrations/${id}/reveal` : `attendees/${id}/reveal-sensitive`;
  return Promise.resolve(
    app.request(`/api/admin/events/${init.eventId ?? EVENT_ID}/${tail}`, {
      method: "POST",
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}) },
    }),
  );
}
const revealRegistration = (id: string, init: CallInit = {}) => call("registration", id, init);
const revealAttendee = (id: string, init: CallInit = {}) => call("attendee", id, init);

/** Both routes, with the id each one takes for a person. */
const ROUTES = [
  ["registration", (p: Person, init: CallInit = {}) => revealRegistration(p.registrationId, init)],
  ["attendee", (p: Person, init: CallInit = {}) => revealAttendee(p.attendeeId, init)],
] as const;

const errorOf = async (res: Response) => ((await res.json()) as { error?: string }).error;

/** The entries of one kind in the event's activity log and the central audit log, as the tables hold them. */
const eventEntries = (where: Prisma.AttendeeActionLogWhereInput = {}) =>
  prisma.attendeeActionLog.findMany({ where: { event_id: EVENT_ID, action_type: ACTION, ...where } });
const centralEntries = () => prisma.adminAuditLog.findMany({ where: { organization_id: ORG_A, action_type: ACTION } });

/** Whether any row of a table holds the text, found by reading each row as text. */
async function tableHolds(table: "AttendeeActionLog" | "AdminAuditLog", text: string): Promise<boolean> {
  // The table name is one of two fixed strings of this test, never request content.
  const [row] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM "${table}" t WHERE t::text LIKE $1`, `%${text}%`);
  return Number(row?.n ?? 0) > 0;
}

/** A transaction that runs `work`, reports it started, and stays open until `commit`. */
function holdOpen<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const hasStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const transaction = prisma.$transaction(
    async (tx) => {
      await work(tx);
      started();
      await released;
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

const waitForALockWaiter = () =>
  vi.waitFor(
    async () => {
      const [row] = await prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*)::bigint AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
      expect(Number(row?.n ?? 0)).toBeGreaterThan(0);
    },
    { timeout: 5000, interval: 25 },
  );

/** Makes a table of the database refuse the insert of one kind of entry, in this worker's schema, until the returned function is called. */
async function refuseEntries(table: "AttendeeActionLog" | "AdminAuditLog"): Promise<() => Promise<void>> {
  // Fixed strings of this test, never request content.
  await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION reveal_entry_refused() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$ LANGUAGE plpgsql`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER reveal_entry_refused BEFORE INSERT ON "${table}" FOR EACH ROW WHEN (NEW.action_type = '${ACTION}') EXECUTE FUNCTION reveal_entry_refused()`);
  return async () => {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS reveal_entry_refused ON "${table}"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS reveal_entry_refused()`);
  };
}

describe.each(ROUTES)("who may show the answers: the %s route", (_kind, reveal) => {
  it.each([
    ["an administrator of the organisation", (): string => cookies.admin],
    ["a superadmin", (): string => cookies.superadmin],
  ])("is open to %s", async (_who, cookie) => {
    const p = await person();
    expect((await reveal(p, { cookie: cookie() })).status).toBe(200);
  });

  it.each([
    ["an operator", (): string => cookies.operator, 403],
    ["an administrator of another organisation", (): string => cookies.otherOrgAdmin, 403],
    ["nobody signed in", (): null => null, 401],
  ] as const)("refuses %s, shows nothing and writes no entry", async (_who, cookie, status) => {
    const p = await person();
    const res = await reveal(p, { cookie: cookie() });

    expect(res.status).toBe(status);
    const text = (await res.text()).toLowerCase();
    expect(text).not.toContain(p.guestAnswer.toLowerCase());
    expect(await eventEntries()).toEqual([]);
    expect(await centralEntries()).toEqual([]);
  });

  it.each([
    ["no Origin or Referer", null],
    ["an Origin of another site", "https://evil.example"],
  ] as const)("refuses a request with %s: the cross-site check answers before anything is read", async (_label, origin) => {
    const p = await person();
    const res = await reveal(p, { origin });

    expect([res.status, await errorOf(res)]).toEqual([403, "forbidden"]);
    expect(await eventEntries()).toEqual([]);
  });
});

describe("what the answer holds", () => {
  it.each(ROUTES)("the %s route returns the sensitive answers of the guest and of the companion, and no ordinary answer", async (_kind, reveal) => {
    const p = await person();

    const res = await reveal(p);

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.json()).toEqual({
      guest: { allergy: p.guestAnswer },
      companions: [{ slot: 1, answers: { access: p.companionAnswer } }],
    });
  });

  it.each(ROUTES)("the %s route returns no ordinary answer and no key without a question, whatever the person's data holds", async (_kind, reveal) => {
    const p = await person();

    const text = JSON.stringify(await (await reveal(p)).json());

    expect(text).not.toContain(p.ordinary);
    expect(text).not.toContain("shirt");
    expect(text).not.toContain("diet");
    expect(text).not.toContain("ghost");
  });

  it.each(ROUTES)("the %s route follows the flag now: a question that stopped being sensitive is not returned, one that became sensitive is", async (_kind, reveal) => {
    const p = await person();
    await prisma.eventCustomField.updateMany({ where: { event_id: EVENT_ID, source_field: "allergy" }, data: { sensitive: false } });
    await prisma.eventCustomField.updateMany({ where: { event_id: EVENT_ID, source_field: "shirt" }, data: { sensitive: true } });
    try {
      expect(await (await reveal(p)).json()).toEqual({
        guest: { shirt: p.ordinary },
        companions: [{ slot: 1, answers: { access: p.companionAnswer } }],
      });
    } finally {
      await prisma.eventCustomField.updateMany({ where: { event_id: EVENT_ID, source_field: "allergy" }, data: { sensitive: true } });
      await prisma.eventCustomField.updateMany({ where: { event_id: EVENT_ID, source_field: "shirt" }, data: { sensitive: false } });
    }
  });

  it.each(ROUTES)("the %s route returns an empty answer for a person with no sensitive answer, and for a guest with no companion", async (_kind, reveal) => {
    const nothing = await person({ sensitive: false });
    expect(await (await reveal(nothing)).json()).toEqual({ guest: {}, companions: [] });

    const alone = await person({ companion: false });
    expect(await (await reveal(alone)).json()).toEqual({ guest: { allergy: alone.guestAnswer }, companions: [] });
  });

  it.each(ROUTES)("the %s route leaves out an answer that is empty", async (_kind, reveal) => {
    const p = await person();
    await prisma.attendee.update({ where: { id: p.attendeeId }, data: { custom_data: { allergy: "   " } } });
    await prisma.registration.update({ where: { id: p.registrationId }, data: { custom_data: { allergy: "   " } } });
    await prisma.attendeeCompanion.updateMany({ where: { attendee_id: p.attendeeId }, data: { custom_data: { access: null } } });
    await prisma.registration.update({ where: { id: p.registrationId }, data: { companions: [{ name: "Companion", custom_data: { access: "" } }] } });

    expect(await (await reveal(p)).json()).toEqual({ guest: {}, companions: [] });
  });

  it("shows the registration's own copy, not the attendee's current answers", async () => {
    const p = await person();
    await prisma.attendee.update({ where: { id: p.attendeeId }, data: { custom_data: { allergy: "changed since" } } });

    expect(await (await revealRegistration(p.registrationId)).json()).toMatchObject({ guest: { allergy: p.guestAnswer } });
    expect(await (await revealAttendee(p.attendeeId)).json()).toMatchObject({ guest: { allergy: "changed since" } });
  });

  it("shows the answers of a registration that waits for a decision", async () => {
    const p = await pendingRegistration();

    expect(await (await revealRegistration(p.registrationId)).json()).toEqual({
      guest: { allergy: p.guestAnswer },
      companions: [{ slot: 1, answers: { access: p.companionAnswer } }],
    });
  });
});

describe("a person that is not there", () => {
  it("answers 404 not_found for a registration of another event or one that does not exist", async () => {
    const p = await person({ eventId: OTHER_EVENT_ID });

    const other = await revealRegistration(p.registrationId);
    const unknown = await revealRegistration("no-such-registration");

    expect([other.status, await errorOf(other), unknown.status, await errorOf(unknown)]).toEqual([404, "not_found", 404, "not_found"]);
    expect(await eventEntries()).toEqual([]);
    expect(await centralEntries()).toEqual([]);
  });

  it("answers 403 for an attendee of another event, as the other routes of an attendee do", async () => {
    const p = await person({ eventId: OTHER_EVENT_ID });

    const res = await revealAttendee(p.attendeeId);

    expect([res.status, await errorOf(res)]).toEqual([403, "forbidden"]);
    expect(await eventEntries()).toEqual([]);
  });

  it("refuses an erased attendee with 409 attendee_erased, shows nothing and writes no entry", async () => {
    const p = await person();
    await prisma.$transaction((tx) => eraseAttendees(tx, { eventId: EVENT_ID, attendeeIds: [p.attendeeId] }));

    const res = await revealAttendee(p.attendeeId);

    expect([res.status, await errorOf(res)]).toEqual([409, "attendee_erased"]);
    expect(await eventEntries()).toEqual([]);
    expect(await centralEntries()).toEqual([]);
  });

  it("answers 404 for the registration of an erased attendee: the erasure deleted it", async () => {
    const p = await person();
    await prisma.$transaction((tx) => eraseAttendees(tx, { eventId: EVENT_ID, attendeeIds: [p.attendeeId] }));

    const res = await revealRegistration(p.registrationId);

    expect([res.status, await errorOf(res)]).toEqual([404, "not_found"]);
    expect(await centralEntries()).toEqual([]);
  });

  it("answers 404 for a registration that staff deleted", async () => {
    const p = await pendingRegistration();
    await prisma.$transaction((tx) =>
      deleteRegistrations(tx, { eventId: EVENT_ID, target: { kind: "ids", ids: [p.registrationId] }, actor: { operator: userIds.admin } }),
    );

    const res = await revealRegistration(p.registrationId);

    expect([res.status, await errorOf(res)]).toEqual([404, "not_found"]);
    expect(await centralEntries()).toEqual([]);
  });

  it("waits for an erasure that is open, and then refuses with 409 attendee_erased without returning the answers", async () => {
    const p = await person();
    const erasure = holdOpen((tx) => eraseAttendees(tx, { eventId: EVENT_ID, attendeeIds: [p.attendeeId] }));
    await erasure.started;
    let finished = false;
    const request = revealAttendee(p.attendeeId).then((res) => {
      finished = true;
      return res;
    });
    await waitForALockWaiter();
    expect(finished).toBe(false);

    await erasure.commit();

    const res = await request;
    expect([res.status, await errorOf(res)]).toEqual([409, "attendee_erased"]);
    expect(await eventEntries()).toEqual([]);
  });

  it("waits for a deletion of the registration that is open, and then answers 404 without returning the answers", async () => {
    const p = await pendingRegistration();
    const deletion = holdOpen((tx) =>
      deleteRegistrations(tx, { eventId: EVENT_ID, target: { kind: "ids", ids: [p.registrationId] }, actor: { operator: userIds.admin } }),
    );
    await deletion.started;
    let finished = false;
    const request = revealRegistration(p.registrationId).then((res) => {
      finished = true;
      return res;
    });
    await waitForALockWaiter();
    expect(finished).toBe(false);

    await deletion.commit();

    const res = await request;
    expect([res.status, await errorOf(res)]).toEqual([404, "not_found"]);
    expect(await centralEntries()).toEqual([]);
  });

  it("waits for the erasure of an accepted registration's attendee that is open, and then answers 404", async () => {
    const p = await person();
    const erasure = holdOpen((tx) => eraseAttendees(tx, { eventId: EVENT_ID, attendeeIds: [p.attendeeId] }));
    await erasure.started;
    let finished = false;
    const request = revealRegistration(p.registrationId).then((res) => {
      finished = true;
      return res;
    });
    await waitForALockWaiter();
    expect(finished).toBe(false);

    await erasure.commit();

    expect((await request).status).toBe(404);
  });
});

describe("an archived event", () => {
  it.each(ROUTES)("the %s route can show the answers of an archived event, and records it", async (_kind, reveal) => {
    const p = await person({ eventId: ARCHIVED_EVENT_ID });
    const res = await reveal(p, { eventId: ARCHIVED_EVENT_ID });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ guest: { allergy: p.guestAnswer } });
    expect(await prisma.attendeeActionLog.count({ where: { event_id: ARCHIVED_EVENT_ID, action_type: ACTION } })).toBe(1);
    expect(await prisma.adminAuditLog.count({ where: { organization_id: ORG_A, action_type: ACTION } })).toBe(1);
  });
});

describe("the entries of the audit logs", () => {
  it("writes, for an attendee, one row in the attendee's activity log and one in the central audit log: the keys and the count, not a value", async () => {
    const p = await person();

    expect((await revealAttendee(p.attendeeId)).status).toBe(200);

    const metadata = { subject: "attendee", attendee_id: p.attendeeId, field_count: 2, fields: ["allergy"], companion_fields: ["access"] };
    expect(await eventEntries({ attendee_id: p.attendeeId })).toEqual([
      expect.objectContaining({ attendee_id: p.attendeeId, actor_user_id: userIds.admin, metadata }),
    ]);
    const central = (await centralEntries()).filter((entry) => (entry.metadata as { attendee_id?: string }).attendee_id === p.attendeeId);
    expect(central).toEqual([
      expect.objectContaining({ actor_user_id: userIds.admin, metadata: { event_id: EVENT_ID, event_title: "Reveal", ...metadata } }),
    ]);
    expect(central[0]?.session_id).toEqual(expect.any(String));
  });

  it("writes, for a registration, one event-level row (no attendee) and one in the central audit log", async () => {
    const p = await person();

    expect((await revealRegistration(p.registrationId, { cookie: cookies.superadmin })).status).toBe(200);

    const metadata = { subject: "registration", registration_id: p.registrationId, field_count: 2, fields: ["allergy"], companion_fields: ["access"] };
    const rows = (await eventEntries()).filter((entry) => (entry.metadata as { registration_id?: string }).registration_id === p.registrationId);
    expect(rows).toEqual([expect.objectContaining({ attendee_id: null, actor_user_id: userIds.superadmin, metadata })]);
    const central = (await centralEntries()).filter((entry) => (entry.metadata as { registration_id?: string }).registration_id === p.registrationId);
    expect(central).toEqual([expect.objectContaining({ actor_user_id: userIds.superadmin, metadata: { event_id: EVENT_ID, event_title: "Reveal", ...metadata } })]);
  });

  it.each(ROUTES)("the %s route writes one entry of each kind for every click, also for a person with no sensitive answer", async (_kind, reveal) => {
    const p = await person({ sensitive: false });

    expect((await reveal(p)).status).toBe(200);
    expect((await reveal(p)).status).toBe(200);

    const subject = _kind === "attendee" ? "attendee" : "registration";
    const mine = (entries: { metadata: unknown }[]) => entries.filter((entry) => (entry.metadata as { subject?: string }).subject === subject);
    const own = mine((await eventEntries()).filter((entry) => JSON.stringify(entry.metadata).includes(p.attendeeId) || JSON.stringify(entry.metadata).includes(p.registrationId)));
    expect(own).toHaveLength(2);
    expect(own[0]?.metadata).toMatchObject({ field_count: 0, fields: [], companion_fields: [] });
    const central = mine((await centralEntries()).filter((entry) => JSON.stringify(entry.metadata).includes(p.attendeeId) || JSON.stringify(entry.metadata).includes(p.registrationId)));
    expect(central).toHaveLength(2);
  });

  it.each(ROUTES)("the %s route puts no answer into an entry, a log line or the response of a refusal", async (_kind, reveal) => {
    const p = await person();
    const answers = [p.guestAnswer, p.companionAnswer, p.ordinary];

    expect((await reveal(p)).status).toBe(200);
    expect((await reveal(p)).status).toBe(200);

    for (const answer of answers) {
      expect(await tableHolds("AttendeeActionLog", answer)).toBe(false);
      expect(await tableHolds("AdminAuditLog", answer)).toBe(false);
      expect(written()).not.toContain(answer.toLowerCase());
    }
  });
});

describe("when an entry cannot be written", () => {
  it.each([
    ["registration", "AdminAuditLog"],
    ["registration", "AttendeeActionLog"],
    ["attendee", "AdminAuditLog"],
    ["attendee", "AttendeeActionLog"],
  ] as const)("the %s route returns no answer and writes no other entry when %s refuses its row", async (kind, table) => {
    const p = await person();
    const restore = await refuseEntries(table);
    let status: number;
    let text: string;
    try {
      const res = await (kind === "registration" ? revealRegistration(p.registrationId) : revealAttendee(p.attendeeId));
      status = res.status;
      text = (await res.text()).toLowerCase();
    } finally {
      await restore();
    }

    expect(status).toBe(500);
    for (const answer of [p.guestAnswer, p.companionAnswer]) {
      expect(text).not.toContain(answer.toLowerCase());
      expect(written()).not.toContain(answer.toLowerCase());
    }
    expect(await eventEntries()).toEqual([]);
    expect(await centralEntries()).toEqual([]);
  });
});

describe("the budget of a user: admin:sensitive-reveal", () => {
  it("allows 20 a minute across both routes, and then answers 429 sensitive_reveal_limit with Retry-After", async () => {
    const p = await person();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 20; attempt += 1) {
      statuses.push((attempt % 2 === 0 ? await revealAttendee(p.attendeeId) : await revealRegistration(p.registrationId)).status);
    }
    expect(statuses).toEqual(Array.from({ length: 20 }, () => 200));

    for (const reveal of [revealAttendee(p.attendeeId), revealRegistration(p.registrationId)]) {
      const limited = await reveal;
      expect([limited.status, await errorOf(limited), limited.headers.get("retry-after")]).toEqual([429, "sensitive_reveal_limit", "60"]);
    }
    // Refused clicks are not clicks that showed anything: only the 20 are in the logs.
    expect(await eventEntries()).toHaveLength(20);
    expect(await centralEntries()).toHaveLength(20);
  });

  it("is a budget of each user: another administrator is not held up by it", async () => {
    const p = await person();
    for (let attempt = 0; attempt < 21; attempt += 1) await revealAttendee(p.attendeeId);

    expect((await revealAttendee(p.attendeeId)).status).toBe(429);
    expect((await revealAttendee(p.attendeeId, { cookie: cookies.secondAdmin })).status).toBe(200);
  });

  it("allows 200 an hour, and then answers 429 with an hour in Retry-After", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date() });
    try {
      for (let batch = 0; batch < 10; batch += 1) {
        for (let attempt = 0; attempt < 20; attempt += 1) expect((await revealRegistration("no-such-registration")).status).toBe(404);
        vi.setSystemTime(Date.now() + 61_000);
      }

      const limited = await revealRegistration("no-such-registration");

      expect([limited.status, await errorOf(limited), limited.headers.get("retry-after")]).toEqual([429, "sensitive_reveal_limit", "3600"]);
    } finally {
      vi.useRealTimers();
    }
  }, 120_000);
});
