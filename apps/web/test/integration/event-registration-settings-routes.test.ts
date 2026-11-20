import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
import { setBotProtectionMode } from "../../src/registration/bot-protection-mode.js";
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

// A superadmin by default: how guests open the form is technical (the way in, the provider, the restriction), and only they change it. A test of
// what an administrator of the event may or may not do passes `cookies.admin` on purpose.
const put = (eventId: string, body: unknown, cookie = cookies.superadmin) =>
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
  ["bot_protection", () => prisma.systemSettings.deleteMany({ where: { key: TURNSTILE_SETTINGS_KEY } })],
  [
    "password",
    async (id) => {
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
  it("gives the address of the form on the event's own address once it is verified (D-C6), and on the instance's until then, on a read and on a save", async () => {
    const event = await addEvent("own-address");
    const domain = `own-address-${event.slug}.acme.example`;
    const guestUrl = async () => (await dto(await get(event.id))).guest_url;

    await prisma.eventRegistrationSettings.update({ where: { event_id: event.id }, data: { custom_domain: domain } });
    expect(await guestUrl()).toBe(`https://tickets.example.com/r/${event.slug}`);
    expect((await dto(await put(event.id, { waitlist_enabled: false }))).guest_url).toBe(`https://tickets.example.com/r/${event.slug}`);

    await prisma.eventRegistrationSettings.update({ where: { event_id: event.id }, data: { custom_domain_verified_at: new Date(), custom_domain_status: "ok" } });
    expect(await guestUrl()).toBe(`https://${domain}/r/${event.slug}`);
    expect((await dto(await put(event.id, { waitlist_enabled: true }))).guest_url).toBe(`https://${domain}/r/${event.slug}`);

    // The address is not one of the settings an organiser saves: a save leaves it, and its proof, as they were.
    expect(await settingsRow(event.id)).toMatchObject({ custom_domain: domain, custom_domain_status: "ok", custom_domain_verified_at: expect.any(Date) });
  });

  it("gives an event with no settings row the defaults, registration off, and a readiness list", async () => {
    const event = await addEvent("no-row", { settings: null });

    const res = await get(event.id);
    const body = await dto(res);

    expect(res.status).toBe(200);
    expect(await settingsRow(event.id)).toBeNull();
    expect(body).toMatchObject({ ...defaultSettings(), password_set: false, guest_url: `https://tickets.example.com/r/${event.slug}` });
    expect(body.readiness.map((check) => check.key)).toEqual(
      READINESS_KEYS.filter(
        (key) => key !== "password" && key !== "identity_provider" && key !== "bot_protection_not_used",
      ),
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
      bot_protection_enabled: body.bot_protection_enabled,
      sso_claim_name: body.sso_claim_name,
      sso_claim_values: body.sso_claim_values,
      sso_provider_id: body.sso_provider_id,
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
      bot_protection: "required",
      waitlist_enabled: false,
      verify_email: false,
      max_companions: 1,
      ask_company: true,
      ask_department: true,
      consent_keys: ["photos"],
      bot_protection_enabled: true,
      sso_claim_name: null,
      sso_claim_values: [],
      sso_provider_id: null,
      sso_provider: null,
      // Whatever providers other files of this worker left enabled: the list is checked on its own below.
      sso_providers: expect.any(Array),
      password_set: false,
      guest_url: `https://tickets.example.com/r/${event.slug}`,
      instance_host: "tickets.example.com",
      own_address: null,
      readiness: READINESS_KEYS.filter((key) => key !== "password" && key !== "identity_provider" && key !== "bot_protection_not_used").map((key) => ({ key, ok: true })),
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
      "bot_protection",
      "bot_protection_enabled",
      "consent_keys",
      "guest_url",
      "instance_host",
      "max_companions",
      "mode",
      "own_address",
      "password_set",
      "public_fields",
      "readiness",
      "sso_claim_name",
      "sso_claim_values",
    "sso_provider",
    "sso_provider_id",
    "sso_providers",
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
    ["the company sign-in next to another way in", { access_methods: ["sso", "link"] }],
    ["two ways in", { access_methods: ["link", "password"] }],
    ["a claim with no values", { sso_claim_name: "tid" }],
    ["values with no claim", { sso_claim_values: ["tenant-a"] }],
    ["a claim and an empty list of values", { sso_claim_name: "tid", sso_claim_values: [] }],
    ["no claim and some values", { sso_claim_name: null, sso_claim_values: ["tenant-a"] }],
    ["a claim name that is empty", { sso_claim_name: "", sso_claim_values: ["a"] }],
    ["a claim name with a space", { sso_claim_name: "ten ant", sso_claim_values: ["a"] }],
    ["a claim name with a line break", { sso_claim_name: "tid\nx", sso_claim_values: ["a"] }],
    ["a claim name that is a number", { sso_claim_name: 7, sso_claim_values: ["a"] }],
    ["a claim name that is too long", { sso_claim_name: "t".repeat(101), sso_claim_values: ["a"] }],
    ["a claim value that is empty", { sso_claim_name: "tid", sso_claim_values: [""] }],
    ["a claim value that is blank", { sso_claim_name: "tid", sso_claim_values: ["   "] }],
    ["a claim value that is too long", { sso_claim_name: "tid", sso_claim_values: ["v".repeat(129)] }],
    ["a claim value with a control character", { sso_claim_name: "tid", sso_claim_values: ["a\u0007b"] }],
    ["a claim value that is a number", { sso_claim_name: "tid", sso_claim_values: [7] }],
    ["more claim values than an event may list", { sso_claim_name: "tid", sso_claim_values: Array.from({ length: 21 }, (_, index) => `tenant-${index}`) }],
    ["claim values that are a text", { sso_claim_name: "tid", sso_claim_values: "tenant-a" }],
    ["a way in that is a text", { access_methods: "link" }],
    ["a mode that is not one", { mode: "on" }],
    ["a mode that is a number", { mode: 1 }],
    ["fewer than no companions", { max_companions: -1 }],
    ["more companions than the application allows", { max_companions: 2 }],
    ["half a companion", { max_companions: 0.5 }],
    ["a number of companions that is a text", { max_companions: "1" }],
    ["a switch that is a text", { waitlist_enabled: "false" }],
    ["a switch that is null", { ask_company: null }],
    ["the retired switch for the styled boxes", { styled_form_controls: true }],
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
    for (const [, breakIt] of BREAKERS.filter(([key]) => key !== "access_method")) await breakIt(event.id);

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
    expect(read?.instance_host).toBeNull();
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
    // The password is judged by what it needs (a password nobody set), not by a list of enabled ways in.
    const refused = await put(event.id, { mode: "automatic", access_methods: ["password"] });
    const allowed = await put(event.id, { mode: "automatic", access_methods: ["link"] });

    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: "registration_not_ready", blockers: ["password"] });
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

    const res = await put(event.id, { access_methods: ["password"] });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "registration_not_ready", blockers: ["password"] });
    expect(await settingsRow(event.id)).toMatchObject({ mode: "automatic", access_methods: ["link"] });
    expect(await auditOf(event.id)).toHaveLength(0);
  });

  it("is let through when the new way in is ready", async () => {
    const event = await addEvent("on-password-set", { settings: { mode: "automatic" } });
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
    expect(entry).toMatchObject({ organization_id: ORG, actor_user_id: superadminId, action_type: "registration_settings_changed" });
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

describe("the switch for the styled boxes of the guest form, which is gone", () => {
  it("is not part of what a read says, and the table has no column for it", async () => {
    const event = await addEvent("styled-gone");

    expect(await dto(await get(event.id))).not.toHaveProperty("styled_form_controls");
    expect(await settingsRow(event.id)).not.toHaveProperty("styled_form_controls");
  });

  it("is refused as a key that is not a setting, and nothing is saved or audited", async () => {
    const event = await addEvent("styled-refused");

    const res = await put(event.id, { styled_form_controls: true, ask_department: true });

    expect(res.status).toBe(400);
    expect((await settingsRow(event.id))?.ask_department).toBe(false);
    expect(await auditOf(event.id)).toHaveLength(0);
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

describe("the company sign-in as the way in, and its restriction to one company (D-C4)", () => {
  const PROVIDER = "reg118a-idp";

  /** The enabled provider the events below choose (made again by every test: one of them deletes it). */
  const installCompanyProvider = () => {
    const data = {
      issuer: "https://idp.example.com/",
      client_id: "reg118a-client",
      authorization_endpoint: "https://idp.example.com/authorize",
      token_endpoint: "https://idp.example.com/token",
      jwks_uri: "https://idp.example.com/jwks",
      display_name: "Company IdP",
      enabled: true,
    };
    return prisma.identityProvider.upsert({ where: { id: PROVIDER }, create: { id: PROVIDER, ...data }, update: data });
  };

  afterAll(async () => {
    await prisma.identityProvider.deleteMany({ where: { id: PROVIDER } });
  });

  beforeEach(async () => {
    await installCompanyProvider();
  });

  const claim = { sso_claim_name: "tid", sso_claim_values: ["tenant-a", "tenant-b"] };

  it("is a way in an event can choose; it is ready with no Turnstile keys, and its list holds the identity provider and not the bot check", async () => {
    await prisma.systemSettings.deleteMany({ where: { key: TURNSTILE_SETTINGS_KEY } });
    const event = await addEvent("sso-ready");

    const res = await put(event.id, { access_methods: ["sso"], sso_provider_id: PROVIDER, mode: "automatic" });
    const body = await dto(res);

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ mode: "automatic", access_methods: ["sso"], sso_provider_id: PROVIDER });
    expect(body.readiness.map((check) => check.key)).toEqual(
      READINESS_KEYS.filter((key) => key !== "password" && key !== "bot_protection" && key !== "bot_protection_not_used"),
    );
    expect(body.readiness.every((check) => check.ok)).toBe(true);
    expect((await settingsRow(event.id))?.access_methods).toEqual(["sso"]);
  });

  it("is not ready while the event has chosen no provider, and the answer names the one key and nothing else", async () => {
    const event = await addEvent("sso-no-provider");

    const res = await put(event.id, { access_methods: ["sso"], mode: "approval" });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "registration_not_ready", blockers: ["identity_provider"] });
    expect((await settingsRow(event.id))?.mode).toBeNull();
  });

  it("is not ready once the provider the event chose was switched off or deleted, while another provider is enabled", async () => {
    await prisma.identityProvider.create({
      data: {
        id: "reg118a-other",
        issuer: "https://other.example.com/",
        client_id: "reg118a-other",
        authorization_endpoint: "https://other.example.com/authorize",
        token_endpoint: "https://other.example.com/token",
        jwks_uri: "https://other.example.com/jwks",
        display_name: "Other IdP",
        enabled: true,
      },
    });
    try {
      const event = await addEvent("sso-provider-gone", { settings: { access_methods: ["sso"], sso_provider_id: PROVIDER } });
      const notReady = { error: "registration_not_ready", blockers: ["identity_provider"] };

      await prisma.identityProvider.update({ where: { id: PROVIDER }, data: { enabled: false } });
      const off = await put(event.id, { mode: "approval" });
      expect(off.status).toBe(409);
      expect(await off.json()).toEqual(notReady);
      expect(await dto(await get(event.id))).toMatchObject({ sso_provider: { id: PROVIDER, state: "disabled", display_name: "Company IdP" } });

      await prisma.identityProvider.update({ where: { id: PROVIDER }, data: { enabled: true } });
      await prisma.identityProvider.delete({ where: { id: PROVIDER } });
      const gone = await put(event.id, { mode: "approval" });
      expect(gone.status).toBe(409);
      expect(await gone.json()).toEqual(notReady);
      expect(await dto(await get(event.id))).toMatchObject({ sso_provider_id: null, sso_provider: null });
      expect((await settingsRow(event.id))?.mode).toBeNull();
    } finally {
      await prisma.identityProvider.delete({ where: { id: "reg118a-other" } });
      await installCompanyProvider();
    }
  });

  it("saves the restriction, says it back, and audits the claim and the values that may register", async () => {
    const event = await addEvent("sso-claim");

    const res = await put(event.id, { access_methods: ["sso"], ...claim }, cookies.superadmin);
    const body = await dto(res);

    expect(res.status).toBe(200);
    expect(body).toMatchObject(claim);
    expect(await settingsRow(event.id)).toMatchObject({ access_methods: ["sso"], ...claim });
    expect(await dto(await get(event.id))).toMatchObject(claim);
    const [entry] = await auditOf(event.id);
    expect(entry?.metadata).toMatchObject({
      fields_changed: ["access_methods", "sso_claim_name", "sso_claim_values"],
      access_methods: ["sso"],
      ...claim,
    });
  });

  it("keeps a value that is given twice once, in the order it came", async () => {
    const event = await addEvent("sso-claim-twice");

    const body = await dto(await put(event.id, { access_methods: ["sso"], sso_claim_name: "tid", sso_claim_values: ["b", "a", "b"] }, cookies.superadmin));

    expect(body.sso_claim_values).toEqual(["b", "a"]);
  });

  it("changes the restriction of an event that has the sign-in, and removes it with null and an empty list", async () => {
    const event = await addEvent("sso-claim-change", { settings: { access_methods: ["sso"], ...claim } });

    const changed = await dto(await put(event.id, { sso_claim_name: "groups", sso_claim_values: ["staff"] }, cookies.superadmin));
    const removed = await dto(await put(event.id, { sso_claim_name: null, sso_claim_values: [] }, cookies.superadmin));

    expect(changed).toMatchObject({ sso_claim_name: "groups", sso_claim_values: ["staff"] });
    expect(removed).toMatchObject({ sso_claim_name: null, sso_claim_values: [] });
    expect(await settingsRow(event.id)).toMatchObject({ sso_claim_name: null, sso_claim_values: [] });
    expect((await auditOf(event.id)).map((row) => (row.metadata as { fields_changed: string[] }).fields_changed)).toEqual([
      ["sso_claim_name", "sso_claim_values"],
      ["sso_claim_name", "sso_claim_values"],
    ]);
  });

  it("refuses a restriction for an event whose way in is not the company sign-in: 422, nothing saved, nothing audited", async () => {
    const event = await addEvent("sso-claim-link");

    const onLink = await put(event.id, claim);
    const withLink = await put(event.id, { access_methods: ["link"], ...claim });
    const withPassword = await put(event.id, { access_methods: ["password"], ...claim });

    for (const res of [onLink, withLink, withPassword]) {
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ error: "sso_claim_needs_sso" });
    }
    expect(await settingsRow(event.id)).toMatchObject({ access_methods: ["link"], sso_claim_name: null, sso_claim_values: [] });
    expect(await auditOf(event.id)).toHaveLength(0);
  });

  it("takes the restriction away with the move away from the sign-in, and does not bring it back with the move back", async () => {
    const event = await addEvent("sso-claim-away", { settings: { access_methods: ["sso"], ...claim } });

    const away = await dto(await put(event.id, { access_methods: ["link"] }));
    const back = await dto(await put(event.id, { access_methods: ["sso"] }));

    expect(away).toMatchObject({ access_methods: ["link"], sso_claim_name: null, sso_claim_values: [] });
    expect(back).toMatchObject({ access_methods: ["sso"], sso_claim_name: null, sso_claim_values: [] });
    expect(await settingsRow(event.id)).toMatchObject({ sso_claim_name: null, sso_claim_values: [] });
    const [awayEntry] = await auditOf(event.id).then((rows) => rows.map((row) => row.metadata as Record<string, unknown>));
    expect(awayEntry).toMatchObject({
      fields_changed: ["access_methods", "sso_claim_name", "sso_claim_values"],
      sso_claim_name: null,
      sso_claim_values: [],
    });
  });

  it("saves nothing, and audits nothing, when the restriction is as it was", async () => {
    const event = await addEvent("sso-claim-same", { settings: { access_methods: ["sso"], ...claim } });

    const res = await put(event.id, { sso_claim_name: "tid", sso_claim_values: ["tenant-a", "tenant-b"] });

    expect(res.status).toBe(200);
    expect(await auditOf(event.id)).toHaveLength(0);
  });

  it("does not need the event to be ready to change the restriction of one that has registration on", async () => {
    const event = await addEvent("sso-claim-on", { settings: { access_methods: ["sso"], mode: "automatic" } });
    await prisma.identityProvider.update({ where: { id: PROVIDER }, data: { enabled: false } });
    try {
      const res = await put(event.id, claim, cookies.superadmin);

      expect(res.status).toBe(200);
      expect(await settingsRow(event.id)).toMatchObject(claim);
    } finally {
      await prisma.identityProvider.update({ where: { id: PROVIDER }, data: { enabled: true } });
    }
  });

  it("is held together by the table too: a claim with no values, and values with no claim, cannot be written", async () => {
    const event = await addEvent("sso-claim-half", { settings: { access_methods: ["sso"] } });

    await expect(
      prisma.eventRegistrationSettings.update({ where: { event_id: event.id }, data: { sso_claim_name: "tid" } }),
    ).rejects.toThrow("EventRegistrationSettings_sso_claim_pair_check");
    await expect(
      prisma.eventRegistrationSettings.update({ where: { event_id: event.id }, data: { sso_claim_values: ["tenant-a"] } }),
    ).rejects.toThrow("EventRegistrationSettings_sso_claim_pair_check");
    expect(await settingsRow(event.id)).toMatchObject({ sso_claim_name: null, sso_claim_values: [] });
  });
});

describe("who may change the restriction of the company sign-in (A3)", () => {
  const claim = { sso_claim_name: "tid", sso_claim_values: ["tenant-a", "tenant-b"] };
  const none = { sso_claim_name: null, sso_claim_values: [] };
  const asAdmin = (eventId: string, body: unknown) => put(eventId, body, cookies.admin);
  // Registration stays off in these events, so none of it waits for the provider to be set up.
  const withClaim = (label: string) => addEvent(label, { settings: { access_methods: ["sso"], ...claim } });

  it("refuses an administrator who sets a restriction with the move to the company sign-in: 403 (the way in is the first thing refused), nothing saved, nothing audited", async () => {
    const event = await addEvent("a3-set");

    const res = await asAdmin(event.id, { access_methods: ["sso"], ...claim });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "access_method_superadmin_only" });
    expect(await settingsRow(event.id)).toMatchObject({ access_methods: ["link"], ...none });
    expect(await auditOf(event.id)).toHaveLength(0);
  });

  it("refuses an administrator who changes or removes the restriction that is there, and keeps it", async () => {
    const event = await withClaim("a3-change");

    const changed = await asAdmin(event.id, { sso_claim_name: "groups", sso_claim_values: ["staff"] });
    const widened = await asAdmin(event.id, { sso_claim_name: "tid", sso_claim_values: ["tenant-a", "tenant-b", "tenant-c"] });
    const renamed = await asAdmin(event.id, { sso_claim_name: "groups", sso_claim_values: claim.sso_claim_values });
    const removed = await asAdmin(event.id, none);

    for (const res of [changed, widened, renamed, removed]) {
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "sso_claim_superadmin_only" });
    }
    expect(await settingsRow(event.id)).toMatchObject(claim);
    expect(await auditOf(event.id)).toHaveLength(0);
  });

  it("refuses the claim together with another change, and saves none of it", async () => {
    const event = await withClaim("a3-together");

    const res = await asAdmin(event.id, { waitlist_enabled: false, sso_claim_name: "tid", sso_claim_values: ["other"] });

    expect(res.status).toBe(403);
    expect(await settingsRow(event.id)).toMatchObject({ waitlist_enabled: true, ...claim });
  });

  it("lets an administrator save other settings of an event that has a restriction, with no word of it or with it as it is", async () => {
    const event = await withClaim("a3-other");

    const without = await asAdmin(event.id, { waitlist_enabled: false });
    const same = await asAdmin(event.id, { ask_company: true, sso_claim_name: "tid", sso_claim_values: ["tenant-b", "tenant-a"] });

    expect(without.status).toBe(200);
    // The same two values in another order are the same restriction.
    expect(same.status).toBe(200);
    expect(await settingsRow(event.id)).toMatchObject({ waitlist_enabled: false, ask_company: true, sso_claim_name: "tid" });
    expect((await settingsRow(event.id))?.sso_claim_values).toEqual(expect.arrayContaining(claim.sso_claim_values));
  });

  it("lets a superadmin move to the company sign-in with no restriction, and away from it, which takes the restriction away", async () => {
    const plain = await addEvent("a3-move-in");
    const restricted = await withClaim("a3-move-out");

    const into = await put(plain.id, { access_methods: ["sso"], ...none });
    const away = await put(restricted.id, { access_methods: ["link"] });

    expect(into.status).toBe(200);
    expect(away.status).toBe(200);
    expect(await settingsRow(plain.id)).toMatchObject({ access_methods: ["sso"], ...none });
    expect(await settingsRow(restricted.id)).toMatchObject({ access_methods: ["link"], ...none });
  });

  it("lets a superadmin set, change and remove it", async () => {
    const event = await addEvent("a3-super");

    const set = await put(event.id, { access_methods: ["sso"], ...claim }, cookies.superadmin);
    const changed = await put(event.id, { sso_claim_name: "groups", sso_claim_values: ["staff"] }, cookies.superadmin);
    const removed = await put(event.id, none, cookies.superadmin);

    expect([set.status, changed.status, removed.status]).toEqual([200, 200, 200]);
    expect(await settingsRow(event.id)).toMatchObject(none);
    expect(await auditOf(event.id)).toHaveLength(3);
  });

  it("answers an administrator who is not of the event with the same 403 as before, and an operator too", async () => {
    const event = await withClaim("a3-others");

    for (const cookie of [cookies.otherAdmin, cookies.operator]) {
      const res = await put(event.id, { sso_claim_name: "x", sso_claim_values: ["y"] }, cookie);
      expect(res.status).toBe(403);
      expect(await res.json()).not.toEqual({ error: "sso_claim_superadmin_only" });
    }
  });

  it("refuses a caller of the function who does not say that they may, and allows one who does", async () => {
    const event = await withClaim("a3-function");
    const patch = { sso_claim_name: "groups", sso_claim_values: ["staff"] };

    const left = await updateEventRegistrationSettings(prisma, { eventId: event.id, patch, actor: actorOf(adminId) });
    const allowed = await updateEventRegistrationSettings(prisma, { eventId: event.id, patch, actor: actorOf(superadminId), canChangeSsoClaim: true });

    expect(left.kind).toBe("sso_claim_superadmin_only");
    expect(allowed.kind).toBe("saved");
  });
});

describe("the identity provider of an event with the company sign-in", () => {
  const PROVIDER = "reg-sso-a-idp";
  const SECOND = "reg-sso-a-second";
  const OFF = "reg-sso-a-off";
  const NOT_OIDC = "reg-sso-a-cf";
  const claim = { sso_claim_name: "tid", sso_claim_values: ["tenant-a"] };
  const ISSUER = "https://login.microsoftonline.com/tenant-guid/v2.0";

  const makeProvider = (id: string, extra: { enabled?: boolean; provider_type?: string } = {}) =>
    prisma.identityProvider.create({
      data: {
        id,
        issuer: id === PROVIDER ? ISSUER : `https://${id}.example.com/`,
        client_id: `${id}-client`,
        authorization_endpoint: `https://${id}.example.com/authorize`,
        token_endpoint: `https://${id}.example.com/token`,
        jwks_uri: `https://${id}.example.com/jwks`,
        display_name: `Name of ${id}`,
        enabled: true,
        ...extra,
      },
    });

  beforeEach(async () => {
    await prisma.identityProvider.deleteMany({ where: { id: { in: [PROVIDER, SECOND, OFF, NOT_OIDC] } } });
    await makeProvider(PROVIDER);
    await makeProvider(SECOND);
    await makeProvider(OFF, { enabled: false });
    await makeProvider(NOT_OIDC, { provider_type: "cloudflare_access" });
  });

  afterAll(async () => {
    await prisma.identityProvider.deleteMany({ where: { id: { in: [PROVIDER, SECOND, OFF, NOT_OIDC] } } });
  });

  const providerOf = async (eventId: string) => (await settingsRow(eventId))?.sso_provider_id ?? null;

  it("is saved with the move to the company sign-in, said back with its name and kind, and audited by id", async () => {
    const event = await addEvent("idp-save");

    const res = await put(event.id, { access_methods: ["sso"], sso_provider_id: PROVIDER });
    const body = await dto(res);

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      sso_provider_id: PROVIDER,
      sso_provider: { id: PROVIDER, state: "ready", display_name: `Name of ${PROVIDER}`, kind: "entra" },
    });
    expect(await providerOf(event.id)).toBe(PROVIDER);
    const [entry] = await auditOf(event.id);
    expect(entry?.metadata).toMatchObject({ fields_changed: ["access_methods", "sso_provider_id"], sso_provider_id: PROVIDER });
  });

  it("offers an organiser the enabled OIDC providers, by id, name and kind, and no endpoint, client, secret or issuer", async () => {
    const event = await addEvent("idp-list");

    const text = JSON.stringify(await (await get(event.id)).json());
    const body = JSON.parse(text) as RegistrationSettingsDto;

    expect(body.sso_providers.filter((provider) => provider.id.startsWith("reg-sso-a-")).map((provider) => provider.id).sort()).toEqual([PROVIDER, SECOND]);
    expect(body.sso_providers.find((provider) => provider.id === PROVIDER)).toEqual({ id: PROVIDER, display_name: `Name of ${PROVIDER}`, kind: "entra" });
    for (const secret of [ISSUER, "tenant-guid", "-client", "/authorize", "/jwks", "client_secret"]) expect(text).not.toContain(secret);
  });

  it.each([
    ["one that does not exist", "reg-sso-a-nobody"],
    ["one that is switched off", OFF],
    ["one that is not an OIDC provider", NOT_OIDC],
  ])("refuses %s with 422, saves nothing and audits nothing", async (_label, id) => {
    const event = await addEvent("idp-refused");

    const res = await put(event.id, { access_methods: ["sso"], sso_provider_id: id });

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "sso_provider_not_available" });
    expect(await settingsRow(event.id)).toMatchObject({ access_methods: ["link"], sso_provider_id: null });
    expect(await auditOf(event.id)).toHaveLength(0);
  });

  it("refuses a provider for an event whose way in is another, in the same request or already: 422, and null is no change", async () => {
    const event = await addEvent("idp-needs-sso");

    for (const body of [{ sso_provider_id: PROVIDER }, { access_methods: ["password"], sso_provider_id: PROVIDER }]) {
      const res = await put(event.id, body);
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ error: "sso_provider_needs_sso" });
    }
    const none = await put(event.id, { sso_provider_id: null });
    expect(none.status).toBe(200);
    expect(await auditOf(event.id)).toHaveLength(0);
  });

  it("clears the provider with the move away from the company sign-in, and does not bring it back with the move back", async () => {
    const event = await addEvent("idp-away", { settings: { access_methods: ["sso"], sso_provider_id: PROVIDER } });

    const away = await dto(await put(event.id, { access_methods: ["link"] }));
    const back = await dto(await put(event.id, { access_methods: ["sso"] }));

    expect(away).toMatchObject({ access_methods: ["link"], sso_provider_id: null, sso_provider: null });
    expect(back).toMatchObject({ access_methods: ["sso"], sso_provider_id: null, sso_provider: null });
    const [entry] = await auditOf(event.id);
    expect(entry?.metadata).toMatchObject({ fields_changed: ["access_methods", "sso_provider_id"], sso_provider_id: null });
  });

  it("removes the choice with null, and moves it to another provider, as a change of the event", async () => {
    const event = await addEvent("idp-change", { settings: { access_methods: ["sso"], sso_provider_id: PROVIDER } });

    expect((await dto(await put(event.id, { sso_provider_id: SECOND }))).sso_provider_id).toBe(SECOND);
    expect((await dto(await put(event.id, { sso_provider_id: null }))).sso_provider).toBeNull();
    expect(await providerOf(event.id)).toBeNull();
    expect((await auditOf(event.id)).map((row) => (row.metadata as { sso_provider_id: unknown }).sso_provider_id)).toEqual([SECOND, null]);
  });

  it("saves nothing, and audits nothing, when the provider is as it was, and lets a provider that was switched off since stay", async () => {
    const event = await addEvent("idp-same", { settings: { access_methods: ["sso"], sso_provider_id: PROVIDER } });
    await prisma.identityProvider.update({ where: { id: PROVIDER }, data: { enabled: false } });

    const same = await put(event.id, { sso_provider_id: PROVIDER, waitlist_enabled: false });

    expect(same.status).toBe(200);
    expect(await dto(same)).toMatchObject({ sso_provider: { id: PROVIDER, state: "disabled" } });
    expect((await auditOf(event.id)).map((row) => (row.metadata as { fields_changed: string[] }).fields_changed)).toEqual([["waitlist_enabled"]]);
  });

  it("counts as a change of the way in for an event that has registration on: it must be ready, and other changes are not held up", async () => {
    const event = await addEvent("idp-on", { settings: { mode: "automatic", access_methods: ["sso"], sso_provider_id: PROVIDER } });
    await setMail(false);
    try {
      const held = await put(event.id, { sso_provider_id: SECOND });
      expect(held.status).toBe(409);
      expect(await held.json()).toEqual({ error: "registration_not_ready", blockers: ["mail_provider"] });
      expect(await providerOf(event.id)).toBe(PROVIDER);

      expect((await put(event.id, { waitlist_enabled: false })).status).toBe(200);
    } finally {
      await setMail(true);
    }
    expect((await put(event.id, { sso_provider_id: SECOND })).status).toBe(200);
    expect(await providerOf(event.id)).toBe(SECOND);
  });

  describe("who may change how guests open the form (the way in, the provider)", () => {
    const technical = (label: string, settings: Record<string, unknown> = {}) =>
      addEvent(label, { settings: { access_methods: ["sso"], sso_provider_id: PROVIDER, ...settings } });

    it("refuses an administrator who changes the way in: 403 `access_method_superadmin_only`, nothing saved, nothing audited", async () => {
      const event = await addEvent("idp-way");

      const res = await put(event.id, { access_methods: ["password"], waitlist_enabled: false }, cookies.admin);

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "access_method_superadmin_only" });
      expect(await settingsRow(event.id)).toMatchObject({ access_methods: ["link"], waitlist_enabled: true });
      expect(await auditOf(event.id)).toHaveLength(0);
    });

    it("refuses an administrator who changes the provider, limited to one company or not: 403 `sso_provider_superadmin_only`, nothing saved", async () => {
      for (const settings of [{}, { sso_claim_name: "tid", sso_claim_values: ["tenant-a"] }]) {
        const event = await technical("idp-admin-provider", settings);

        const moved = await put(event.id, { sso_provider_id: SECOND }, cookies.admin);
        const removed = await put(event.id, { sso_provider_id: null }, cookies.admin);

        for (const res of [moved, removed]) {
          expect(res.status).toBe(403);
          expect(await res.json()).toEqual({ error: "sso_provider_superadmin_only" });
        }
        expect(await providerOf(event.id)).toBe(PROVIDER);
        expect(await auditOf(event.id)).toHaveLength(0);
      }
    });

    it("refuses an administrator who sets the provider with the move to the company sign-in: the way in is refused first", async () => {
      const event = await addEvent("idp-first");

      const res = await put(event.id, { access_methods: ["sso"], sso_provider_id: PROVIDER }, cookies.admin);

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "access_method_superadmin_only" });
    });

    it("lets an administrator send the way in and the provider as they are, and change everything else", async () => {
      const event = await technical("idp-same-values");

      const res = await put(
        event.id,
        { access_methods: ["sso"], sso_provider_id: PROVIDER, waitlist_enabled: false, mode: "automatic", ask_company: true },
        cookies.admin,
      );

      expect(res.status).toBe(200);
      expect(await settingsRow(event.id)).toMatchObject({ mode: "automatic", waitlist_enabled: false, ask_company: true, sso_provider_id: PROVIDER });
    });

    it("lets a superadmin change the way in and the provider, and moves an event away from the company sign-in with the provider", async () => {
      const event = await technical("idp-super");

      expect((await put(event.id, { sso_provider_id: SECOND }, cookies.superadmin)).status).toBe(200);
      expect(await providerOf(event.id)).toBe(SECOND);
      expect((await put(event.id, { access_methods: ["link"] }, cookies.superadmin)).status).toBe(200);
      expect(await settingsRow(event.id)).toMatchObject({ access_methods: ["link"], sso_provider_id: null });
    });
  });

  it.each([
    ["a number", 7],
    ["an empty string", ""],
    ["a very long text", "x".repeat(65)],
    ["a list", [PROVIDER]],
  ])("refuses %s as the provider with 400", async (_label, value) => {
    const event = await addEvent("idp-shape");

    const res = await put(event.id, { access_methods: ["sso"], sso_provider_id: value });

    expect(res.status).toBe(400);
  });

  it("judges the provider as it is in the transaction: switched off after the environment was read, turning registration on is 409", async () => {
    const event = await addEvent("idp-switched-off-meanwhile", { settings: { access_methods: ["sso"], sso_provider_id: PROVIDER } });
    let reads = 0;
    const provider = new Proxy(prisma.identityProvider, {
      get(model, key) {
        if (key !== "findMany") return Reflect.get(model, key);
        return async (args: Parameters<typeof model.findMany>[0]) => {
          const rows = await model.findMany(args);
          reads += 1;
          // The first read is the one of the environment, before the transaction: the provider is switched off right after it.
          if (reads === 1) await model.update({ where: { id: PROVIDER }, data: { enabled: false } });
          return rows;
        };
      },
    });
    const racing = new Proxy(prisma, {
      get(client, key) {
        if (key === "identityProvider") return provider;
        const value: unknown = Reflect.get(client, key);
        return typeof value === "function" ? value.bind(client) : value;
      },
    });

    const result = await updateEventRegistrationSettings(racing, { eventId: event.id, patch: { mode: "automatic" }, actor: actorOf(superadminId) });

    expect(result).toEqual({ kind: "not_ready", blockers: ["identity_provider"] });
    expect((await settingsRow(event.id))?.mode).toBeNull();
  });

  describe("the provider the screen showed (`expected_sso_provider_id`)", () => {
    const withProvider = (label: string) => addEvent(label, { settings: { access_methods: ["sso"], sso_provider_id: PROVIDER } });
    const claim = { sso_claim_name: "tid", sso_claim_values: ["tenant-a"] };

    it("saves when it is the provider the event has, with or without another change", async () => {
      const event = await withProvider("idp-expected-same");

      const res = await put(event.id, { expected_sso_provider_id: PROVIDER, ...claim });

      expect(res.status).toBe(200);
      expect(await settingsRow(event.id)).toMatchObject({ sso_provider_id: PROVIDER, ...claim });
    });

    it("answers 409 `sso_provider_changed` when the event has another provider now, and saves and audits nothing", async () => {
      const event = await withProvider("idp-expected-other");
      await prisma.eventRegistrationSettings.update({ where: { event_id: event.id }, data: { sso_provider_id: SECOND } });

      const res = await put(event.id, { expected_sso_provider_id: PROVIDER, waitlist_enabled: false, ...claim });

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "sso_provider_changed" });
      expect(await settingsRow(event.id)).toMatchObject({ sso_provider_id: SECOND, waitlist_enabled: true, sso_claim_name: null });
      expect(await auditOf(event.id)).toHaveLength(0);
    });

    it("tells a provider from none, both ways", async () => {
      const chosen = await withProvider("idp-expected-null-vs-set");
      const none = await addEvent("idp-expected-none", { settings: { access_methods: ["sso"] } });

      const staleNone = await put(chosen.id, { expected_sso_provider_id: null, waitlist_enabled: false });
      const staleSet = await put(none.id, { expected_sso_provider_id: PROVIDER, waitlist_enabled: false });
      const sameNone = await put(none.id, { expected_sso_provider_id: null, waitlist_enabled: false });

      expect([staleNone.status, staleSet.status, sameNone.status]).toEqual([409, 409, 200]);
      expect(await settingsRow(chosen.id)).toMatchObject({ waitlist_enabled: true });
    });

    it("makes no check when it is left out, and refuses a value that is not an id with 400", async () => {
      const event = await withProvider("idp-expected-absent");

      expect((await put(event.id, { waitlist_enabled: false })).status).toBe(200);
      for (const value of [7, "", "x".repeat(65)]) {
        expect((await put(event.id, { expected_sso_provider_id: value })).status).toBe(400);
      }
    });
  });

  it("keeps the other changes of a save when the provider the event keeps is deleted after the settings were read: 200, and no provider", async () => {
    const event = await addEvent("idp-deleted-meanwhile", { settings: { access_methods: ["sso"], sso_provider_id: PROVIDER } });
    let deleted = false;
    const racing = new Proxy(prisma, {
      get(client, key) {
        if (key !== "$transaction") {
          const value: unknown = Reflect.get(client, key);
          return typeof value === "function" ? value.bind(client) : value;
        }
        return (run: (tx: unknown) => Promise<unknown>, options: unknown) =>
          client.$transaction(
            (tx) =>
              run(
                new Proxy(tx, {
                  get(inner, name) {
                    const value: unknown = Reflect.get(inner, name);
                    if (name !== "eventRegistrationSettings") return typeof value === "function" ? value.bind(inner) : value;
                    // The settings are read (the row, then the password count): the provider is deleted right after, before it is held.
                    return new Proxy(inner.eventRegistrationSettings, {
                      get(model, method) {
                        if (method !== "count") return Reflect.get(model, method);
                        return async (args: Parameters<typeof model.count>[0]) => {
                          const count = await model.count(args);
                          if (!deleted) {
                            deleted = true;
                            await prisma.identityProvider.delete({ where: { id: PROVIDER } });
                          }
                          return count;
                        };
                      },
                    });
                  },
                }),
              ),
            options as never,
          );
      },
    });

    const result = await updateEventRegistrationSettings(racing as PrismaClient, {
      eventId: event.id,
      patch: { waitlist_enabled: false },
      actor: actorOf(superadminId),
    });

    expect(deleted).toBe(true);
    expect(result.kind).toBe("saved");
    expect(result.kind === "saved" ? result.settings : null).toMatchObject({ waitlist_enabled: false, sso_provider_id: null, sso_provider: null });
    expect(await settingsRow(event.id)).toMatchObject({ waitlist_enabled: false, sso_provider_id: null });
    expect((await auditOf(event.id)).map((row) => (row.metadata as { fields_changed: string[] }).fields_changed)).toEqual([["waitlist_enabled"]]);
  });

  it("refuses a delete of the provider while a save that chose it is under way, instead of failing the write on its key", async () => {
    const event = await addEvent("idp-race");
    let pending: Promise<Response> | null = null;
    await prisma.$transaction(async (tx) => {
      await tx.identityProvider.delete({ where: { id: PROVIDER } });
      pending = Promise.resolve(put(event.id, { access_methods: ["sso"], sso_provider_id: PROVIDER }));
      // The save finds the provider (the delete is not committed) and waits for the lock on it.
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    const res = await pending!;

    // The delete went through and the save, which waited for it, found the provider gone: a 422, never "no such event".
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "sso_provider_not_available" });
  });
});

describe("the answer no longer lists enabled ways in", () => {
  it("has no enabled_access_methods: link, password and Company SSO are always offered", async () => {
    const event = await addEvent("a3-enabled");

    expect(Object.keys(await dto(await get(event.id)))).not.toContain("enabled_access_methods");
  });
});

describe("whether the bot check is used, in the answer (A3)", () => {
  afterEach(async () => {
    await setBotProtectionMode(prisma, "required");
  });

  it.each(["required", "not_used"] as const)("says %s as a superadmin set it, on a read and on a save", async (mode) => {
    await setBotProtectionMode(prisma, mode);
    const event = await addEvent("a3-bot");

    expect((await dto(await get(event.id))).bot_protection).toBe(mode);
    expect((await dto(await put(event.id, { waitlist_enabled: false }))).bot_protection).toBe(mode);
  });
});

describe("the bot check of one event (bot_protection_enabled)", () => {
  afterEach(async () => {
    await setBotProtectionMode(prisma, "required");
    await seeder.setSystemKeys(true);
  });

  it("is on for an event that exists, and for one with no settings row", async () => {
    const event = await addEvent("bp-default");
    const bare = await addEvent("bp-bare", { settings: null });

    expect((await dto(await get(event.id))).bot_protection_enabled).toBe(true);
    expect((await dto(await get(bare.id))).bot_protection_enabled).toBe(true);
    expect((await settingsRow(event.id))?.bot_protection_enabled).toBe(true);
    expect(defaultSettings().bot_protection_enabled).toBe(true);
  });

  it("is turned off by a superadmin, says so in the answer, and is audited by name and value like any other setting", async () => {
    const event = await addEvent("bp-off");

    const res = await put(event.id, { bot_protection_enabled: false });

    expect(res.status).toBe(200);
    expect(await dto(res)).toMatchObject({ bot_protection_enabled: false, bot_protection: "required" });
    expect((await settingsRow(event.id))?.bot_protection_enabled).toBe(false);
    expect((await dto(await get(event.id))).bot_protection_enabled).toBe(false);
    const audit = await auditOf(event.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.metadata).toMatchObject({ fields_changed: ["bot_protection_enabled"], bot_protection_enabled: false });
  });

  it("is refused to an administrator who changes it: 403 `bot_protection_superadmin_only`, nothing saved, nothing audited", async () => {
    const event = await addEvent("bp-admin");

    const res = await put(event.id, { bot_protection_enabled: false, waitlist_enabled: false }, cookies.admin);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "bot_protection_superadmin_only" });
    expect(await settingsRow(event.id)).toMatchObject({ bot_protection_enabled: true, waitlist_enabled: true });
    expect(await auditOf(event.id)).toHaveLength(0);
  });

  it("lets an administrator send the value that is there, and change the other settings", async () => {
    const event = await addEvent("bp-admin-same", { settings: { bot_protection_enabled: false } });

    const same = await put(event.id, { bot_protection_enabled: false, waitlist_enabled: false }, cookies.admin);

    expect(same.status).toBe(200);
    expect(await settingsRow(event.id)).toMatchObject({ bot_protection_enabled: false, waitlist_enabled: false });
  });

  it("refuses a value that is not a boolean, and an unknown field next to it, and writes nothing", async () => {
    const event = await addEvent("bp-invalid");

    for (const body of [{ bot_protection_enabled: "false" }, { bot_protection_enabled: null }, { bot_protection_enabled: 0 }]) {
      expect((await put(event.id, body)).status).toBe(400);
    }
    expect((await settingsRow(event.id))?.bot_protection_enabled).toBe(true);
  });

  it("turns off for an event that is running without being judged ready: turning a check off never shuts a form", async () => {
    const event = await addEvent("bp-off-running", { settings: { mode: "automatic" } });
    await prisma.systemSettings.deleteMany({ where: { key: TURNSTILE_SETTINGS_KEY } });

    const res = await put(event.id, { bot_protection_enabled: false });

    expect(res.status).toBe(200);
    expect((await settingsRow(event.id))?.bot_protection_enabled).toBe(false);
  });

  it("turns on for a running event only when the keys are saved: 409 `registration_not_ready` with `bot_protection` otherwise", async () => {
    const event = await addEvent("bp-on-running", { settings: { mode: "automatic", bot_protection_enabled: false } });
    await prisma.systemSettings.deleteMany({ where: { key: TURNSTILE_SETTINGS_KEY } });

    const refused = await put(event.id, { bot_protection_enabled: true });

    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: "registration_not_ready", blockers: ["bot_protection"] });
    expect((await settingsRow(event.id))?.bot_protection_enabled).toBe(false);

    await seeder.setSystemKeys(true);
    const allowed = await put(event.id, { bot_protection_enabled: true });
    expect(allowed.status).toBe(200);
    expect((await settingsRow(event.id))?.bot_protection_enabled).toBe(true);
  });

  it("turns on for an event whose registration is off without any judgement", async () => {
    const event = await addEvent("bp-on-off-event", { settings: { mode: null, bot_protection_enabled: false } });
    await prisma.systemSettings.deleteMany({ where: { key: TURNSTILE_SETTINGS_KEY } });

    expect((await put(event.id, { bot_protection_enabled: true })).status).toBe(200);
  });

  it("makes the check an information row, not a blocker, when the event switched it off, with no keys saved", async () => {
    const event = await addEvent("bp-info", { settings: { bot_protection_enabled: false } });
    await prisma.systemSettings.deleteMany({ where: { key: TURNSTILE_SETTINGS_KEY } });

    const body = await dto(await get(event.id));

    expect(body.readiness).toContainEqual({ key: "bot_protection_not_used", ok: true });
    expect(body.readiness.map((check) => check.key)).not.toContain("bot_protection");
    // The organisation's own switch is told apart: the answer still says it is on.
    expect(body.bot_protection).toBe("required");
  });

  it("keeps saying what the organisation's switch is, so a screen can hide the event's switch while it is off", async () => {
    await setBotProtectionMode(prisma, "not_used");
    const event = await addEvent("bp-org-off");

    expect(await dto(await get(event.id))).toMatchObject({ bot_protection: "not_used", bot_protection_enabled: true });
  });
});
