/**
 * The staff routes of a guest's companion (D-E5), against a real database and the real app: `PATCH` corrects the name and
 * the answers, `DELETE` removes the companion, the seat and the copy in the guest's registration with it. Who may use them
 * (an administrator of the organisation and a superadmin, never an operator or another organisation), the CSRF guard, the
 * archived event, an attendee who was erased, what the boundary of a registrant refuses, an erasure that is open, the
 * entries of the audit logs (ids and counts, never the person) and that nothing of the person is written to a log or an
 * answer, also when the request fails.
 */
import { randomUUID } from "node:crypto";
import { inspect } from "node:util";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma, PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";
import { countSeatsInUse, ERASED_COMPANION_NAME, eraseAttendees } from "@admitto/tickets";
import { subscribe } from "../../src/admin/sse-channel.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { enrollConfirmedTotp } from "../helpers/enroll-confirmed-totp.js";
import { sessionCookieFor } from "../helpers/session-cookie.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");

const ORG_A = "org-companion-staff-a";
const ORG_B = "org-companion-staff-b";
const EVENT_ID = "evt-companion-staff";
const OTHER_EVENT_ID = "evt-companion-staff-other";
const ARCHIVED_EVENT_ID = "evt-companion-staff-archived";
const EVENT_IDS = [EVENT_ID, OTHER_EVENT_ID, ARCHIVED_EVENT_ID];
const EMAILS = {
  admin: "companion-staff-admin@example.com",
  superadmin: "companion-staff-super@example.com",
  operator: "companion-staff-operator@example.com",
  otherOrgAdmin: "companion-staff-other-admin@example.com",
};

let prisma: PrismaClient;
let app: ReturnType<typeof buildTestApp>;
const cookies = { admin: "", superadmin: "", operator: "", otherOrgAdmin: "" };
let sequence = 0;

async function wipeAll(client: PrismaClient): Promise<void> {
  await client.attendee.deleteMany({ where: { event_id: { in: EVENT_IDS } } });
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
      { id: ORG_A, name: "Companion Staff Org A", slug: "companion-staff-org-a" },
      { id: ORG_B, name: "Companion Staff Org B", slug: "companion-staff-org-b" },
    ],
  });
  await prisma.event.createMany({
    data: [
      { id: EVENT_ID, title: "Companion Staff", slug: "companion-staff", date: new Date("2030-10-01"), organization_id: ORG_A, capacity: 10 },
      { id: OTHER_EVENT_ID, title: "Companion Staff Other", slug: "companion-staff-other", date: new Date("2030-10-02"), organization_id: ORG_A, capacity: 10 },
      {
        id: ARCHIVED_EVENT_ID,
        title: "Companion Staff Archived",
        slug: "companion-staff-archived",
        date: new Date("2030-10-03"),
        archived_at: new Date("2030-10-04"),
        organization_id: ORG_A,
        capacity: 10,
      },
    ],
  });
  // Two questions about a companion (one off the registration form, which staff answer all the same) and one about the guest.
  for (const eventId of EVENT_IDS) {
    await prisma.eventCustomField.createMany({
      data: [
        { event_id: eventId, source_field: "diet", label: "Diet", type: "select", options: ["vegan", "none"], applies_to: "companion", show_on_form: true },
        { event_id: eventId, source_field: "plate", label: "Plate", type: "text", applies_to: "companion", show_on_form: false },
        { event_id: eventId, source_field: "shirt", label: "Shirt", type: "text", show_on_form: true },
      ],
    });
  }
  const [admin, superadmin, operator, otherOrgAdmin] = await Promise.all(Object.values(EMAILS).map((email) => prisma.user.create({ data: { email } })));
  await prisma.roleAssignment.createMany({
    data: [
      { user_id: admin!.id, role: "admin", scope_type: "organization", scope_id: ORG_A },
      { user_id: superadmin!.id, role: "superadmin", scope_type: "instance", scope_id: null },
      { user_id: operator!.id, role: "operator", scope_type: "event", scope_id: EVENT_ID },
      { user_id: otherOrgAdmin!.id, role: "admin", scope_type: "organization", scope_id: ORG_B },
    ],
  });
  for (const user of [admin!, superadmin!, operator!, otherOrgAdmin!]) await enrollConfirmedTotp(prisma, user.id);
  cookies.admin = await sessionCookieFor(prisma, admin!.id);
  cookies.superadmin = await sessionCookieFor(prisma, superadmin!.id);
  cookies.operator = await sessionCookieFor(prisma, operator!.id);
  cookies.otherOrgAdmin = await sessionCookieFor(prisma, otherOrgAdmin!.id);
});

beforeEach(() => {
  resetSystemLogBufferForTest();
  app = buildTestApp({ prisma, checkinToken: "companion-staff-checkin-token-32!!", adminDistRoot });
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

type Guest = { id: string; email: string; marker: string; registrationId: string | null };

/** An attendee with a companion who has a name and an answer that hold `marker`, and the registration they were accepted from. */
async function guestWithCompanion(
  options: { marker?: string; eventId?: string; status?: string; companion?: boolean; registration?: boolean } = {},
): Promise<Guest> {
  sequence += 1;
  const marker = options.marker ?? uniqueMarker();
  const eventId = options.eventId ?? EVENT_ID;
  const email = `companion-staff-${sequence}@example.com`;
  const attendee = await prisma.attendee.create({
    data: {
      event_id: eventId,
      email,
      name: `Guest ${sequence}`,
      first_name: "Guest",
      last_name: `Number${sequence}`,
      status: options.status ?? "registered",
      ...(options.companion === false ? {} : { companions: { create: { slot: 1, name: `Companion ${marker}`, custom_data: { diet: "none", plate: `WA ${marker}` } } } }),
    },
  });
  let registrationId: string | null = null;
  if (options.registration !== false) {
    const registration = await prisma.registration.create({
      data: {
        event_id: eventId,
        email,
        first_name: "Guest",
        last_name: `Number${sequence}`,
        name: `Guest Number${sequence}`,
        status: "accepted",
        attendee_id: attendee.id,
        companions: options.companion === false ? [] : [{ name: `Companion ${marker}`, custom_data: { diet: "none" } }],
      },
    });
    registrationId = registration.id;
  }
  return { id: attendee.id, email, marker, registrationId };
}

type CallInit = {
  cookie?: string | null;
  /** The Origin header; left out = the page's own origin, `null` = none at all. */
  origin?: string | null;
  body?: unknown;
  rawBody?: string;
  eventId?: string;
};

function call(method: "PATCH" | "DELETE", attendeeId: string, init: CallInit = {}): Promise<Response> {
  const origin = init.origin === undefined ? "http://localhost" : init.origin;
  const cookie = init.cookie === undefined ? cookies.admin : init.cookie;
  const sentBody = "body" in init ? init.body : { name: "New Name", custom_data: { diet: "vegan" } };
  return Promise.resolve(
    app.request(`/api/admin/events/${init.eventId ?? EVENT_ID}/attendees/${attendeeId}/companion`, {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(origin ? { Origin: origin } : {}),
        ...(method === "PATCH" ? { "Content-Type": "application/json" } : {}),
      },
      ...(method === "PATCH" ? { body: init.rawBody ?? JSON.stringify(sentBody) } : {}),
    }),
  );
}
const patch = (attendeeId: string, init: CallInit = {}) => call("PATCH", attendeeId, init);
const remove = (attendeeId: string, init: CallInit = {}) => call("DELETE", attendeeId, init);

const companionOf = (attendeeId: string) => prisma.attendeeCompanion.findFirst({ where: { attendee_id: attendeeId, slot: 1 } });
const copyOf = async (registrationId: string | null) => (await prisma.registration.findUniqueOrThrow({ where: { id: registrationId! } })).companions;
const seats = () => countSeatsInUse(prisma, EVENT_ID);
const errorOf = async (res: Response) => {
  const body = (await res.json()) as { error?: string; code?: string };
  return body.error ?? body.code;
};

/** The tables of the database that hold the marker in any column, found by reading each row as text. */
async function tablesHolding(marker: string): Promise<string[]> {
  const tables = await prisma.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'`;
  const holding: string[] = [];
  for (const { table_name } of tables) {
    // A table name read from the catalog, never request content.
    const [row] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM "${table_name}" t WHERE t::text LIKE $1`, `%${marker}%`);
    if (Number(row?.n ?? 0) > 0) holding.push(table_name);
  }
  holding.sort();
  return holding;
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

describe("PATCH /api/admin/events/:eventId/attendees/:id/companion", () => {
  it("corrects the name and the answers, those off the registration form included, and answers with the attendee's detail", async () => {
    const guest = await guestWithCompanion();
    const before = await seats();

    const res = await patch(guest.id, { body: { name: "  Anna Companion  ", custom_data: { diet: "vegan", plate: "WA 12345" } } });

    expect(res.status).toBe(200);
    const detail = (await res.json()) as { id: string; companion: unknown };
    expect(detail.id).toBe(guest.id);
    expect(detail.companion).toEqual({ slot: 1, name: "Anna Companion", custom_data: { diet: "vegan", plate: "WA 12345" } });
    expect(await companionOf(guest.id)).toMatchObject({ name: "Anna Companion", custom_data: { diet: "vegan", plate: "WA 12345" } });
    // It corrects a companion that is there and takes no seat.
    expect(await seats()).toBe(before);
  });

  it("clears the answers it is given none of, and takes the same body as the registration form for them", async () => {
    const guest = await guestWithCompanion();

    expect((await patch(guest.id, { body: { name: "Only A Name" } })).status).toBe(200);
    expect((await companionOf(guest.id))?.custom_data).toBeNull();

    expect((await patch(guest.id, { body: { name: "Only A Name", custom_data: { diet: "", plate: "   " } } })).status).toBe(200);
    expect((await companionOf(guest.id))?.custom_data).toBeNull();
  });

  it("reads the keys of the questions about a companion only: a question about the guest, an unknown key and __proto__ are left out", async () => {
    const guest = await guestWithCompanion();
    const hostile = JSON.parse('{"diet": "vegan", "shirt": "L", "unknown": "x", "company": "Example Corp", "__proto__": {"plate": "polluted"}}') as unknown;

    const res = await patch(guest.id, { body: { name: "Anna Companion", custom_data: hostile } });

    expect(res.status).toBe(200);
    const row = await companionOf(guest.id);
    expect(row?.custom_data).toEqual({ diet: "vegan" });
    expect(Object.keys(row?.custom_data as object)).toEqual(["diet"]);
    expect(({} as Record<string, unknown>).plate).toBeUndefined();
  });

  it("leaves the copy in the guest's registration as the guest sent it, and changes nothing of the guest", async () => {
    const guest = await guestWithCompanion();
    const registrationBefore = await prisma.registration.findUniqueOrThrow({ where: { id: guest.registrationId! } });
    const attendeeBefore = await prisma.attendee.findUniqueOrThrow({ where: { id: guest.id } });

    expect((await patch(guest.id)).status).toBe(200);

    expect(await prisma.registration.findUniqueOrThrow({ where: { id: guest.registrationId! } })).toEqual(registrationBefore);
    expect(await prisma.attendee.findUniqueOrThrow({ where: { id: guest.id } })).toEqual(attendeeBefore);
  });

  it("writes one entry to the attendee's activity log and one to the central audit log: the ids and the slot, and nothing of the person", async () => {
    const guest = await guestWithCompanion();
    const marker = uniqueMarker();

    expect((await patch(guest.id, { body: { name: `Anna ${marker}`, custom_data: { diet: "vegan", plate: `WA ${marker}` } } })).status).toBe(200);

    const logs = await prisma.attendeeActionLog.findMany({ where: { event_id: EVENT_ID, attendee_id: guest.id, action_type: "attendee_companion_updated" } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ metadata: { slot: 1 }, actor_user_id: expect.any(String) });
    const audit = await prisma.adminAuditLog.findMany({ where: { organization_id: ORG_A, action_type: "attendee_companion_updated" } });
    expect(audit.filter((entry) => (entry.metadata as { attendee_id?: string }).attendee_id === guest.id)).toEqual([
      expect.objectContaining({ metadata: { event_id: EVENT_ID, event_title: "Companion Staff", attendee_id: guest.id, slot: 1 } }),
    ]);
    expect(await tablesHolding(marker)).toEqual(["AttendeeCompanion"]);
    expect(written()).not.toContain(marker.toLowerCase());
  });

  it("is open to an administrator of the organisation and to a superadmin", async () => {
    for (const cookie of [cookies.admin, cookies.superadmin]) {
      const guest = await guestWithCompanion();
      expect((await patch(guest.id, { cookie, body: { name: "By Staff" } })).status).toBe(200);
      expect((await companionOf(guest.id))?.name).toBe("By Staff");
    }
  });

  it.each([
    ["an operator", (): string => cookies.operator, 403],
    ["an administrator of another organisation", (): string => cookies.otherOrgAdmin, 403],
    ["nobody signed in", (): null => null, 401],
  ] as const)("refuses %s, and changes nothing", async (_who, cookie, status) => {
    const guest = await guestWithCompanion();
    const before = await companionOf(guest.id);

    const res = await patch(guest.id, { cookie: cookie(), body: { name: "Not Allowed" } });

    expect(res.status).toBe(status);
    expect(await companionOf(guest.id)).toEqual(before);
    expect(await prisma.attendeeActionLog.count({ where: { attendee_id: guest.id } })).toBe(0);
  });

  it.each([
    ["no Origin or Referer", null],
    ["an Origin of another site", "https://evil.example"],
  ] as const)("refuses a request with %s: the CSRF guard answers before anything else is read", async (_label, origin) => {
    const guest = await guestWithCompanion();
    const before = await companionOf(guest.id);

    const res = await patch(guest.id, { origin });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    expect(await companionOf(guest.id)).toEqual(before);
  });

  it("refuses an archived event with 403 event_archived, and changes nothing", async () => {
    const guest = await guestWithCompanion({ eventId: ARCHIVED_EVENT_ID });
    const before = await companionOf(guest.id);

    const res = await patch(guest.id, { eventId: ARCHIVED_EVENT_ID });

    expect([res.status, await res.json()]).toEqual([403, { code: "event_archived" }]);
    expect(await companionOf(guest.id)).toEqual(before);
  });

  it("refuses an attendee who was erased with 409 attendee_erased, and leaves the companion as the erasure left it", async () => {
    const guest = await guestWithCompanion();
    await prisma.$transaction((tx) => eraseAttendees(tx, { eventId: EVENT_ID, attendeeIds: [guest.id] }));

    const res = await patch(guest.id, { body: { name: "Too Late" } });

    expect([res.status, await res.json()]).toEqual([409, { error: "attendee_erased" }]);
    expect(await companionOf(guest.id)).toMatchObject({ name: ERASED_COMPANION_NAME, custom_data: null });
  });

  it("refuses an id that is no attendee, and an attendee of another event, with 403", async () => {
    const elsewhere = await guestWithCompanion({ eventId: OTHER_EVENT_ID });

    expect((await patch("no-such-attendee")).status).toBe(403);
    expect((await patch(elsewhere.id)).status).toBe(403);
    expect((await companionOf(elsewhere.id))?.name).toBe(`Companion ${elsewhere.marker}`);
  });

  it("finds no companion to correct when the attendee has none, never adds one, and takes no seat", async () => {
    const guest = await guestWithCompanion({ companion: false });
    const before = await seats();

    const res = await patch(guest.id, { body: { name: "Not Added" } });

    expect([res.status, await res.json()]).toEqual([404, { error: "companion_not_found" }]);
    expect(await prisma.attendeeCompanion.count({ where: { attendee_id: guest.id } })).toBe(0);
    expect(await seats()).toBe(before);
  });

  const hostileName = (mark: number) => `Evil${String.fromCodePoint(mark)}Name`;

  it.each([
    ["not JSON", { rawBody: "{ not json" }, "invalid json"],
    ["an array", { body: [] }, "validation_failed"],
    ["a string", { body: "Anna" }, "validation_failed"],
    ["null", { body: null }, "validation_failed"],
    ["without a name", { body: { custom_data: { diet: "vegan" } } }, "validation_failed"],
    ["with a name that is not text", { body: { name: 42 } }, "validation_failed"],
    ["with a key it does not take", { body: { name: "Anna", slot: 2 } }, "validation_failed"],
    ["with the attendee's own fields", { body: { name: "Anna", email: "other@example.com" } }, "validation_failed"],
    ["with an empty name", { body: { name: "" } }, "validation_failed"],
    ["with a blank name", { body: { name: "   " } }, "validation_failed"],
    ["with a name that is an address", { body: { name: "someone@example.com" } }, "validation_failed"],
    ["with a name that is a link", { body: { name: "https://example.com/offer" } }, "validation_failed"],
    ["with a name that is a scheme without slashes", { body: { name: "mailto:someone" } }, "validation_failed"],
    ["with a name that is too long", { body: { name: "x".repeat(101) } }, "validation_failed"],
    ["with a name with a bidirectional control", { body: { name: hostileName(0x202e) } }, "validation_failed"],
    ["with a name with a zero-width character", { body: { name: hostileName(0x200b) } }, "validation_failed"],
    ["with answers that are a list", { body: { name: "Anna", custom_data: ["vegan"] } }, "validation_failed"],
    ["with answers that are text", { body: { name: "Anna", custom_data: "vegan" } }, "validation_failed"],
    ["with an answer that is not one of the options", { body: { name: "Anna", custom_data: { diet: "pizza" } } }, "validation_failed"],
    ["with an answer that is not text", { body: { name: "Anna", custom_data: { plate: 5 } } }, "validation_failed"],
    ["with an answer that is too long", { body: { name: "Anna", custom_data: { plate: "x".repeat(101) } } }, "validation_failed"],
    ["with an answer with a bidirectional control", { body: { name: "Anna", custom_data: { plate: hostileName(0x202e) } } }, "validation_failed"],
    [
      "with more answers than an event may have questions",
      { body: { name: "Anna", custom_data: Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`key_${index}`, "x"])) } },
      "validation_failed",
    ],
  ] as const)("refuses a body %s with 400 and a fixed code, and changes nothing", async (_label, init, code) => {
    const guest = await guestWithCompanion();
    const before = await companionOf(guest.id);

    const res = await patch(guest.id, init);

    expect([res.status, await errorOf(res)]).toEqual([400, code]);
    expect(await companionOf(guest.id)).toEqual(before);
    expect(await prisma.attendeeActionLog.count({ where: { attendee_id: guest.id } })).toBe(0);
  });

  it("refuses a body that leaves a required question about the companion unanswered", async () => {
    const required = await prisma.eventCustomField.create({
      data: { event_id: EVENT_ID, source_field: "badge", label: "Badge name", type: "text", required: true, applies_to: "companion", show_on_form: true },
    });
    try {
      const guest = await guestWithCompanion();
      const before = await companionOf(guest.id);

      expect((await patch(guest.id, { body: { name: "Anna", custom_data: { diet: "vegan" } } })).status).toBe(400);
      expect(await companionOf(guest.id)).toEqual(before);
      expect((await patch(guest.id, { body: { name: "Anna", custom_data: { badge: "Anna" } } })).status).toBe(200);
    } finally {
      await prisma.eventCustomField.delete({ where: { id: required.id } });
    }
  });

  it("does not echo the name or an answer of a refused request, writes none of it to a log, and stores none of it", async () => {
    const guest = await guestWithCompanion();
    const marker = uniqueMarker();

    const res = await patch(guest.id, { body: { name: `https://${marker}.example/offer`, custom_data: { diet: `pizza ${marker}`, plate: `WA ${marker}` } } });

    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).not.toContain(marker.toLowerCase());
    expect(written()).not.toContain(marker.toLowerCase());
    expect(await tablesHolding(marker)).toEqual([]);
  });

  it("waits for an erasure that is open, and then answers 409 attendee_erased without writing the name into the emptied row", async () => {
    const guest = await guestWithCompanion();
    const erasure = holdOpen((tx) => eraseAttendees(tx, { eventId: EVENT_ID, attendeeIds: [guest.id] }));
    await erasure.started;
    let finished = false;
    const request = patch(guest.id, { body: { name: "Late Edit", custom_data: { diet: "vegan" } } }).then((res) => {
      finished = true;
      return res;
    });
    await waitForALockWaiter();
    expect(finished).toBe(false);

    await erasure.commit();

    const res = await request;
    expect([res.status, await res.json()]).toEqual([409, { error: "attendee_erased" }]);
    expect(await companionOf(guest.id)).toMatchObject({ name: ERASED_COMPANION_NAME, custom_data: null });
  });

  it("limits the edits of one attendee to the budget of editing the attendee: 20 a minute, and then 429", async () => {
    const guest = await guestWithCompanion({ companion: false });
    const answers: number[] = [];
    for (let attempt = 0; attempt < 21; attempt += 1) answers.push((await patch(guest.id)).status);

    expect(answers.slice(0, 20)).toEqual(Array.from({ length: 20 }, () => 404));
    expect(answers[20]).toBe(429);
  });
});

describe("DELETE /api/admin/events/:eventId/attendees/:id/companion", () => {
  it("removes the companion: the row, the copy in the registration, and the seat with them", async () => {
    const guest = await guestWithCompanion();
    expect(await seats()).toBeGreaterThanOrEqual(2);
    const before = await seats();

    const res = await remove(guest.id);

    expect(res.status).toBe(200);
    expect(((await res.json()) as { id: string; companion: unknown })).toMatchObject({ id: guest.id, companion: null });
    expect(await companionOf(guest.id)).toBeNull();
    expect(await copyOf(guest.registrationId)).toEqual([]);
    expect(await seats()).toBe(before - 1);
  });

  it("takes the name and the answers out of every table of the database", async () => {
    const guest = await guestWithCompanion();
    expect(await tablesHolding(guest.marker)).toEqual(["AttendeeCompanion", "Registration"]);

    expect((await remove(guest.id)).status).toBe(200);

    expect(await tablesHolding(guest.marker)).toEqual([]);
  });

  it("leaves the guest, the guest's registration and every other guest's companion as they are", async () => {
    const guest = await guestWithCompanion();
    const other = await guestWithCompanion();
    const guestBefore = await prisma.attendee.findUniqueOrThrow({ where: { id: guest.id } });
    const registrationBefore = await prisma.registration.findUniqueOrThrow({ where: { id: guest.registrationId! } });

    expect((await remove(guest.id)).status).toBe(200);

    expect(await prisma.attendee.findUniqueOrThrow({ where: { id: guest.id } })).toEqual(guestBefore);
    expect(await prisma.registration.findUniqueOrThrow({ where: { id: guest.registrationId! } })).toEqual({ ...registrationBefore, companions: [], updated_at: expect.any(Date) });
    expect(await companionOf(other.id)).not.toBeNull();
    expect(await copyOf(other.registrationId)).toHaveLength(1);
  });

  it("removes the companion of an attendee who has no registration (added by hand or imported)", async () => {
    const guest = await guestWithCompanion({ registration: false });

    expect((await remove(guest.id)).status).toBe(200);

    expect(await companionOf(guest.id)).toBeNull();
  });

  it("writes one entry to the attendee's activity log and one to the central audit log: the ids, the slot and the seat freed, never the person", async () => {
    const guest = await guestWithCompanion();

    expect((await remove(guest.id)).status).toBe(200);

    const logs = await prisma.attendeeActionLog.findMany({ where: { event_id: EVENT_ID, attendee_id: guest.id, action_type: "attendee_companion_removed" } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ metadata: { slot: 1, seats_freed: 1 } });
    const audit = await prisma.adminAuditLog.findMany({ where: { organization_id: ORG_A, action_type: "attendee_companion_removed" } });
    expect(audit.filter((entry) => (entry.metadata as { attendee_id?: string }).attendee_id === guest.id)).toEqual([
      expect.objectContaining({ metadata: { event_id: EVENT_ID, event_title: "Companion Staff", attendee_id: guest.id, slot: 1, seats_freed: 1 } }),
    ]);
    expect(await tablesHolding(guest.marker)).toEqual([]);
    expect(written()).not.toContain(guest.marker.toLowerCase());
  });

  it("frees the seat for the next guest: the Overview of the event counts it", async () => {
    const guest = await guestWithCompanion();
    const overview = async () => {
      const res = await app.request(`/api/admin/events/${EVENT_ID}/overview`, { headers: { Cookie: cookies.admin } });
      expect(res.status).toBe(200);
      return ((await res.json()) as { seats_in_use: number }).seats_in_use;
    };
    const before = await overview();

    expect((await remove(guest.id)).status).toBe(200);

    expect(await overview()).toBe(before - 1);
  });

  it("tells the open screens of the event that a seat is free again, and an edit does not", async () => {
    const received: unknown[] = [];
    const unsubscribe = subscribe(EVENT_ID, (event) => received.push(event));
    try {
      const guest = await guestWithCompanion();
      expect((await patch(guest.id)).status).toBe(200);
      expect(received).toEqual([]);

      expect((await remove(guest.id)).status).toBe(200);

      expect(received).toEqual([{ type: "activity_changed" }]);
    } finally {
      unsubscribe();
    }
  });

  it("answers 404 companion_not_found the second time: the removal is done once", async () => {
    const guest = await guestWithCompanion();
    expect((await remove(guest.id)).status).toBe(200);

    const again = await remove(guest.id);

    expect([again.status, await again.json()]).toEqual([404, { error: "companion_not_found" }]);
  });

  it("is open to an administrator of the organisation and to a superadmin", async () => {
    for (const cookie of [cookies.admin, cookies.superadmin]) {
      const guest = await guestWithCompanion();
      expect((await remove(guest.id, { cookie })).status).toBe(200);
      expect(await companionOf(guest.id)).toBeNull();
    }
  });

  it.each([
    ["an operator", (): string => cookies.operator, 403],
    ["an administrator of another organisation", (): string => cookies.otherOrgAdmin, 403],
    ["nobody signed in", (): null => null, 401],
  ] as const)("refuses %s, and removes nothing", async (_who, cookie, status) => {
    const guest = await guestWithCompanion();

    const res = await remove(guest.id, { cookie: cookie() });

    expect(res.status).toBe(status);
    expect(await companionOf(guest.id)).not.toBeNull();
    expect(await copyOf(guest.registrationId)).toHaveLength(1);
  });

  it.each([
    ["no Origin or Referer", null],
    ["an Origin of another site", "https://evil.example"],
  ] as const)("refuses a request with %s, and removes nothing", async (_label, origin) => {
    const guest = await guestWithCompanion();

    const res = await remove(guest.id, { origin });

    expect([res.status, await res.json()]).toEqual([403, { error: "forbidden" }]);
    expect(await companionOf(guest.id)).not.toBeNull();
  });

  it("refuses an archived event with 403 event_archived, and removes nothing", async () => {
    const guest = await guestWithCompanion({ eventId: ARCHIVED_EVENT_ID });

    const res = await remove(guest.id, { eventId: ARCHIVED_EVENT_ID });

    expect([res.status, await res.json()]).toEqual([403, { code: "event_archived" }]);
    expect(await companionOf(guest.id)).not.toBeNull();
    expect(await copyOf(guest.registrationId)).toHaveLength(1);
  });

  it("refuses an attendee who was erased with 409 attendee_erased", async () => {
    const guest = await guestWithCompanion();
    await prisma.$transaction((tx) => eraseAttendees(tx, { eventId: EVENT_ID, attendeeIds: [guest.id] }));

    const res = await remove(guest.id);

    expect([res.status, await res.json()]).toEqual([409, { error: "attendee_erased" }]);
    expect(await companionOf(guest.id)).toMatchObject({ name: ERASED_COMPANION_NAME });
  });

  it("refuses an id that is no attendee, and an attendee of another event, with 403", async () => {
    const elsewhere = await guestWithCompanion({ eventId: OTHER_EVENT_ID });

    expect((await remove("no-such-attendee")).status).toBe(403);
    expect((await remove(elsewhere.id)).status).toBe(403);
    expect(await companionOf(elsewhere.id)).not.toBeNull();
  });

  it("finds no companion to remove when the attendee has none", async () => {
    const guest = await guestWithCompanion({ companion: false });

    const res = await remove(guest.id);

    expect([res.status, await res.json()]).toEqual([404, { error: "companion_not_found" }]);
  });

  it("waits behind an erasure that is open, at the registration queue, and then answers 409 attendee_erased", async () => {
    const guest = await guestWithCompanion();
    const erasure = holdOpen((tx) => eraseAttendees(tx, { eventId: EVENT_ID, attendeeIds: [guest.id] }));
    await erasure.started;
    let finished = false;
    const request = remove(guest.id).then((res) => {
      finished = true;
      return res;
    });
    await waitForALockWaiter();
    expect(finished).toBe(false);

    await erasure.commit();

    const res = await request;
    expect([res.status, await res.json()]).toEqual([409, { error: "attendee_erased" }]);
    expect(await prisma.registration.count({ where: { id: guest.registrationId! } })).toBe(0);
    expect(await tablesHolding(guest.marker)).toEqual([]);
  });
});

/** Makes the central audit log refuse the entry of one kind of change, in this worker's schema, until the returned function is called. */
async function refuseAuditEntries(actionType: string): Promise<() => Promise<void>> {
  // Fixed strings of this test, never request content.
  await prisma.$executeRawUnsafe(
    `CREATE OR REPLACE FUNCTION companion_audit_refused() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$ LANGUAGE plpgsql`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE TRIGGER companion_audit_refused BEFORE INSERT ON "AdminAuditLog" FOR EACH ROW WHEN (NEW.action_type = '${actionType}') EXECUTE FUNCTION companion_audit_refused()`,
  );
  return async () => {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS companion_audit_refused ON "AdminAuditLog"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS companion_audit_refused()`);
  };
}

describe("when the entry of the audit log cannot be written", () => {
  it("changes nothing on an edit, answers 500 without a word of the person, and logs none of it", async () => {
    const guest = await guestWithCompanion();
    const marker = uniqueMarker();
    const before = await companionOf(guest.id);
    const restore = await refuseAuditEntries("attendee_companion_updated");
    try {
      const res = await patch(guest.id, { body: { name: `Anna ${marker}`, custom_data: { diet: "vegan", plate: `WA ${marker}` } } });

      expect(res.status).toBe(500);
      expect((await res.text()).toLowerCase()).not.toContain(marker.toLowerCase());
    } finally {
      await restore();
    }
    expect(await companionOf(guest.id)).toEqual(before);
    expect(await prisma.attendeeActionLog.count({ where: { attendee_id: guest.id } })).toBe(0);
    expect(written()).not.toContain(marker.toLowerCase());
    expect(await tablesHolding(marker)).toEqual([]);
  });

  it("removes nothing on a removal: the row, the copy and the seat all stay", async () => {
    const guest = await guestWithCompanion();
    const before = await seats();
    const restore = await refuseAuditEntries("attendee_companion_removed");
    try {
      const res = await remove(guest.id);

      expect(res.status).toBe(500);
      expect((await res.text()).toLowerCase()).not.toContain(guest.marker.toLowerCase());
    } finally {
      await restore();
    }
    expect(await companionOf(guest.id)).not.toBeNull();
    expect(await copyOf(guest.registrationId)).toHaveLength(1);
    expect(await seats()).toBe(before);
    expect(written()).not.toContain(guest.marker.toLowerCase());
  });
});

describe("GET /api/admin/events/:eventId/attendees/:id carries the companion", () => {
  const detailOf = async (attendeeId: string) => {
    const res = await app.request(`/api/admin/events/${EVENT_ID}/attendees/${attendeeId}`, { headers: { Cookie: cookies.admin } });
    expect(res.status).toBe(200);
    return (await res.json()) as { companion: unknown };
  };

  it("shows the name and the answers of the companion", async () => {
    const guest = await guestWithCompanion();
    expect((await detailOf(guest.id)).companion).toEqual({
      slot: 1,
      name: `Companion ${guest.marker}`,
      custom_data: { diet: "none", plate: `WA ${guest.marker}` },
    });
  });

  it("shows no companion for an attendee who has none, and none for one who was erased", async () => {
    const alone = await guestWithCompanion({ companion: false });
    expect((await detailOf(alone.id)).companion).toBeNull();

    const erased = await guestWithCompanion();
    await prisma.$transaction((tx) => eraseAttendees(tx, { eventId: EVENT_ID, attendeeIds: [erased.id] }));
    const detail = await detailOf(erased.id);
    expect(detail.companion).toBeNull();
    expect(JSON.stringify(detail)).not.toContain(ERASED_COMPANION_NAME);
  });

  it("shows the answers that are text, key to text, and none for a companion whose answers are empty", async () => {
    const guest = await guestWithCompanion();
    await prisma.attendeeCompanion.updateMany({ where: { attendee_id: guest.id }, data: { custom_data: { diet: "vegan", odd: 5, empty: null } } });
    expect((await detailOf(guest.id)).companion).toMatchObject({ custom_data: { diet: "vegan" } });

    await prisma.attendeeCompanion.updateMany({ where: { attendee_id: guest.id }, data: { custom_data: { odd: 5 } } });
    expect((await detailOf(guest.id)).companion).toMatchObject({ custom_data: null });
  });
});
