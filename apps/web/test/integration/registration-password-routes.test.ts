import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { verifyPassword } from "@admitto/auth";
import type { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { REGISTRATION_PASSWORD_MAX, REGISTRATION_PASSWORD_MIN } from "@admitto/shared";
import { MAX_REGISTRATION_PASSWORD_BODY_BYTES } from "../../src/admin/registration-password-routes.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { enrollConfirmedTotp } from "../helpers/enroll-confirmed-totp.js";
import { sessionCookieFor } from "../helpers/session-cookie.js";

/**
 * `PUT` and `DELETE /api/admin/events/:eventId/registration/password`, against a real database through the real app: who
 * may call them, what a password must look like, that it is stored only as an argon2id hash and never comes back, that
 * the audit entry says what happened and nothing of the password, and that a change touches no registration.
 */
const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };

const ORG_A = "org-reg111-routes-a";
const ORG_B = "org-reg111-routes-b";
const EVENT_A = "evt-reg111-routes-a";
const EVENT_B = "evt-reg111-routes-b";
const EVENT_ARCHIVED = "evt-reg111-routes-archived";
const EVENT_BARE = "evt-reg111-routes-bare";
const EVENT_IDS = [EVENT_A, EVENT_B, EVENT_ARCHIVED, EVENT_BARE];

const EMAILS = {
  adminA: "reg111-admin-a@example.com",
  adminB: "reg111-admin-b@example.com",
  operator: "reg111-operator@example.com",
  superadmin: "reg111-super@example.com",
};

const PASSWORD = "test-password";
const NEXT = "next-test-password";
const METHODS = ["PUT", "DELETE"] as const;
type Method = (typeof METHODS)[number];

let prisma: PrismaClient;
let app: ReturnType<typeof buildTestApp>;
const cookies = { adminA: "", adminB: "", operator: "", superadmin: "" };
const users = { adminA: "" };

/** A fresh app has a fresh rate limit store, so a test never spends the budget of another. */
const freshApp = () => buildTestApp({ prisma, checkinToken: "reg111-routes-checkin-token-32!!", adminDistRoot });

async function wipeAll(client: PrismaClient): Promise<void> {
  await client.registration.deleteMany({ where: { event_id: { in: EVENT_IDS } } });
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
      { id: ORG_A, name: "Password Org A", slug: "reg111-org-a" },
      { id: ORG_B, name: "Password Org B", slug: "reg111-org-b" },
    ],
  });
  const event = (id: string, orgId: string, extra: Record<string, unknown> = {}) => ({
    id,
    title: `Password ${id}`,
    slug: id,
    date: new Date("2099-10-01"),
    organization_id: orgId,
    ...extra,
  });
  await client.event.createMany({
    data: [
      event(EVENT_A, ORG_A),
      event(EVENT_B, ORG_B),
      event(EVENT_ARCHIVED, ORG_A, { archived_at: new Date() }),
      event(EVENT_BARE, ORG_A),
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
  // Settings rows exist only for the events a test gives one; the audit entries are the test's own.
  await prisma.registration.deleteMany({ where: { event_id: { in: EVENT_IDS } } });
  await prisma.eventRegistrationSettings.deleteMany({ where: { event_id: { in: EVENT_IDS } } });
  await prisma.adminAuditLog.deleteMany({ where: { organization_id: { in: [ORG_A, ORG_B] } } });
  app = freshApp();
});

afterAll(async () => {
  if (prisma) await wipeAll(prisma);
  await prisma?.$disconnect();
});

const path = (eventId: string) => `/api/admin/events/${eventId}/registration/password`;

async function call(
  method: Method,
  body: unknown,
  init: { eventId?: string; cookie?: string; headers?: Record<string, string>; application?: ReturnType<typeof buildTestApp> } = {},
): Promise<Response> {
  const { eventId = EVENT_A, cookie = cookies.adminA, headers = sameOrigin, application = app } = init;
  return await application.request(path(eventId), {
    method,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers, "Content-Type": "application/json" },
    ...(method === "PUT" ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  });
}

const put = (password: unknown, init: Parameters<typeof call>[2] = {}) => call("PUT", { password }, init);
const remove = (init: Parameters<typeof call>[2] = {}) => call("DELETE", undefined, init);
const hashOf = async (eventId = EVENT_A) => (await prisma.eventRegistrationSettings.findUnique({ where: { event_id: eventId } }))?.password_hash;
const auditOf = (eventId = EVENT_A) =>
  prisma.adminAuditLog.findMany({
    where: { organization_id: ORG_A, action_type: "registration_password_changed", metadata: { path: ["event_id"], equals: eventId } },
    orderBy: { created_at: "asc" },
  });

describe("who may set or switch off the password", () => {
  it.each(METHODS)("%s: an unauthenticated caller gets 401 and nothing changes", async (method) => {
    expect((await call(method, { password: PASSWORD }, { cookie: "" })).status).toBe(401);
    expect(await hashOf()).toBeUndefined();
    expect(await auditOf()).toEqual([]);
  });

  it.each(METHODS)("%s: an operator of the event, and an admin of another organisation, get 403 and change nothing", async (method) => {
    await put(PASSWORD);
    const before = await hashOf();

    for (const cookie of [cookies.operator, cookies.adminB]) {
      const res = await call(method, { password: NEXT }, { cookie, application: freshApp() });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "forbidden" });
    }

    expect(await hashOf()).toBe(before);
    expect(await auditOf()).toHaveLength(1);
  });

  it.each(METHODS)("%s: an admin of the organisation and a superadmin may", async (method) => {
    for (const cookie of [cookies.adminA, cookies.superadmin]) {
      const res = await call(method, { password: PASSWORD }, { cookie, application: freshApp() });
      expect(res.status).toBe(204);
      expect(await res.text()).toBe("");
    }
  });

  it.each(METHODS)("%s: answers 404 for an event that does not exist to a superadmin, and 403 to anyone else", async (method) => {
    const asSuperadmin = await call(method, { password: PASSWORD }, { eventId: "no-such-event", cookie: cookies.superadmin });
    expect(asSuperadmin.status).toBe(404);
    expect(await asSuperadmin.json()).toEqual({ error: "not_found" });
    expect((await call(method, { password: PASSWORD }, { eventId: "no-such-event", cookie: cookies.adminA })).status).toBe(403);
    expect(await prisma.adminAuditLog.count({ where: { action_type: "registration_password_changed", organization_id: ORG_A } })).toBe(0);
  });

  it.each(METHODS)("%s: refuses a cross-site request before it reads anything", async (method) => {
    const res = await call(method, { password: PASSWORD }, { headers: { Origin: "https://evil.example" } });
    expect(res.status).toBe(403);
    expect(await hashOf()).toBeUndefined();
  });

  it.each(METHODS)("%s: refuses an archived event, which is read-only", async (method) => {
    const res = await call(method, { password: PASSWORD }, { eventId: EVENT_ARCHIVED });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ code: "event_archived" });
    expect(await hashOf(EVENT_ARCHIVED)).toBeUndefined();
  });
});

describe("what a password must look like", () => {
  it("answers 400 for a body that is not JSON", async () => {
    const res = await call("PUT", "{ not json");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_json" });
  });

  it("refuses a body that is not exactly one text under `password`", async () => {
    const bad: unknown[] = [{}, { password: null }, { password: 12_345_678 }, { password: ["test-password"] }, { password: PASSWORD, extra: true }, [], '"text"', null];
    for (const body of bad) {
      const res = await call("PUT", body, { application: freshApp() });
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await res.json()).toEqual({ error: "validation_failed" });
    }
    expect(await hashOf()).toBeUndefined();
  });

  it("takes 8 to 128 characters, counted as characters and not as bytes or UTF-16 units", async () => {
    const emoji = String.fromCodePoint(0x1f600);
    const refused = ["x".repeat(REGISTRATION_PASSWORD_MIN - 1), "", emoji.repeat(7), "x".repeat(REGISTRATION_PASSWORD_MAX + 1), emoji.repeat(REGISTRATION_PASSWORD_MAX + 1), "y".repeat(3000)];
    for (const password of refused) {
      const res = await put(password, { application: freshApp() });
      expect(res.status, `${password.length} units`).toBe(400);
      expect(await res.json()).toEqual({ error: "registration_password_length" });
    }
    expect(await hashOf()).toBeUndefined();

    for (const password of ["x".repeat(REGISTRATION_PASSWORD_MIN), "x".repeat(REGISTRATION_PASSWORD_MAX), emoji.repeat(REGISTRATION_PASSWORD_MIN), emoji.repeat(REGISTRATION_PASSWORD_MAX)]) {
      expect((await put(password, { application: freshApp() })).status).toBe(204);
    }
  });

  it("has no other rule: no mix of characters, and a space is a character, at either end too", async () => {
    for (const password of ["        ", "aaaaaaaa", "12345678", "  two  spaced words  "]) {
      expect((await put(password, { application: freshApp() })).status, password).toBe(204);
      expect(await verifyPassword(password, (await hashOf())!), password).toBe(true);
      // Taken as typed: the same without its spaces at the ends is not the password.
      if (password.trim() !== password) expect(await verifyPassword(password.trim(), (await hashOf())!)).toBe(false);
    }
  });

  it("refuses a body over 4 KB before it reads it", async () => {
    expect(MAX_REGISTRATION_PASSWORD_BODY_BYTES).toBe(4096);
    const res = await put("x".repeat(5000));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "request too large" });
    expect(await hashOf()).toBeUndefined();
  });
});

describe("what is stored, and what is never given back", () => {
  it("stores an argon2id hash and never the password, answers 204 with no body, and gives the password back nowhere", async () => {
    const res = await put(PASSWORD);

    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    const hash = await hashOf();
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain(PASSWORD);
    expect(await verifyPassword(PASSWORD, hash!)).toBe(true);
    expect(await verifyPassword("wrong-password", hash!)).toBe(false);
    for (const [name, value] of res.headers.entries()) {
      expect(`${name}: ${value}`).not.toContain(PASSWORD);
      expect(`${name}: ${value}`).not.toContain(hash!);
    }
  });

  it("makes the settings row when the event has none, with registration off, so that the password waits for the way in to be chosen", async () => {
    expect(await prisma.eventRegistrationSettings.count({ where: { event_id: EVENT_BARE } })).toBe(0);

    expect((await put(PASSWORD, { eventId: EVENT_BARE })).status).toBe(204);

    const row = await prisma.eventRegistrationSettings.findUniqueOrThrow({ where: { event_id: EVENT_BARE } });
    expect(row).toMatchObject({ mode: null, access_methods: [], waitlist_enabled: true, verify_email: true });
    expect(row.password_hash).toMatch(/^\$argon2id\$/);
  });

  it("changes the password of an event that has settings, and nothing else in them", async () => {
    await prisma.eventRegistrationSettings.create({
      data: { event_id: EVENT_A, mode: "approval", access_methods: ["password"], ask_company: true, consent_keys: ["photos"], verify_email: false },
    });
    expect((await put(PASSWORD)).status).toBe(204);
    const first = await prisma.eventRegistrationSettings.findUniqueOrThrow({ where: { event_id: EVENT_A } });

    expect((await put(NEXT)).status).toBe(204);

    const second = await prisma.eventRegistrationSettings.findUniqueOrThrow({ where: { event_id: EVENT_A } });
    expect(second.password_hash).not.toBe(first.password_hash);
    expect(await verifyPassword(NEXT, second.password_hash!)).toBe(true);
    expect(await verifyPassword(PASSWORD, second.password_hash!)).toBe(false);
    expect({ ...second, password_hash: null, updated_at: null }).toEqual({ ...first, password_hash: null, updated_at: null });
  });

  it("makes one row when two organisers set the password at once, and keeps one of the two passwords", async () => {
    const [first, second] = await Promise.all([put(PASSWORD, { application: freshApp() }), put(NEXT, { application: freshApp(), cookie: cookies.superadmin })]);

    expect([first.status, second.status]).toEqual([204, 204]);
    expect(await prisma.eventRegistrationSettings.count({ where: { event_id: EVENT_A } })).toBe(1);
    const hash = (await hashOf())!;
    const matches = [await verifyPassword(PASSWORD, hash), await verifyPassword(NEXT, hash)];
    expect(matches.filter(Boolean)).toHaveLength(1);
    expect(await auditOf()).toHaveLength(2);
  });

  it("switches the password off with DELETE: the hash is gone, the rest of the settings stay, and doing it again is 204 with nothing recorded", async () => {
    await prisma.eventRegistrationSettings.create({ data: { event_id: EVENT_A, mode: "automatic", access_methods: ["password"] } });
    await put(PASSWORD);

    expect((await remove()).status).toBe(204);
    expect(await hashOf()).toBeNull();
    expect(await prisma.eventRegistrationSettings.findUniqueOrThrow({ where: { event_id: EVENT_A } })).toMatchObject({ mode: "automatic", access_methods: ["password"] });
    const entries = await auditOf();
    expect((await remove({ application: freshApp() })).status).toBe(204);

    expect(await auditOf()).toHaveLength(entries.length);
  });

  it("makes no row when it switches off the password of an event that has none", async () => {
    expect((await remove({ eventId: EVENT_BARE })).status).toBe(204);

    expect(await prisma.eventRegistrationSettings.count({ where: { event_id: EVENT_BARE } })).toBe(0);
    expect(await auditOf(EVENT_BARE)).toEqual([]);
  });
});

describe("the entry in the audit log", () => {
  it("says that the password was set, by whom and for which event, and nothing of the password", async () => {
    await put(PASSWORD);
    await put(NEXT, { application: freshApp() });
    await remove({ application: freshApp() });

    const entries = await auditOf();

    expect(entries.map((entry) => entry.metadata)).toEqual([
      { event_id: EVENT_A, event_title: `Password ${EVENT_A}`, change: "set" },
      { event_id: EVENT_A, event_title: `Password ${EVENT_A}`, change: "set" },
      { event_id: EVENT_A, event_title: `Password ${EVENT_A}`, change: "cleared" },
    ]);
    expect(entries.every((entry) => entry.actor_user_id === users.adminA && entry.organization_id === ORG_A)).toBe(true);
    const hash = await hashOf();
    const text = JSON.stringify(entries);
    expect(hash).toBeNull();
    for (const secret of [PASSWORD, NEXT, "$argon2"]) expect(text).not.toContain(secret);
  });

  it("records nothing for a request that was refused", async () => {
    await put("short");
    await put(PASSWORD, { cookie: cookies.operator });
    await put(PASSWORD, { eventId: EVENT_ARCHIVED });
    await put(PASSWORD, { headers: { Origin: "https://evil.example" } });

    expect(await prisma.adminAuditLog.count({ where: { action_type: "registration_password_changed", organization_id: { in: [ORG_A, ORG_B] } } })).toBe(0);
  });

  it("shows the hash in no entry, whatever the change was", async () => {
    await put(PASSWORD);
    const hash = (await hashOf())!;
    await put(NEXT, { application: freshApp() });

    const all = await prisma.adminAuditLog.findMany({ where: { organization_id: ORG_A } });

    expect(JSON.stringify(all)).not.toContain(hash);
  });
});

describe("a change of the password touches nothing that exists", () => {
  it("leaves the registrations of the event and their mail as they are, whether it sets, changes or switches off the password", async () => {
    const registration = await prisma.registration.create({
      data: {
        event_id: EVENT_A,
        email: "reg111-guest@example.com",
        first_name: "Ada",
        last_name: "Example",
        name: "Ada Example",
        status: "awaiting_email",
        confirm_expires_at: new Date(Date.now() + 3_600_000),
      },
    });
    await prisma.registrationMail.create({ data: { registration_id: registration.id, event_id: EVENT_A, template_name: "registration-confirm" } });
    const snapshot = async () => ({
      registrations: await prisma.registration.findMany({ where: { event_id: EVENT_A } }),
      mails: await prisma.registrationMail.findMany({ where: { event_id: EVENT_A } }),
    });
    const before = await snapshot();

    expect((await put(PASSWORD)).status).toBe(204);
    expect((await put(NEXT, { application: freshApp() })).status).toBe(204);
    expect((await remove({ application: freshApp() })).status).toBe(204);

    expect(await snapshot()).toEqual(before);
  });
});
