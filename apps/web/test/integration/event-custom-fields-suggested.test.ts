import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { MAX_CUSTOM_FIELDS_PER_EVENT, SUGGESTED_EVENT_FIELDS } from "@admitto/shared";
import type { AddSuggestedFieldsDto } from "../../src/admin/event-custom-fields-routes.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { enrollConfirmedTotp } from "../helpers/enroll-confirmed-totp.js";
import { sessionCookieFor } from "../helpers/session-cookie.js";

/**
 * "Add suggested questions": the route that gives an event the parking, travel and accommodation questions on request, against a real
 * database through the real app. Who may call it, that it adds what the set says and nothing the organiser changed, that it is
 * idempotent, that it is all or nothing at the cap on fields, that two requests at once cannot add a question twice, and that what it
 * writes is what "Add field" would have written for the same question.
 */
const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };

const ORG_A = "org-fldsug-a";
const ORG_B = "org-fldsug-b";
const EVENT_A = "evt-fldsug-a";
const EVENT_B = "evt-fldsug-b";
const EVENT_ARCHIVED = "evt-fldsug-archived";
const EVENT_BY_HAND = "evt-fldsug-by-hand";
const EVENT_IDS = [EVENT_A, EVENT_B, EVENT_ARCHIVED, EVENT_BY_HAND];

const EMAILS = {
  adminA: "fldsug-admin-a@example.com",
  adminB: "fldsug-admin-b@example.com",
  operator: "fldsug-operator@example.com",
  superadmin: "fldsug-super@example.com",
};

const SUGGESTED_KEYS = SUGGESTED_EVENT_FIELDS.map((suggested) => suggested.source_field);

let prisma: PrismaClient;
let app: ReturnType<typeof buildTestApp>;
const cookies = { adminA: "", adminB: "", operator: "", superadmin: "" };
let adminAId = "";

async function wipeAll(client: PrismaClient): Promise<void> {
  await client.eventCustomField.deleteMany({ where: { event_id: { in: EVENT_IDS } } });
  await client.attendeeActionLog.deleteMany({ where: { event_id: { in: EVENT_IDS } } });
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
      { id: ORG_A, name: "Fldsug Org A", slug: "fldsug-org-a" },
      { id: ORG_B, name: "Fldsug Org B", slug: "fldsug-org-b" },
    ],
  });
  await client.event.createMany({
    data: [
      { id: EVENT_A, title: "Fldsug A", slug: "fldsug-a", date: new Date("2099-10-01"), organization_id: ORG_A },
      { id: EVENT_B, title: "Fldsug B", slug: "fldsug-b", date: new Date("2099-10-03"), organization_id: ORG_B },
      { id: EVENT_ARCHIVED, title: "Fldsug Archived", slug: "fldsug-archived", date: new Date("2099-09-01"), organization_id: ORG_A, archived_at: new Date() },
      { id: EVENT_BY_HAND, title: "Fldsug By Hand", slug: "fldsug-by-hand", date: new Date("2099-10-05"), organization_id: ORG_A },
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
  adminAId = adminA!.id;
  cookies.adminA = await sessionCookieFor(client, adminA!.id);
  cookies.adminB = await sessionCookieFor(client, adminB!.id);
  cookies.operator = await sessionCookieFor(client, operator!.id);
  cookies.superadmin = await sessionCookieFor(client, superadmin!.id);
}

beforeAll(async () => {
  prisma = createTestPrismaClient();
  await seed(prisma);
  app = buildTestApp({ prisma, checkinToken: "fldsug-checkin-token-32-characters!", adminDistRoot });
});

beforeEach(async () => {
  await prisma.eventCustomField.deleteMany({ where: { event_id: { in: EVENT_IDS } } });
  await prisma.attendeeActionLog.deleteMany({ where: { event_id: { in: EVENT_IDS } } });
});

afterAll(async () => {
  if (prisma) await wipeAll(prisma);
  await prisma?.$disconnect();
});

const url = (eventId: string) => `/api/admin/events/${eventId}/custom-fields/suggested`;

/** `body` null sends no body at all (an `undefined` argument would take the default, `{}`). */
async function addSuggested(
  eventId = EVENT_A,
  cookie: string = cookies.adminA,
  body: string | null = "{}",
  headers: Record<string, string> = sameOrigin,
): Promise<Response> {
  return app.request(url(eventId), {
    method: "POST",
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers, "Content-Type": "application/json" },
    ...(body === null ? {} : { body }),
  });
}

const outcomeOf = async (res: Response) => (await res.json()) as AddSuggestedFieldsDto;

/** The event's fields in the order every reader of the registry lists them. */
const fieldsOf = (eventId = EVENT_A) =>
  prisma.eventCustomField.findMany({
    where: { event_id: eventId },
    orderBy: [{ display_order: { sort: "asc", nulls: "last" } }, { created_at: "asc" }, { id: "asc" }],
  });
const keysOf = async (eventId = EVENT_A) => (await fieldsOf(eventId)).map((row) => row.source_field);
const createdLog = (eventId = EVENT_A) =>
  prisma.attendeeActionLog.findMany({ where: { event_id: eventId, action_type: "event_custom_field_created" } });
/** The keys the "field created" entries name. Sorted: entries written in one transaction share a time, so their order says nothing. */
const loggedKeys = async (eventId = EVENT_A) =>
  (await createdLog(eventId)).map((entry) => (entry.metadata as { source_field: string }).source_field).sort((a, b) => a.localeCompare(b));

/** Fields of the organiser's own, none of them with a suggested key. */
async function addOwnFields(count: number, eventId = EVENT_A): Promise<void> {
  await prisma.eventCustomField.createMany({
    data: Array.from({ length: count }, (_, index) => ({ event_id: eventId, source_field: `own_${index}`, label: `Own question ${index}` })),
  });
}

describe("who may add the suggested questions", () => {
  it("lets the administrator of the event's organisation add them, and answers 201", async () => {
    const res = await addSuggested();

    expect(res.status).toBe(201);
    expect(await keysOf()).toEqual(SUGGESTED_KEYS);
  });

  it("lets a superadmin add them to the event of any organisation", async () => {
    const res = await addSuggested(EVENT_B, cookies.superadmin);

    expect(res.status).toBe(201);
    expect(await keysOf(EVENT_B)).toEqual(SUGGESTED_KEYS);
  });

  it("refuses the administrator of another organisation, without saying anything about the event", async () => {
    const res = await addSuggested(EVENT_A, cookies.adminB);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    expect(await keysOf()).toEqual([]);
  });

  it("refuses a door operator of the event", async () => {
    const res = await addSuggested(EVENT_A, cookies.operator);

    expect(res.status).toBe(403);
    expect(await keysOf()).toEqual([]);
  });

  it("refuses a request without a session", async () => {
    const res = await addSuggested(EVENT_A, "");

    expect([401, 403]).toContain(res.status);
    expect(await keysOf()).toEqual([]);
  });

  it("refuses a request that does not come from the page itself (no same-origin proof)", async () => {
    const res = await addSuggested(EVENT_A, cookies.adminA, "{}", { Origin: "https://elsewhere.example.net" });

    expect(res.status).toBe(403);
    expect(await keysOf()).toEqual([]);
  });

  it("answers 404 to a superadmin who names an event that is not there (the first row has no event to belong to), and writes nothing", async () => {
    const res = await addSuggested("evt-fldsug-missing", cookies.superadmin);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("refuses an archived event, like adding a field by hand, and adds nothing", async () => {
    const res = await addSuggested(EVENT_ARCHIVED);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ code: "event_archived" });
    expect(await keysOf(EVENT_ARCHIVED)).toEqual([]);
  });
});

describe("what it adds", () => {
  it("adds the five questions to an event with none, in the order of the set, and says so", async () => {
    const res = await addSuggested();

    expect(res.status).toBe(201);
    expect(await outcomeOf(res)).toEqual({ added: ["parking", "parking_plate", "travel", "arrival", "accommodation"], skipped: [] });
    expect(await keysOf()).toEqual(["parking", "parking_plate", "travel", "arrival", "accommodation"]);
  });

  it("creates each as an optional question on the registration form, as the set describes it", async () => {
    await addSuggested();

    const rows = new Map((await fieldsOf()).map((row) => [row.source_field, row]));
    for (const suggested of SUGGESTED_EVENT_FIELDS) {
      const row = rows.get(suggested.source_field);
      expect(row?.label, suggested.source_field).toBe(suggested.label);
      expect(row?.description, suggested.source_field).toBe(suggested.description ?? null);
      expect(row?.type, suggested.source_field).toBe(suggested.type);
      expect(row?.required, suggested.source_field).toBe(false);
      expect(row?.show_on_form, suggested.source_field).toBe(true);
      expect(row?.options, suggested.source_field).toEqual(suggested.options ?? null);
      expect(row?.rules, suggested.source_field).toEqual(suggested.rules ?? null);
      // Like a field added by hand: no place of its own, so the new fields are listed last.
      expect(row?.display_order, suggested.source_field).toBeNull();
    }
    expect(rows.get("parking_plate")?.rules).toMatchObject({ show_when: { field: "parking", value: true }, max_length: 12 });
    expect(rows.get("travel")?.options).toEqual(["Car", "Train", "Plane", "Other"]);
  });

  it("lists the registration number right after the parking question it depends on, in the list the admin API gives", async () => {
    await addSuggested();

    const list = await app.request(`/api/admin/events/${EVENT_A}/custom-fields`, { headers: { Cookie: cookies.adminA } });
    const body = (await list.json()) as { items: { source_field: string; show_on_form: boolean }[] };

    expect(body.items.map((item) => item.source_field)).toEqual(SUGGESTED_KEYS);
    expect(body.items.every((item) => item.show_on_form)).toBe(true);
  });

  it("puts the new questions after the fields the event has", async () => {
    await addOwnFields(2);

    await addSuggested();

    expect(await keysOf()).toEqual(["own_0", "own_1", ...SUGGESTED_KEYS]);
  });

  it("records each question as a field created, with its key and nothing else", async () => {
    await addSuggested();

    const entries = await createdLog();
    expect(entries.map((entry) => entry.metadata)).toEqual(expect.arrayContaining(SUGGESTED_KEYS.map((source_field) => ({ source_field }))));
    expect(entries).toHaveLength(SUGGESTED_KEYS.length);
    for (const entry of entries) {
      expect(entry.actor_user_id).toBe(adminAId);
      expect(entry.attendee_id).toBeNull();
    }
    // No new kind of entry: the same one that "Add field" writes.
    expect(await prisma.attendeeActionLog.count({ where: { event_id: EVENT_A } })).toBe(SUGGESTED_KEYS.length);
  });
});

describe("what it writes is what \"Add field\" writes for the same question", () => {
  it("accepts every suggested question from the ordinary create route, in the order of the set, and stores the same rows", async () => {
    for (const suggested of SUGGESTED_EVENT_FIELDS) {
      const res = await app.request(`/api/admin/events/${EVENT_BY_HAND}/custom-fields`, {
        method: "POST",
        headers: { Cookie: cookies.adminA, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({
          source_field: suggested.source_field,
          label: suggested.label,
          ...(suggested.description === undefined ? {} : { description: suggested.description }),
          type: suggested.type,
          required: false,
          show_on_form: true,
          ...(suggested.options ? { options: suggested.options } : {}),
          ...(suggested.rules ? { rules: suggested.rules } : {}),
        }),
      });
      expect(res.status, suggested.source_field).toBe(201);
    }
    await addSuggested(EVENT_A);

    const columns = (row: Awaited<ReturnType<typeof fieldsOf>>[number]) => ({
      source_field: row.source_field,
      label: row.label,
      description: row.description,
      type: row.type,
      options: row.options,
      required: row.required,
      show_on_form: row.show_on_form,
      display_order: row.display_order,
      rules: row.rules,
    });
    expect((await fieldsOf(EVENT_A)).map(columns)).toEqual((await fieldsOf(EVENT_BY_HAND)).map(columns));
    // The audit trail is the same too: one "field created" entry per question, with its key.
    expect(await loggedKeys(EVENT_A)).toEqual(await loggedKeys(EVENT_BY_HAND));
    expect(await loggedKeys(EVENT_A)).toEqual([...SUGGESTED_KEYS].sort((a, b) => a.localeCompare(b)));
  });
});

describe("a second request", () => {
  it("adds nothing, answers 200 with every question skipped, and leaves the rows and the log as they were", async () => {
    await addSuggested();
    const before = await fieldsOf();
    const logBefore = await createdLog();

    const res = await addSuggested();

    expect(res.status).toBe(200);
    expect(await outcomeOf(res)).toEqual({ added: [], skipped: SUGGESTED_KEYS.map((source_field) => ({ source_field, reason: "exists" })) });
    expect(await fieldsOf()).toEqual(before);
    expect((await createdLog()).length).toBe(logBefore.length);
  });

  it("leaves a question the organiser changed as the organiser left it", async () => {
    await addSuggested();
    await prisma.eventCustomField.update({ where: { event_id_source_field: { event_id: EVENT_A, source_field: "travel" } }, data: { label: "Getting here", options: ["Bus", "Bike"], required: true } });
    await prisma.eventCustomField.update({ where: { event_id_source_field: { event_id: EVENT_A, source_field: "arrival" } }, data: { show_on_form: false, rules: { icon: "calendar" } } });
    await prisma.eventCustomField.update({ where: { event_id_source_field: { event_id: EVENT_A, source_field: "parking" } }, data: { description: "Ask the venue first" } });
    const before = await fieldsOf();

    const res = await addSuggested();

    expect((await outcomeOf(res)).added).toEqual([]);
    expect(await fieldsOf()).toEqual(before);
    const travel = (await fieldsOf()).find((row) => row.source_field === "travel");
    expect(travel).toMatchObject({ label: "Getting here", options: ["Bus", "Bike"], required: true });
  });

  it("brings back only the question the organiser deleted", async () => {
    await addSuggested();
    await prisma.eventCustomField.delete({ where: { event_id_source_field: { event_id: EVENT_A, source_field: "travel" } } });
    const others = await fieldsOf();

    const res = await addSuggested();

    expect(res.status).toBe(201);
    expect(await outcomeOf(res)).toEqual({
      added: ["travel"],
      skipped: ["parking", "parking_plate", "arrival", "accommodation"].map((source_field) => ({ source_field, reason: "exists" })),
    });
    expect((await fieldsOf()).filter((row) => row.source_field !== "travel")).toEqual(others);
  });

  it("brings back the registration number the organiser deleted, waiting for the parking question that is still there", async () => {
    await addSuggested();
    await prisma.eventCustomField.delete({ where: { event_id_source_field: { event_id: EVENT_A, source_field: "parking_plate" } } });

    const res = await addSuggested();

    expect((await outcomeOf(res)).added).toEqual(["parking_plate"]);
    expect((await fieldsOf()).find((row) => row.source_field === "parking_plate")?.rules).toMatchObject({ show_when: { field: "parking", value: true } });
  });

  it("adds the other questions around a field the event has under one of the suggested keys, and leaves that field alone", async () => {
    await prisma.eventCustomField.create({ data: { event_id: EVENT_A, source_field: "travel", label: "Travel notes", type: "long_text" } });
    const own = (await fieldsOf())[0];

    const res = await addSuggested();

    expect(await outcomeOf(res)).toEqual({
      added: ["parking", "parking_plate", "arrival", "accommodation"],
      skipped: [{ source_field: "travel", reason: "exists" }],
    });
    expect((await fieldsOf()).find((row) => row.source_field === "travel")).toEqual(own);
  });
});

describe("a field of the event's own that would make the registration number unable to wait for the parking question", () => {
  it.each([
    ["a text field", { type: "text" }],
    ["a yes/no question that is not on the registration form", { type: "boolean", show_on_form: false }],
  ])("skips the registration number when the event's own `parking` is %s, adds the rest and leaves that field alone", async (_name, own) => {
    await prisma.eventCustomField.create({ data: { event_id: EVENT_A, source_field: "parking", label: "Parking notes", ...own } });
    const before = (await fieldsOf())[0];

    const res = await addSuggested();

    expect(res.status).toBe(201);
    expect(await outcomeOf(res)).toEqual({
      added: ["travel", "arrival", "accommodation"],
      skipped: [
        { source_field: "parking", reason: "exists" },
        { source_field: "parking_plate", reason: "condition" },
      ],
    });
    expect(await keysOf()).toEqual(["parking", "travel", "arrival", "accommodation"]);
    expect((await fieldsOf())[0]).toEqual(before);
  });
});

describe("the limit on fields: all or nothing", () => {
  it("adds none of the questions when they do not all fit, and says how much room there is and how much they need", async () => {
    await addOwnFields(MAX_CUSTOM_FIELDS_PER_EVENT - SUGGESTED_KEYS.length + 1);

    const res = await addSuggested();

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "field_limit_reached", limit: MAX_CUSTOM_FIELDS_PER_EVENT, free: 4, needed: 5 });
    expect(await keysOf()).not.toContain("parking");
    expect(await prisma.eventCustomField.count({ where: { event_id: EVENT_A } })).toBe(MAX_CUSTOM_FIELDS_PER_EVENT - SUGGESTED_KEYS.length + 1);
    expect(await createdLog()).toEqual([]);
  });

  it("adds all of them when they fit exactly up to the limit", async () => {
    await addOwnFields(MAX_CUSTOM_FIELDS_PER_EVENT - SUGGESTED_KEYS.length);

    const res = await addSuggested();

    expect(res.status).toBe(201);
    expect(await prisma.eventCustomField.count({ where: { event_id: EVENT_A } })).toBe(MAX_CUSTOM_FIELDS_PER_EVENT);
  });

  it("says there is no room at all for an event that is at the limit", async () => {
    await addOwnFields(MAX_CUSTOM_FIELDS_PER_EVENT);

    const res = await addSuggested();

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "field_limit_reached", limit: MAX_CUSTOM_FIELDS_PER_EVENT, free: 0, needed: 5 });
  });

  describe("with two of the questions there already, three are left to add", () => {
    async function addTwoAndOwnFields(own: number): Promise<void> {
      await prisma.eventCustomField.createMany({
        data: [
          { event_id: EVENT_A, source_field: "parking", label: "Parking", type: "boolean", show_on_form: true },
          { event_id: EVENT_A, source_field: "travel", label: "Travel", type: "select", options: ["Car"] },
        ],
      });
      await addOwnFields(own);
    }

    it("adds them when they fit: 2 of the questions and 15 of the organiser's own leave room for exactly three", async () => {
      await addTwoAndOwnFields(MAX_CUSTOM_FIELDS_PER_EVENT - 5);

      const res = await addSuggested();

      expect(res.status).toBe(201);
      expect((await outcomeOf(res)).added).toEqual(["parking_plate", "arrival", "accommodation"]);
      expect(await prisma.eventCustomField.count({ where: { event_id: EVENT_A } })).toBe(MAX_CUSTOM_FIELDS_PER_EVENT);
    });

    it("adds none of them when one field too many would be left: three needed, two free", async () => {
      await addTwoAndOwnFields(MAX_CUSTOM_FIELDS_PER_EVENT - 4);

      const res = await addSuggested();

      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ error: "field_limit_reached", limit: MAX_CUSTOM_FIELDS_PER_EVENT, free: 2, needed: 3 });
      expect(await prisma.eventCustomField.count({ where: { event_id: EVENT_A } })).toBe(MAX_CUSTOM_FIELDS_PER_EVENT - 2);
    });
  });

  it("is not an error when everything is there already, even at the limit", async () => {
    await addSuggested();
    await addOwnFields(MAX_CUSTOM_FIELDS_PER_EVENT - SUGGESTED_KEYS.length);

    const res = await addSuggested();

    expect(res.status).toBe(200);
    expect((await outcomeOf(res)).added).toEqual([]);
  });
});

describe("two requests at once", () => {
  it("add each question once: one request adds the five and the other finds them there", async () => {
    const [first, second] = await Promise.all([addSuggested(), addSuggested()]);

    const outcomes = await Promise.all([outcomeOf(first), outcomeOf(second)]);
    expect([first.status, second.status].sort((a, b) => a - b)).toEqual([200, 201]);
    expect(outcomes.map((outcome) => outcome.added.length).sort((a, b) => a - b)).toEqual([0, 5]);
    expect(await keysOf()).toEqual(SUGGESTED_KEYS);
    expect((await createdLog()).length).toBe(SUGGESTED_KEYS.length);
  });

  it("never leave the event over the limit or with some of the questions: the five are added together or not at all", async () => {
    await addOwnFields(MAX_CUSTOM_FIELDS_PER_EVENT - SUGGESTED_KEYS.length - 1);
    const byHand = (key: string) =>
      app.request(`/api/admin/events/${EVENT_A}/custom-fields`, {
        method: "POST",
        headers: { Cookie: cookies.adminA, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ source_field: key, label: key }),
      });

    // 14 fields, the five would make 19, and three more by hand would make 22: whoever comes second to the limit is refused.
    const [suggested] = await Promise.all([addSuggested(), byHand("hand_a"), byHand("hand_b"), byHand("hand_c")]);

    const keys = await keysOf();
    const present = SUGGESTED_KEYS.filter((key) => keys.includes(key));
    expect(keys.length).toBeLessThanOrEqual(MAX_CUSTOM_FIELDS_PER_EVENT);
    expect(present).toEqual(suggested.status === 201 ? SUGGESTED_KEYS : []);
    expect([201, 422]).toContain(suggested.status);
  });
});

describe("what the request carries", () => {
  it("takes no body: an empty one and an empty object are the same", async () => {
    const empty = await addSuggested(EVENT_A, cookies.adminA, null);
    expect(empty.status).toBe(201);

    await prisma.eventCustomField.deleteMany({ where: { event_id: EVENT_A } });
    const braces = await addSuggested(EVENT_A, cookies.adminA, "  {}  ");
    expect(braces.status).toBe(201);
  });

  it.each([
    ["a question of the caller's own", JSON.stringify({ fields: [{ source_field: "own", label: "Own" }] })],
    ["any key at all", JSON.stringify({ parking: true })],
    ["a list", "[]"],
    ["null", "null"],
    ["a string", JSON.stringify("parking")],
  ])("refuses a body that holds %s, and adds nothing", async (_name, body) => {
    const res = await addSuggested(EVENT_A, cookies.adminA, body);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "validation_failed" });
    expect(await keysOf()).toEqual([]);
  });

  it("refuses a body that is not JSON", async () => {
    const res = await addSuggested(EVENT_A, cookies.adminA, "{not json");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid json" });
    expect(await keysOf()).toEqual([]);
  });
});
