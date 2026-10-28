import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { hashPassword } from "@admitto/auth";
import { handlePutEventRegistrationSettings } from "../../src/admin/event-registration-settings-routes.js";
import {
  defaultSettings,
  getEventRegistrationSettings,
  updateEventRegistrationSettings,
  type RegistrationSettingsDto,
} from "../../src/admin/event-registration-settings.js";
import { setEnabledAccessMethods } from "../../src/registration/access-methods.js";
import { READINESS_KEYS, type RegistrationReadinessKey } from "../../src/registration/readiness.js";
import { TURNSTILE_SETTINGS_KEY } from "../../src/registration/turnstile-settings.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import {
  createStaffSession,
  recordModelCalls,
  removeStaff,
  setOrgMail,
  withoutInstanceUrl,
} from "../helpers/registration-settings-fixtures.js";
import { PAST, eventSeeder, type EventSeed, type FieldSeed } from "../helpers/registration-submit-harness.js";

/**
 * `GET` and `PUT /api/admin/events/:eventId/registration/settings` against a real database through the real app: who may
 * call them, what a request must look like, what an answer says (and never says), and the gate that stands between an
 * event and registration being on. The concurrency of the save is in event-registration-settings-concurrency.test.ts, and
 * its agreement with the public page in registration-readiness.test.ts.
 */
const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };
const jsonHeaders = { "Content-Type": "application/json", ...sameOrigin };

const ORG = "org-reg99a-routes";
const OTHER_ORG = "org-reg99a-other";
const EMAILS = {
  admin: "reg99a-admin@example.com",
  otherAdmin: "reg99a-other-admin@example.com",
  operator: "reg99a-operator@example.com",
  superadmin: "reg99a-super@example.com",
};

let prisma: PrismaClient;
let app: ReturnType<typeof buildTestApp>;
let seeder: ReturnType<typeof eventSeeder>;
let adminId = "";
let otherAdminId = "";
let superadminId = "";
let mainEvent: { id: string; slug: string };
const cookies = { admin: "", otherAdmin: "", operator: "", superadmin: "" };
let counter = 0;

const settingsPath = (eventId: string) => `/api/admin/events/${eventId}/registration/settings`;

const get = (eventId: string, cookie = cookies.admin) => app.request(settingsPath(eventId), { headers: { Cookie: cookie } });

const put = (eventId: string, body: unknown, cookie = cookies.admin) =>
  app.request(settingsPath(eventId), { method: "PUT", headers: { ...jsonHeaders, Cookie: cookie }, body: JSON.stringify(body) });

const dto = async (res: Response) => (await res.json()) as RegistrationSettingsDto;

/** An event that is off but ready: the link chosen, both required texts published, and every system piece in place. */
async function addEvent(label: string, seed: EventSeed = {}): Promise<{ id: string; slug: string }> {
  const slug = `reg99a-${label}-${(counter += 1)}`;
  // No consent is asked unless the test says so, whatever texts the event publishes.
  const settings = seed.settings === null ? null : { mode: null, access_methods: ["link"], consent_keys: [], ...seed.settings };
  return { id: await seeder.addEvent(slug, { ...seed, settings }), slug };
}

const settingsRow = (eventId: string) => prisma.eventRegistrationSettings.findUnique({ where: { event_id: eventId } });

const auditOf = (eventId: string) =>
  prisma.adminAuditLog.findMany({
    where: { action_type: "registration_settings_changed", metadata: { path: ["event_id"], equals: eventId } },
    orderBy: { created_at: "asc" },
  });

const setMail = (on: boolean) => setOrgMail(prisma, ORG, on);

const addField = (eventId: string, data: FieldSeed) =>
  prisma.eventCustomField.create({ data: { event_id: eventId, type: "text", show_on_form: true, ...data } });

/** What every breaker below does to a system that is ready, so that one check, and only that one, is missing. */
type Breaker = [key: RegistrationReadinessKey, breakIt: (eventId: string) => Promise<unknown>];

const BREAKERS: Breaker[] = [
  ["access_method", (id) => prisma.eventRegistrationSettings.update({ where: { event_id: id }, data: { access_methods: [] } })],
  ["access_method_enabled", () => setEnabledAccessMethods(prisma, [])],
  ["bot_protection", () => prisma.systemSettings.deleteMany({ where: { key: TURNSTILE_SETTINGS_KEY } })],
  [
    "password",
    async (id) => {
      await setEnabledAccessMethods(prisma, ["link", "password"]);
      await prisma.eventRegistrationSettings.update({ where: { event_id: id }, data: { access_methods: ["password"] } });
    },
  ],
  ["legal_documents", (id) => prisma.legalDocument.deleteMany({ where: { event_id: id, kind: "event_terms" } })],
  ["form_questions", (id) => addField(id, { source_field: "diet", label: "Diet", type: "select", required: true, options: [] })],
  ["required_fields", (id) => addField(id, { source_field: "left", label: "Left from an import", required: true, show_on_form: false })],
  ["mail_provider", () => setMail(false)],
  ["event_not_ended", (id) => prisma.event.update({ where: { id }, data: { date: PAST } })],
];

const actorOf = (operator: string) => ({ operator, ip: "203.0.113.7" });

async function wipe(): Promise<void> {
  await prisma.adminAuditLog.deleteMany({ where: { organization_id: { in: [ORG, OTHER_ORG] } } });
  await setMail(false);
  await removeStaff(prisma, Object.values(EMAILS));
  await prisma.organization.deleteMany({ where: { id: OTHER_ORG } });
}

beforeAll(async () => {
  prisma = createTestPrismaClient();
  seeder = eventSeeder(prisma, ORG);
  await wipe();
  await seeder.prepare();
  await prisma.organization.create({ data: { id: OTHER_ORG, name: "Reg99a Other Org", slug: OTHER_ORG } });
  mainEvent = await addEvent("main");

  const admin = await createStaffSession(prisma, EMAILS.admin, { role: "admin", organizationId: ORG });
  const otherAdmin = await createStaffSession(prisma, EMAILS.otherAdmin, { role: "admin", organizationId: OTHER_ORG });
  const operator = await createStaffSession(prisma, EMAILS.operator, { role: "operator", eventId: mainEvent.id });
  const superadmin = await createStaffSession(prisma, EMAILS.superadmin, { role: "superadmin" });
  adminId = admin.userId;
  otherAdminId = otherAdmin.userId;
  superadminId = superadmin.userId;
  cookies.admin = admin.cookie;
  cookies.otherAdmin = otherAdmin.cookie;
  cookies.operator = operator.cookie;
  cookies.superadmin = superadmin.cookie;
  app = buildTestApp({ prisma, checkinToken: "reg99a-routes-checkin-token-32-chars", adminDistRoot });
});

beforeEach(async () => {
  // Every test starts from a system that is ready: the Turnstile keys, the link enabled, a mail provider.
  await seeder.setSystemKeys(true);
  await setMail(true);
});

afterAll(async () => {
  if (!prisma) return;
  await seeder.wipe();
  await wipe();
  await prisma.$disconnect();
});

describe("who may use the settings routes", () => {
  it.each([
    ["GET", (eventId: string, cookie?: string) => get(eventId, cookie)],
    ["PUT", (eventId: string, cookie?: string) => put(eventId, { waitlist_enabled: false }, cookie)],
  ] as const)("%s: signed out is 401, an operator or an admin of another organisation is 403, and nothing is written", async (_verb, call) => {
    expect((await call(mainEvent.id, "")).status).toBe(401);
    for (const cookie of [cookies.operator, cookies.otherAdmin]) {
      const res = await call(mainEvent.id, cookie);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "forbidden" });
    }
    expect((await settingsRow(mainEvent.id))?.waitlist_enabled).toBe(true);
    expect(await auditOf(mainEvent.id)).toHaveLength(0);
  });

  it("lets an admin of the organisation and a superadmin read and save", async () => {
    const event = await addEvent("roles");

    expect((await get(event.id, cookies.admin)).status).toBe(200);
    expect((await get(event.id, cookies.superadmin)).status).toBe(200);
    expect((await put(event.id, { waitlist_enabled: false }, cookies.admin)).status).toBe(200);
    expect((await put(event.id, { waitlist_enabled: true }, cookies.superadmin)).status).toBe(200);
    expect((await auditOf(event.id)).map((row) => row.actor_user_id)).toEqual([adminId, superadminId]);
  });

  it("checks the browser's origin on a write, and caps the size of its body before reading it", async () => {
    const event = await addEvent("csrf");
    const body = JSON.stringify({ waitlist_enabled: false });
    const withoutOrigin = await app.request(settingsPath(event.id), {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookies.admin },
      body,
    });
    const otherSite = await app.request(settingsPath(event.id), {
      method: "PUT",
      headers: { "Content-Type": "application/json", Origin: "https://evil.example.net", Cookie: cookies.admin },
      body,
    });
    const tooLarge = await put(event.id, { consent_keys: [], pad: "x".repeat(5_000) });

    expect([withoutOrigin.status, otherSite.status]).toEqual([403, 403]);
    expect(tooLarge.status).toBe(400);
    expect(await tooLarge.json()).toEqual({ error: "request too large" });
    expect((await settingsRow(event.id))?.waitlist_enabled).toBe(true);
  });

  it("answers 404 for an event that is not there, to a superadmin who is allowed everywhere", async () => {
    const read = await get("evt-reg99a-missing", cookies.superadmin);
    const write = await put("evt-reg99a-missing", { waitlist_enabled: false }, cookies.superadmin);

    expect([read.status, write.status]).toEqual([404, 404]);
    expect(await read.json()).toEqual({ error: "not_found" });
    expect(await write.json()).toEqual({ error: "not_found" });
  });

  it("reads an archived event, and refuses to save one: it is read only", async () => {
    const event = await addEvent("archived", { archived: true });

    const read = await get(event.id);
    const write = await put(event.id, { mode: null, waitlist_enabled: false });

    expect(read.status).toBe(200);
    expect((await dto(read)).readiness).toContainEqual({ key: "event_not_archived", ok: false });
    expect(write.status).toBe(403);
    expect(await write.json()).toEqual({ code: "event_archived" });
    expect((await settingsRow(event.id))?.waitlist_enabled).toBe(true);
    expect(await auditOf(event.id)).toHaveLength(0);
  });

  /** The handler on a bare router, without the guard of the app and its staff gate, as the signed-in user `userId`. */
  const bareSave = (userId: string, eventId: string) => {
    const bare = new Hono();
    bare.use("*", async (c, next) => {
      c.set("auth", { userId, sessionId: "session-reg99a" });
      await next();
    });
    bare.put("/events/:eventId/settings", (c) => handlePutEventRegistrationSettings(c, prisma));
    return bare.request(`/events/${eventId}/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ waitlist_enabled: false }),
    });
  };

  it("checks the role in the handler as well, so it is safe wherever it is mounted", async () => {
    const res = await bareSave(otherAdminId, mainEvent.id);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    expect((await settingsRow(mainEvent.id))?.waitlist_enabled).toBe(true);
  });

  it("refuses an event that was archived after the guard looked, as the guard does", async () => {
    // Without the archived-event guard of the app, the transaction's own check answers.
    const event = await addEvent("archived-late", { archived: true });

    const res = await bareSave(superadminId, event.id);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ code: "event_archived" });
    expect((await settingsRow(event.id))?.waitlist_enabled).toBe(true);
  });
});

describe("reading the settings", () => {
  it("gives an event with no settings row the defaults, registration off, and a readiness list", async () => {
    const event = await addEvent("no-row", { settings: null });

    const res = await get(event.id);
    const body = await dto(res);

    expect(res.status).toBe(200);
    expect(await settingsRow(event.id)).toBeNull();
    expect(body).toMatchObject({ ...defaultSettings(), password_set: false, guest_url: `https://tickets.example.com/r/${event.slug}` });
    expect(body.readiness.map((check) => check.key)).toEqual(
      READINESS_KEYS.filter((key) => key !== "password" && key !== "access_method_enabled"),
    );
    expect(body.readiness.find((check) => check.key === "access_method")).toEqual({ key: "access_method", ok: false });
    expect(body.public_fields).toEqual([]);
  });

  it("holds the defaults of an event with no row to the defaults of the table", async () => {
    // A row made with nothing but its event: whatever the columns default to is what the answer says for an event with none.
    const event = await addEvent("table-defaults", { settings: null });
    await prisma.eventRegistrationSettings.create({ data: { event_id: event.id } });

    const body = await dto(await get(event.id));

    expect({
      mode: body.mode,
      access_methods: body.access_methods,
      waitlist_enabled: body.waitlist_enabled,
      verify_email: body.verify_email,
      max_companions: body.max_companions,
      ask_company: body.ask_company,
      ask_department: body.ask_department,
      consent_keys: body.consent_keys,
    }).toEqual(defaultSettings());
  });

  it("says what is saved, the address of the form and the questions a guest will see", async () => {
    const event = await addEvent("saved", {
      settings: {
        mode: "approval",
        access_methods: ["link"],
        waitlist_enabled: false,
        verify_email: false,
        max_companions: 1,
        ask_company: true,
        ask_department: true,
        consent_keys: ["photos"],
      },
      legal: { consents: ["photos"] },
      fields: [
        { source_field: "parking", label: "Parking", type: "boolean" },
        { source_field: "hidden", label: "Left from an import", show_on_form: false },
        { source_field: "diet", label: "Diet", type: "select", options: ["Vegan", "Other"], required: true },
      ],
    });

    const body = await dto(await get(event.id));

    expect(body).toEqual({
      mode: "approval",
      access_methods: ["link"],
      waitlist_enabled: false,
      verify_email: false,
      max_companions: 1,
      ask_company: true,
      ask_department: true,
      consent_keys: ["photos"],
      password_set: false,
      guest_url: `https://tickets.example.com/r/${event.slug}`,
      readiness: READINESS_KEYS.filter((key) => key !== "password").map((key) => ({ key, ok: true })),
      public_fields: [
        { key: "parking", label: "Parking", type: "boolean", required: false },
        { key: "diet", label: "Diet", type: "select", required: true },
      ],
    });
  });

  it("says a password is set and never what it is: not the hash, not its length, not a field that could hold either", async () => {
    const event = await addEvent("hash", { settings: { access_methods: ["password"] } });
    const hash = await hashPassword("test-password");
    await prisma.eventRegistrationSettings.update({ where: { event_id: event.id }, data: { password_hash: hash } });

    const res = await get(event.id);
    const text = await res.text();
    const body = JSON.parse(text) as RegistrationSettingsDto & Record<string, unknown>;

    expect(body.password_set).toBe(true);
    // The whole set of keys: a key that could carry the hash, or its length, would be in it.
    expect(Object.keys(body).sort()).toEqual([
      "access_methods",
      "ask_company",
      "ask_department",
      "consent_keys",
      "guest_url",
      "max_companions",
      "mode",
      "password_set",
      "public_fields",
      "readiness",
      "verify_email",
      "waitlist_enabled",
    ]);
    expect(text).not.toContain(hash);
    expect(text).not.toContain("argon2");
    expect(text).not.toContain("test-password");
  });

  it("never loads the hash into the process: every read of the row names its columns and the hash is not one, and the count is all that asks", async () => {
    const hash = await hashPassword("test-password");
    const event = await addEvent("hash-unread", { settings: { access_methods: ["password"], password_hash: hash } });
    const recording = recordModelCalls(prisma, "eventRegistrationSettings");

    await getEventRegistrationSettings(recording.client, event.id);
    await updateEventRegistrationSettings(recording.client, {
      eventId: event.id,
      patch: { waitlist_enabled: false, access_methods: ["link"] },
      actor: actorOf(adminId),
    });

    const reads = recording.calls.filter((call) => call.method.startsWith("find"));
    expect(reads.length).toBeGreaterThanOrEqual(2);
    for (const read of reads) {
      const select = (read.args as { select?: Record<string, boolean> }).select;
      expect(select, `${read.method} without a select would load every column`).toBeDefined();
      expect(select).not.toHaveProperty("password_hash");
    }
    // The only question put to the database about the hash is whether it is there.
    const asked = recording.calls.filter((call) => call.method === "count");
    expect(asked.length).toBeGreaterThanOrEqual(2);
    for (const call of asked) expect(JSON.stringify(call.args)).toContain('"password_hash":{"not":null}');
  });

  it("is the same answer for an admin and for a superadmin", async () => {
    const event = await addEvent("same-answer");

    expect(await (await get(event.id, cookies.admin)).text()).toBe(await (await get(event.id, cookies.superadmin)).text());
  });
});

describe("what a save may carry", () => {
  it.each([
    ["a field that is not a setting", { password_hash: "x" }],
    ["a password", { password: "a long enough password" }],
    ["the id of an event", { event_id: "evt-reg99a-other" }],
    ["the company sign-in", { access_methods: ["sso"] }],
    ["two ways in", { access_methods: ["link", "password"] }],
    ["a way in that is a text", { access_methods: "link" }],
    ["a mode that is not one", { mode: "on" }],
    ["a mode that is a number", { mode: 1 }],
    ["fewer than no companions", { max_companions: -1 }],
    ["more companions than the application allows", { max_companions: 2 }],
    ["half a companion", { max_companions: 0.5 }],
    ["a number of companions that is a text", { max_companions: "1" }],
    ["a switch that is a text", { waitlist_enabled: "false" }],
    ["a switch that is null", { ask_company: null }],
    ["a consent key that is no key", { consent_keys: ["Not A Key"] }],
    ["more consents than an event may have", { consent_keys: Array.from({ length: 11 }, (_, index) => `consent-${index}`) }],
    ["a list of consents that is a text", { consent_keys: "photos" }],
    ["a body that is a list", []],
    ["a body that is a text", "mode"],
    ["a body that is null", null],
  ])("refuses %s with a 400, and saves nothing", async (_label, body) => {
    const event = await addEvent("shape");

    const res = await put(event.id, body);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "validation_failed" });
    expect(await auditOf(event.id)).toHaveLength(0);
    expect(await settingsRow(event.id)).toMatchObject({ mode: null, access_methods: ["link"], max_companions: 0, password_hash: null });
  });

  it("refuses a body that is not JSON", async () => {
    const event = await addEvent("not-json");

    const res = await app.request(settingsPath(event.id), {
      method: "PUT",
      headers: { ...jsonHeaders, Cookie: cookies.admin },
      body: "{ not json",
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_json" });
  });

  it("takes 0 and 1 as the number of companions: the limits of the application", async () => {
    const event = await addEvent("companions");

    expect((await dto(await put(event.id, { max_companions: 1 }))).max_companions).toBe(1);
    expect((await settingsRow(event.id))?.max_companions).toBe(1);
    expect((await dto(await put(event.id, { max_companions: 0 }))).max_companions).toBe(0);
    expect((await settingsRow(event.id))?.max_companions).toBe(0);
  });

  it("takes an empty body: nothing to change", async () => {
    const event = await addEvent("empty");

    const res = await put(event.id, {});

    expect(res.status).toBe(200);
    expect((await dto(res)).mode).toBeNull();
    expect(await auditOf(event.id)).toHaveLength(0);
  });
});

describe("turning registration on", () => {
  it.each(BREAKERS)("is refused with %s alone missing: that key and nothing else, and nothing is saved", async (key, breakIt) => {
    const event = await addEvent(`gate-${key}`);
    await breakIt(event.id);

    const res = await put(event.id, { mode: "automatic" });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "registration_not_ready", blockers: [key] });
    expect(await settingsRow(event.id)).toMatchObject({ mode: null });
    expect(await auditOf(event.id)).toHaveLength(0);
  });

  it.each(["automatic", "approval"] as const)("is let through in the mode %s when nothing is missing", async (mode) => {
    const event = await addEvent(`gate-ok-${mode}`);

    const res = await put(event.id, { mode });
    const body = await dto(res);

    expect(res.status).toBe(200);
    expect(body.mode).toBe(mode);
    expect(body.readiness.filter((check) => !check.ok)).toEqual([]);
    expect((await settingsRow(event.id))?.mode).toBe(mode);
    expect(await auditOf(event.id)).toHaveLength(1);
  });

  it("names every check that is missing, in the order of the vocabulary", async () => {
    const event = await addEvent("gate-everything");
    for (const [, breakIt] of BREAKERS.filter(([key]) => key !== "access_method" && key !== "access_method_enabled")) await breakIt(event.id);

    const res = await put(event.id, { mode: "automatic" });
    const body = (await res.json()) as { error: string; blockers: string[] };

    expect(res.status).toBe(409);
    expect(body.blockers).toEqual(["bot_protection", "password", "legal_documents", "form_questions", "required_fields", "mail_provider", "event_not_ended"]);
    expect(body.blockers).toEqual(READINESS_KEYS.filter((key) => body.blockers.includes(key)));
  });

  it("answers with the keys of what is missing and with no text: nothing an organiser typed comes back", async () => {
    const event = await addEvent("gate-keys-only");
    await addField(event.id, { source_field: "left", label: "<b>Secret label</b> of a field", required: true, show_on_form: false });
    await prisma.event.update({ where: { id: event.id }, data: { title: "Title nobody may read back" } });

    const res = await put(event.id, { mode: "automatic" });
    const text = await res.text();

    expect(Object.keys(JSON.parse(text) as object).sort()).toEqual(["blockers", "error"]);
    expect(JSON.parse(text)).toEqual({ error: "registration_not_ready", blockers: ["required_fields"] });
    expect(text).not.toContain("Secret label");
    expect(text).not.toContain("Title nobody may read back");
  });

  it("is refused while the instance has no address the worker could send the links of, and says so when read", async () => {
    const event = await addEvent("gate-instance-url");

    const read = await withoutInstanceUrl(prisma, (env) => getEventRegistrationSettings(prisma, event.id, { env }));
    const refused = await withoutInstanceUrl(prisma, (env) =>
      updateEventRegistrationSettings(prisma, { eventId: event.id, patch: { mode: "automatic" }, actor: actorOf(adminId), env }),
    );
    const allowed = await updateEventRegistrationSettings(prisma, { eventId: event.id, patch: { mode: "automatic" }, actor: actorOf(adminId), env: {} });

    expect(read?.guest_url).toBeNull();
    expect(read?.readiness).toContainEqual({ key: "instance_url", ok: false });
    expect(refused).toEqual({ kind: "not_ready", blockers: ["instance_url"] });
    expect(allowed.kind).toBe("saved");
  });

  it("counts an address of the instance that is not a web address as none", async () => {
    const event = await addEvent("gate-instance-url-invalid");

    const result = await updateEventRegistrationSettings(prisma, {
      eventId: event.id,
      patch: { mode: "automatic" },
      actor: actorOf(adminId),
      env: { BASE_URL: "ftp://events.example.com" },
    });

    expect(result).toEqual({ kind: "not_ready", blockers: ["instance_url"] });
  });

  it("judges a save that turns registration on and changes its way in together, by the way in it is given", async () => {
    const event = await addEvent("gate-together");
    // The system administrator has enabled the link and not the password.
    await setEnabledAccessMethods(prisma, ["link"]);

    const refused = await put(event.id, { mode: "automatic", access_methods: ["password"] });
    const allowed = await put(event.id, { mode: "automatic", access_methods: ["link"] });

    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: "registration_not_ready", blockers: ["access_method_enabled", "password"] });
    expect(allowed.status).toBe(200);
  });

  it("lets the way in and the consents be chosen while registration is off, whatever is missing: they are judged when it is turned on", async () => {
    const event = await addEvent("gate-choose-first", { legal: { consents: ["photos"] } });
    await setMail(false);

    const res = await put(event.id, { access_methods: ["password"], consent_keys: ["photos"] });
    const body = await dto(res);

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ mode: null, access_methods: ["password"], consent_keys: ["photos"], password_set: false });
    expect(body.readiness).toContainEqual({ key: "password", ok: false });
    expect(body.readiness).toContainEqual({ key: "mail_provider", ok: false });
  });
});

describe("turning registration off", () => {
  it("is never refused, however much is missing", async () => {
    const event = await addEvent("off-broken", { settings: { mode: "automatic" } });
    for (const [, breakIt] of BREAKERS) await breakIt(event.id);
    await prisma.event.update({ where: { id: event.id }, data: { archived_at: null } });

    const res = await put(event.id, { mode: null });
    const body = await dto(res);

    expect(res.status).toBe(200);
    expect(body.mode).toBeNull();
    expect(body.readiness.filter((check) => !check.ok).length).toBeGreaterThanOrEqual(7);
    expect((await settingsRow(event.id))?.mode).toBeNull();
    const [entry] = await auditOf(event.id);
    expect(entry!.metadata).toMatchObject({ fields_changed: ["mode"], mode: "off" });
  });

  it("takes the other changes of the same save with it, because it only shuts the form", async () => {
    const event = await addEvent("off-and-more", { settings: { mode: "approval" } });
    await setMail(false);

    const res = await put(event.id, { mode: null, access_methods: [], waitlist_enabled: false });

    expect(res.status).toBe(200);
    expect(await settingsRow(event.id)).toMatchObject({ mode: null, access_methods: [], waitlist_enabled: false });
  });

  it("is not a reason to touch the registrations guests sent: they stay, with their mail", async () => {
    const event = await addEvent("off-registrations", { settings: { mode: "approval" } });
    const states = ["awaiting_email", "pending", "waitlist"] as const;
    for (const [index, status] of states.entries()) {
      const registration = await prisma.registration.create({
        data: {
          event_id: event.id,
          email: `reg99a-guest-${index}@example.com`,
          first_name: "Guest",
          last_name: `Number${index}`,
          name: `Guest Number${index}`,
          status,
          confirm_expires_at: status === "awaiting_email" ? new Date(Date.now() + 86_400_000) : null,
        },
      });
      await prisma.registrationMail.create({
        data: { registration_id: registration.id, event_id: event.id, template_name: status === "awaiting_email" ? "registration-confirm" : "registration-received" },
      });
    }

    const res = await put(event.id, { mode: null });

    expect(res.status).toBe(200);
    expect(await prisma.registration.count({ where: { event_id: event.id } })).toBe(3);
    expect(await prisma.registrationMail.count({ where: { event_id: event.id, status: "queued" } })).toBe(3);
    expect((await prisma.registration.findMany({ where: { event_id: event.id }, select: { status: true }, orderBy: { status: "asc" } })).map((row) => row.status)).toEqual([
      "awaiting_email",
      "pending",
      "waitlist",
    ]);
  });
});

describe("changing the way in or the consents of an event that has registration on", () => {
  it("is judged as turning it on is: a way in that needs a password nobody set is refused, and the event keeps the way it had", async () => {
    const event = await addEvent("on-password", { settings: { mode: "automatic" } });
    await setEnabledAccessMethods(prisma, ["link", "password"]);

    const res = await put(event.id, { access_methods: ["password"] });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "registration_not_ready", blockers: ["password"] });
    expect(await settingsRow(event.id)).toMatchObject({ mode: "automatic", access_methods: ["link"] });
    expect(await auditOf(event.id)).toHaveLength(0);
  });

  it("is let through when the new way in is ready", async () => {
    const event = await addEvent("on-password-set", { settings: { mode: "automatic" } });
    await setEnabledAccessMethods(prisma, ["link", "password"]);
    await prisma.eventRegistrationSettings.update({ where: { event_id: event.id }, data: { password_hash: await hashPassword("test-password") } });

    const res = await put(event.id, { access_methods: ["password"] });

    expect(res.status).toBe(200);
    expect(await settingsRow(event.id)).toMatchObject({ mode: "automatic", access_methods: ["password"] });
  });

  it("refuses to leave the event without a way in", async () => {
    const event = await addEvent("on-no-way", { settings: { mode: "approval" } });

    const res = await put(event.id, { access_methods: [] });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "registration_not_ready", blockers: ["access_method"] });
    expect((await settingsRow(event.id))?.access_methods).toEqual(["link"]);
  });

  it("judges a consent that is added", async () => {
    const event = await addEvent("on-consent-added", { settings: { mode: "automatic" }, legal: { consents: ["photos"] } });
    await prisma.systemSettings.deleteMany({ where: { key: TURNSTILE_SETTINGS_KEY } });

    const refused = await put(event.id, { consent_keys: ["photos"] });
    await seeder.setSystemKeys(true);
    const allowed = await put(event.id, { consent_keys: ["photos"] });

    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: "registration_not_ready", blockers: ["bot_protection"] });
    expect(allowed.status).toBe(200);
    expect((await settingsRow(event.id))?.consent_keys).toEqual(["photos"]);
  });

  it("judges a consent that is taken away as well: the form it leaves must be one that opens", async () => {
    const event = await addEvent("on-consent-removed", {
      settings: { mode: "automatic", consent_keys: ["photos"] },
      legal: { consents: ["photos"] },
    });
    await prisma.systemSettings.deleteMany({ where: { key: TURNSTILE_SETTINGS_KEY } });

    const res = await put(event.id, { consent_keys: [] });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "registration_not_ready", blockers: ["bot_protection"] });
    expect((await settingsRow(event.id))?.consent_keys).toEqual(["photos"]);
  });

  it("does not judge the other switches, so an event that lost a piece can still be run", async () => {
    const event = await addEvent("on-switches", { settings: { mode: "automatic" } });
    await prisma.systemSettings.deleteMany({ where: { key: TURNSTILE_SETTINGS_KEY } });
    await setMail(false);

    const res = await put(event.id, {
      mode: "approval",
      waitlist_enabled: false,
      verify_email: false,
      max_companions: 1,
      ask_company: true,
      ask_department: true,
    });

    expect(res.status).toBe(200);
    expect(await settingsRow(event.id)).toMatchObject({
      mode: "approval",
      waitlist_enabled: false,
      verify_email: false,
      max_companions: 1,
      ask_company: true,
      ask_department: true,
    });
  });

  it("does not judge a save that repeats the way in and the consents the event has", async () => {
    const event = await addEvent("on-repeat", { settings: { mode: "automatic", consent_keys: ["photos"] }, legal: { consents: ["photos"] } });
    await prisma.systemSettings.deleteMany({ where: { key: TURNSTILE_SETTINGS_KEY } });

    const res = await put(event.id, { access_methods: ["link"], consent_keys: ["photos"] });

    expect(res.status).toBe(200);
    expect(await auditOf(event.id)).toHaveLength(0);
  });

  it("does not judge a change of the order of the consents, only of which they are", async () => {
    const event = await addEvent("on-order", {
      settings: { mode: "automatic", consent_keys: ["photos", "newsletter"] },
      legal: { consents: ["photos", "newsletter"] },
    });
    await prisma.systemSettings.deleteMany({ where: { key: TURNSTILE_SETTINGS_KEY } });

    const res = await put(event.id, { consent_keys: ["newsletter", "photos"] });

    expect(res.status).toBe(200);
    expect((await settingsRow(event.id))?.consent_keys).toEqual(["newsletter", "photos"]);
  });
});

describe("the password when the way in changes", () => {
  const withPassword = async (label: string, settings: EventSeed["settings"] = {}) => {
    const hash = await hashPassword("test-password");
    const event = await addEvent(label, { settings: { access_methods: ["password"], password_hash: hash, ...settings } });
    await setEnabledAccessMethods(prisma, ["link", "password"]);
    return { event, hash };
  };

  it("is cleared when the event moves from the password to the link: the old one does not come back, and the audit says so", async () => {
    const { event, hash } = await withPassword("pw-clear");

    const res = await put(event.id, { access_methods: ["link"] });
    const body = await dto(res);

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ access_methods: ["link"], password_set: false });
    expect((await settingsRow(event.id))?.password_hash).toBeNull();
    const [entry] = await auditOf(event.id);
    expect(entry!.metadata).toMatchObject({ fields_changed: ["access_methods"], access_methods: ["link"], password_cleared: true });
    expect(JSON.stringify(entry)).not.toContain(hash);

    // Back to the password: there is none, and the event cannot be turned on with it until one is set again.
    const back = await dto(await put(event.id, { access_methods: ["password"] }));
    expect(back).toMatchObject({ access_methods: ["password"], password_set: false });
    const enable = await put(event.id, { mode: "automatic" });
    expect(enable.status).toBe(409);
    expect(await enable.json()).toEqual({ error: "registration_not_ready", blockers: ["password"] });
  });

  it("is cleared when the way in is taken away, also while registration is off", async () => {
    const { event } = await withPassword("pw-clear-none");

    await put(event.id, { access_methods: [] });

    expect(await settingsRow(event.id)).toMatchObject({ access_methods: [], password_hash: null });
  });

  it("is cleared in the same save that moves a running event to the link", async () => {
    const { event } = await withPassword("pw-clear-on", { mode: "automatic" });

    const res = await put(event.id, { access_methods: ["link"] });

    expect(res.status).toBe(200);
    expect(await settingsRow(event.id)).toMatchObject({ mode: "automatic", access_methods: ["link"], password_hash: null });
  });

  it("is kept while the event stays on the password, whatever else is saved", async () => {
    const { event } = await withPassword("pw-keep");

    const res = await put(event.id, { waitlist_enabled: false, access_methods: ["password"], mode: "approval" });

    expect(res.status).toBe(200);
    expect((await dto(res)).password_set).toBe(true);
    expect((await settingsRow(event.id))?.password_hash).not.toBeNull();
  });

  it("is kept when it was set before the way in was chosen: it waits for the password to be chosen", async () => {
    const hash = await hashPassword("test-password");
    const event = await addEvent("pw-waiting", { settings: { access_methods: ["link"], password_hash: hash } });
    await setEnabledAccessMethods(prisma, ["link", "password"]);

    const res = await dto(await put(event.id, { access_methods: ["password"] }));

    expect(res.password_set).toBe(true);
    expect((await put(event.id, { mode: "automatic" })).status).toBe(200);
  });

  it("is not claimed to be cleared when there was none", async () => {
    const event = await addEvent("pw-none", { settings: { access_methods: ["password"] } });

    await put(event.id, { access_methods: ["link"] });

    const [entry] = await auditOf(event.id);
    expect(entry!.metadata).not.toHaveProperty("password_cleared");
  });
});

describe("the extra consents", () => {
  it("takes the keys of published consents, once each and in the order given", async () => {
    const event = await addEvent("consents", { legal: { consents: ["photos", "newsletter"] } });

    const res = await put(event.id, { consent_keys: ["photos", "newsletter", "photos"] });

    expect(res.status).toBe(200);
    expect((await dto(res)).consent_keys).toEqual(["photos", "newsletter"]);
    expect((await settingsRow(event.id))?.consent_keys).toEqual(["photos", "newsletter"]);
  });

  it("refuses a key the event has not published with a 422: a made-up one, a draft and a text of another event", async () => {
    const event = await addEvent("consents-unpublished", { legal: { consents: ["photos"] } });
    const other = await addEvent("consents-other", { legal: { consents: ["elsewhere"] } });
    await prisma.legalDocument.create({
      data: { event_id: event.id, kind: "consent", key: "draft", title: "Draft", content_html: "<p>D</p>", published_at: null },
    });

    for (const keys of [["made-up"], ["draft"], ["elsewhere"], ["photos", "draft"]]) {
      const res = await put(event.id, { consent_keys: keys });
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ error: "consent_not_published" });
    }
    expect((await settingsRow(event.id))?.consent_keys).toEqual([]);
    expect((await settingsRow(other.id))?.consent_keys).toEqual([]);
    expect(await auditOf(event.id)).toHaveLength(0);
  });

  it("refuses them while registration is on and off alike, before it judges anything else", async () => {
    const event = await addEvent("consents-on", { settings: { mode: "automatic" } });
    await prisma.systemSettings.deleteMany({ where: { key: TURNSTILE_SETTINGS_KEY } });

    const res = await put(event.id, { consent_keys: ["made-up"] });

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "consent_not_published" });
  });

  it("takes no consent at all", async () => {
    const event = await addEvent("consents-none", { settings: { consent_keys: ["photos"] }, legal: { consents: ["photos"] } });

    const res = await put(event.id, { consent_keys: [] });

    expect((await dto(res)).consent_keys).toEqual([]);
  });

  it("makes turning registration on wait for a consent the event asks for and has not published", async () => {
    const event = await addEvent("consents-gate", { settings: { consent_keys: ["photos"] }, legal: { consents: [] } });

    const res = await put(event.id, { mode: "automatic" });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "registration_not_ready", blockers: ["legal_documents"] });
  });
});

describe("what a save leaves behind", () => {
  it("answers a save that changes nothing as it answers the first, writes nothing and audits nothing", async () => {
    const event = await addEvent("idempotent");

    const first = await put(event.id, { mode: "automatic", waitlist_enabled: false });
    const before = await settingsRow(event.id);
    const second = await put(event.id, { mode: "automatic", waitlist_enabled: false });

    expect(second.status).toBe(200);
    expect(await second.text()).toBe(await first.text());
    expect(await settingsRow(event.id)).toEqual(before);
    expect(await auditOf(event.id)).toHaveLength(1);
  });

  it("lets an error it does not know rise, and writes nothing", async () => {
    const event = await addEvent("unknown-error");
    const failing = new Proxy(prisma, {
      get(target, key, receiver) {
        if (key === "$transaction") return () => Promise.reject(new Error("the database went away"));
        return Reflect.get(target, key, receiver);
      },
    });

    await expect(
      updateEventRegistrationSettings(failing, { eventId: event.id, patch: { waitlist_enabled: false }, actor: actorOf(adminId) }),
    ).rejects.toThrow("the database went away");

    expect((await settingsRow(event.id))?.waitlist_enabled).toBe(true);
    expect(await auditOf(event.id)).toHaveLength(0);
  });

  it("makes no row for an event that has none, when the save changes nothing from the defaults", async () => {
    const event = await addEvent("no-row-noop", { settings: null });

    const res = await put(event.id, { mode: null, access_methods: [], waitlist_enabled: true, consent_keys: [] });

    expect(res.status).toBe(200);
    expect(await settingsRow(event.id)).toBeNull();
    expect(await auditOf(event.id)).toHaveLength(0);
  });

  it("makes the row of an event that has none when the save changes something", async () => {
    const event = await addEvent("no-row-first", { settings: null });

    const res = await put(event.id, { access_methods: ["link"], ask_company: true });

    expect(res.status).toBe(200);
    expect(await settingsRow(event.id)).toMatchObject({ mode: null, access_methods: ["link"], ask_company: true, waitlist_enabled: true });
  });

  it("writes one entry of the central audit log: who, the event, the names of what changed with the new values, and nothing else", async () => {
    const event = await addEvent("audit", { legal: { consents: ["photos"] } });
    await prisma.event.update({ where: { id: event.id }, data: { title: "Audit Summit" } });

    await put(event.id, { mode: "approval", waitlist_enabled: false, max_companions: 1, consent_keys: ["photos"], ask_company: false });

    const [entry, ...rest] = await auditOf(event.id);
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({ organization_id: ORG, actor_user_id: adminId, action_type: "registration_settings_changed" });
    expect(entry!.metadata).toEqual({
      event_id: event.id,
      event_title: "Audit Summit",
      // ask_company is false already: not a change, so not in the entry.
      fields_changed: ["mode", "waitlist_enabled", "max_companions", "consent_keys"],
      mode: "approval",
      waitlist_enabled: false,
      max_companions: 1,
      consent_keys: ["photos"],
    });
  });

  it("holds no password, no hash and no address in the entry, whatever the event holds", async () => {
    const hash = await hashPassword("test-password");
    const event = await addEvent("audit-clean", { settings: { access_methods: ["password"], password_hash: hash } });
    await setEnabledAccessMethods(prisma, ["link", "password"]);

    await put(event.id, { access_methods: ["link"], mode: "automatic" });

    const text = JSON.stringify(await auditOf(event.id));
    expect(text).not.toContain(hash);
    expect(text).not.toContain("argon2");
    expect(text).not.toContain("test-password");
    expect(text).not.toContain("https://");
  });

  it("is told apart in the log by what it did to the mode: on, switched, off", async () => {
    const event = await addEvent("audit-modes");

    await put(event.id, { mode: "automatic" });
    await put(event.id, { mode: "approval" });
    await put(event.id, { mode: null });

    expect((await auditOf(event.id)).map((row) => (row.metadata as { mode: string }).mode)).toEqual(["automatic", "approval", "off"]);
  });
});

describe("a required field that the form does not ask", () => {
  it.each([
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ])("required %s, on the form %s: the save of the field and the readiness of the event agree", async (required, onForm) => {
    const refusedBySave = !onForm && required;
    // The route that saves a field refuses it for an event that has registration on...
    const running = await addEvent(`rule-save-${required}-${onForm}`, { settings: { mode: "automatic" } });
    const created = await app.request(`/api/admin/events/${running.id}/custom-fields`, {
      method: "POST",
      headers: { ...jsonHeaders, Cookie: cookies.admin },
      body: JSON.stringify({ source_field: "answer", label: "Answer", required, show_on_form: onForm }),
    });
    // ...and the readiness of an event that an import left with such a field does not call it ready.
    const imported = await addEvent(`rule-ready-${required}-${onForm}`);
    await addField(imported.id, { source_field: "answer", label: "Answer", required, show_on_form: onForm });
    const readiness = (await dto(await get(imported.id))).readiness.find((check) => check.key === "required_fields");

    expect(created.status).toBe(refusedBySave ? 422 : 201);
    if (refusedBySave) expect(await created.json()).toEqual({ error: "required_field_not_on_form" });
    expect(readiness).toEqual({ key: "required_fields", ok: !refusedBySave });
  });
});
