import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, type PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { MAX_CUSTOM_DOMAIN_BODY_BYTES, judgeCustomDomain } from "../../src/admin/event-custom-domain-routes.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { enrollConfirmedTotp } from "../helpers/enroll-confirmed-totp.js";
import { sessionCookieFor } from "../helpers/session-cookie.js";

/**
 * `GET` and `PUT /api/admin/events/:eventId/registration/custom-domain` (D-C6), against a real database through the real app:
 * that only a superadmin may read or set the address, what an address must look like (and that a refusal says why in a fixed word
 * and never repeats the value), that one address belongs to one event, that any change takes back what was found about the old
 * address, and that the audit entry records the change.
 */
const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };

const ORG_A = "org-reg119-domain-a";
const ORG_B = "org-reg119-domain-b";
const EVENT_A = "evt-reg119-domain-a";
const EVENT_B = "evt-reg119-domain-b";
const EVENT_OTHER_ORG = "evt-reg119-domain-other";
const EVENT_ARCHIVED = "evt-reg119-domain-archived";
const EVENT_IDS = [EVENT_A, EVENT_B, EVENT_OTHER_ORG, EVENT_ARCHIVED];

const EMAILS = {
  adminA: "reg119-admin-a@example.com",
  adminB: "reg119-admin-b@example.com",
  operator: "reg119-operator@example.com",
  superadmin: "reg119-super@example.com",
};

const OWN = "summit.acme.example";
const VERIFIED_AT = new Date("2026-11-11T10:00:00Z");

let prisma: PrismaClient;
let app: ReturnType<typeof buildTestApp>;
const cookies = { adminA: "", adminB: "", operator: "", superadmin: "" };

/** A fresh app has a fresh rate limit store, so a test never spends the budget of another. */
const freshApp = () => buildTestApp({ prisma, checkinToken: "reg119-domain-checkin-token-32!!", adminDistRoot });

async function wipeAll(client: PrismaClient): Promise<void> {
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
      { id: ORG_A, name: "Domain Org A", slug: "reg119-org-a" },
      { id: ORG_B, name: "Domain Org B", slug: "reg119-org-b" },
    ],
  });
  const event = (id: string, orgId: string, extra: Record<string, unknown> = {}) => ({
    id,
    title: `Domain ${id}`,
    slug: id,
    date: new Date("2099-10-01"),
    organization_id: orgId,
    ...extra,
  });
  await client.event.createMany({
    data: [
      event(EVENT_A, ORG_A),
      event(EVENT_B, ORG_A),
      event(EVENT_OTHER_ORG, ORG_B),
      event(EVENT_ARCHIVED, ORG_A, { archived_at: new Date() }),
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
  await prisma.eventRegistrationSettings.deleteMany({ where: { event_id: { in: EVENT_IDS } } });
  await prisma.adminAuditLog.deleteMany({ where: { organization_id: { in: [ORG_A, ORG_B] } } });
  app = freshApp();
});

afterAll(async () => {
  if (prisma) await wipeAll(prisma);
  await prisma?.$disconnect();
});

const path = (eventId: string) => `/api/admin/events/${eventId}/registration/custom-domain`;

async function call(
  method: "GET" | "PUT",
  body: unknown,
  init: { eventId?: string; cookie?: string; headers?: Record<string, string>; application?: ReturnType<typeof buildTestApp> } = {},
): Promise<Response> {
  const { eventId = EVENT_A, cookie = cookies.superadmin, headers = sameOrigin, application = app } = init;
  return await application.request(path(eventId), {
    method,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers, "Content-Type": "application/json" },
    ...(method === "PUT" ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  });
}

const put = (value: unknown, init: Parameters<typeof call>[2] = {}) => call("PUT", { custom_domain: value }, init);
const get = (init: Parameters<typeof call>[2] = {}) => call("GET", undefined, init);
const rowOf = (eventId = EVENT_A) => prisma.eventRegistrationSettings.findUnique({ where: { event_id: eventId } });
const auditOf = (eventId = EVENT_A) =>
  prisma.adminAuditLog.findMany({
    where: { action_type: "registration_custom_domain_updated", metadata: { path: ["event_id"], equals: eventId } },
    orderBy: { created_at: "asc" },
  });

describe("who may read or set the address", () => {
  it.each(["GET", "PUT"] as const)("%s: an unauthenticated caller gets 401 and nothing changes", async (method) => {
    expect((await call(method, { custom_domain: OWN }, { cookie: "" })).status).toBe(401);
    expect(await rowOf()).toBeNull();
    expect(await auditOf()).toEqual([]);
  });

  it.each(["GET", "PUT"] as const)("%s: an admin of the event's own organisation gets 403, as does an operator and an admin elsewhere", async (method) => {
    for (const cookie of [cookies.adminA, cookies.operator, cookies.adminB]) {
      const res = await call(method, { custom_domain: OWN }, { cookie, application: freshApp() });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "forbidden" });
    }
    expect(await rowOf()).toBeNull();
    expect(await auditOf()).toEqual([]);
  });

  it("lets a superadmin set it, for an event of any organisation", async () => {
    for (const eventId of [EVENT_A, EVENT_OTHER_ORG]) {
      const res = await put(`${eventId}.acme.example`, { eventId });
      expect(res.status).toBe(200);
    }
    expect((await rowOf())?.custom_domain).toBe(`${EVENT_A}.acme.example`);
  });

  it.each(["GET", "PUT"] as const)("%s: answers 404 for an event that does not exist to a superadmin", async (method) => {
    const res = await call(method, { custom_domain: OWN }, { eventId: "no-such-event" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("refuses a cross-site PUT before it reads anything", async () => {
    const res = await put(OWN, { headers: { Origin: "https://evil.example" } });
    expect(res.status).toBe(403);
    expect(await rowOf()).toBeNull();
  });

  it("refuses an archived event, which is read-only, and still reads its address", async () => {
    const res = await put(OWN, { eventId: EVENT_ARCHIVED });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ code: "event_archived" });
    expect(await rowOf(EVENT_ARCHIVED)).toBeNull();
    expect((await get({ eventId: EVENT_ARCHIVED })).status).toBe(200);
  });
});

describe("what an address must look like", () => {
  const ACCEPTED: [string, string, string][] = [
    ["a plain name", "events.example.com", "events.example.com"],
    ["a name in capitals, stored in lower case", "EXAMPLE.com", "example.com"],
    ["spaces around it, cut off", "  events.example.com  ", "events.example.com"],
    ["a name outside ASCII, stored as punycode", "münchen.example.de", "xn--mnchen-3ya.example.de"],
    ["a name that is punycode already", "xn--mnchen-3ya.de", "xn--mnchen-3ya.de"],
    ["a deep name", "a.b.c.d.example.com", "a.b.c.d.example.com"],
    ["a label of 63 characters", `${"a".repeat(63)}.example.com`, `${"a".repeat(63)}.example.com`],
  ];

  it.each(ACCEPTED)("accepts %s", async (_what, sent, stored) => {
    const res = await put(sent);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ custom_domain: stored, custom_domain_status: "unchecked", custom_domain_verified_at: null, custom_domain_checked_at: null });
    expect((await rowOf())?.custom_domain).toBe(stored);
  });

  const REFUSED: [string, unknown, string][] = [
    ["nothing", "", "empty"],
    ["only spaces", "   ", "empty"],
    ["a scheme", "https://x.com", "bad_characters"],
    ["a scheme in capitals", "HTTPS://X.COM", "bad_characters"],
    ["a port", "x.com:8080", "bad_characters"],
    ["a path", "x.com/path", "bad_characters"],
    ["a query", "x.com?a=1", "bad_characters"],
    ["a fragment", "x.com#top", "bad_characters"],
    ["user information", "user:secret@x.com", "bad_characters"],
    ["a space inside", "ex ample.com", "bad_characters"],
    ["a line break inside", "x.com\nevil.com", "bad_characters"],
    ["an IPv4 address", "1.2.3.4", "ip_address"],
    ["an IPv6 address", "[::1]", "bad_characters"],
    ["a trailing dot", "x.com.", "trailing_dot"],
    ["a name of one label", "example", "no_dot"],
    ["localhost", "localhost", "reserved"],
    ["a name under localhost", "app.localhost", "reserved"],
    ["a name under .local", "printer.local", "reserved"],
    ["a name under .internal", "tickets.corp.internal", "reserved"],
    ["a label of 64 characters", `${"a".repeat(64)}.example.com`, "bad_label"],
    ["a name of 254 characters", `${"a".repeat(250)}.com`, "too_long"],
    ["the address of the instance", "tickets.example.com", "instance_host"],
    ["the address of the instance in capitals", "TICKETS.Example.COM", "instance_host"],
  ];

  it.each(REFUSED)("refuses %s with 422 and the word that says why, and stores nothing", async (_what, sent, problem) => {
    const res = await put(sent);
    expect(res.status).toBe(422);
    const answer = await res.json();
    expect(answer).toEqual({ error: "custom_domain_invalid", problem });
    // The value is never repeated back.
    expect(JSON.stringify(answer)).not.toContain(String(sent).trim() || "\u0000");
    expect(await rowOf()).toBeNull();
    expect(await auditOf()).toEqual([]);
  });

  it("refuses a very long value under the size cap with the word, and one over the cap before it reads it", async () => {
    expect(MAX_CUSTOM_DOMAIN_BODY_BYTES).toBe(1024);
    const long = await put("a".repeat(900));
    expect(long.status).toBe(422);
    expect(await long.json()).toEqual({ error: "custom_domain_invalid", problem: "too_long" });
    const huge = await put("a".repeat(5000));
    expect(huge.status).toBe(400);
    expect(await huge.json()).toEqual({ error: "request too large" });
    expect(await rowOf()).toBeNull();
  });

  it("refuses a body that is not exactly one text or null under `custom_domain`", async () => {
    const bad: unknown[] = [{}, { custom_domain: 12 }, { custom_domain: [OWN] }, { custom_domain: OWN, extra: true }, { domain: OWN }, [], null, '"text"'];
    for (const body of bad) {
      const res = await call("PUT", body, { application: freshApp() });
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await res.json()).toEqual({ error: "validation_failed" });
    }
    const notJson = await call("PUT", "{ not json");
    expect(notJson.status).toBe(400);
    expect(await notJson.json()).toEqual({ error: "invalid_json" });
    expect(await rowOf()).toBeNull();
  });
});

describe("judgeCustomDomain: the rule that needs the instance's address", () => {
  it("takes the host of the instance for the instance's own, whatever the case or the port", async () => {
    for (const url of ["https://tickets.example.com", "https://Tickets.Example.com:8443", "https://tickets.example.com/"]) {
      expect(await judgeCustomDomain("tickets.example.com", async () => url)).toEqual({ ok: false, problem: "instance_host" });
    }
    expect(await judgeCustomDomain("events.example.com", async () => "https://tickets.example.com")).toEqual({ ok: true, domain: "events.example.com" });
  });

  it("refuses nothing for want of an instance address: an instance with none has no host to take", async () => {
    const noAddress = () => Promise.reject(new Error("no instance url"));
    expect(await judgeCustomDomain("tickets.example.com", noAddress)).toEqual({ ok: true, domain: "tickets.example.com" });
    expect(await judgeCustomDomain(null, noAddress)).toEqual({ ok: true, domain: null });
    // The shape is still judged.
    expect(await judgeCustomDomain("x.com/path", noAddress)).toEqual({ ok: false, problem: "bad_characters" });
  });
});

describe("one address, one event", () => {
  it("refuses an address that another event holds, in any case, with 409 custom_domain_taken, and changes nothing", async () => {
    expect((await put(OWN, { eventId: EVENT_B })).status).toBe(200);

    for (const sent of [OWN, OWN.toUpperCase()]) {
      const res = await put(sent, { application: freshApp() });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "custom_domain_taken" });
    }
    expect(await rowOf(EVENT_A)).toBeNull();
    expect(await auditOf(EVENT_A)).toEqual([]);
    expect((await rowOf(EVENT_B))?.custom_domain).toBe(OWN);
  });

  it("gives the address to exactly one of two events that ask for it at once", async () => {
    const results = await Promise.all([
      put(OWN, { eventId: EVENT_A, application: freshApp() }),
      put(OWN, { eventId: EVENT_B, application: freshApp() }),
    ]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
    expect(await prisma.eventRegistrationSettings.count({ where: { custom_domain: OWN } })).toBe(1);
    expect(await prisma.adminAuditLog.count({ where: { action_type: "registration_custom_domain_updated" } })).toBe(1);
  });

  it("lets the address go to another event once the first has let it go", async () => {
    await put(OWN, { eventId: EVENT_B });
    expect((await put(null, { eventId: EVENT_B })).status).toBe(200);
    expect((await put(OWN, { eventId: EVENT_A })).status).toBe(200);
  });
});

describe("what a change takes back", () => {
  /** An address that was found working: what the check of PR 120 leaves. */
  async function verified(domain = OWN) {
    expect((await put(domain)).status).toBe(200);
    await prisma.eventRegistrationSettings.update({
      where: { event_id: EVENT_A },
      data: { custom_domain_status: "ok", custom_domain_verified_at: VERIFIED_AT, custom_domain_checked_at: VERIFIED_AT },
    });
  }

  it("takes back the verification when the address is changed to another, so the new one is not trusted for the old one's proof", async () => {
    await verified();

    const res = await put("gala.other.example");

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ custom_domain: "gala.other.example", custom_domain_status: "unchecked", custom_domain_verified_at: null, custom_domain_checked_at: null });
    expect(await rowOf()).toMatchObject({ custom_domain: "gala.other.example", custom_domain_status: "unchecked", custom_domain_verified_at: null, custom_domain_checked_at: null });
  });

  it("takes back all of it when the address is removed with null", async () => {
    await verified();

    const res = await put(null);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ custom_domain: null, custom_domain_status: "unchecked", custom_domain_verified_at: null, custom_domain_checked_at: null });
    expect(await rowOf()).toMatchObject({ custom_domain: null, custom_domain_status: "unchecked", custom_domain_verified_at: null, custom_domain_checked_at: null });
  });

  it("changes nothing, and records nothing, when the same address is saved again (in any case)", async () => {
    await verified();
    const before = await rowOf();

    for (const sent of [OWN, OWN.toUpperCase(), ` ${OWN} `]) {
      const res = await put(sent, { application: freshApp() });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ custom_domain: OWN, custom_domain_status: "ok", custom_domain_verified_at: VERIFIED_AT.toISOString() });
    }

    expect(await rowOf()).toEqual(before);
    expect(await auditOf()).toHaveLength(1);
  });

  it("makes no row for an event that has none when null is saved", async () => {
    const res = await put(null);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ custom_domain: null, custom_domain_status: "unchecked", custom_domain_verified_at: null, custom_domain_checked_at: null });
    expect(await rowOf()).toBeNull();
    expect(await auditOf()).toEqual([]);
  });

  it("leaves the registration settings of the event as they were", async () => {
    await prisma.eventRegistrationSettings.create({
      data: { event_id: EVENT_A, mode: "approval", access_methods: ["password"], ask_company: true, consent_keys: ["photos"], verify_email: false },
    });
    const before = await rowOf();

    expect((await put(OWN)).status).toBe(200);

    const after = await rowOf();
    expect({ ...after, custom_domain: null, updated_at: null }).toEqual({ ...before, custom_domain: null, updated_at: null });
  });

  it("reads back what was saved", async () => {
    await verified();
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      custom_domain: OWN,
      custom_domain_status: "ok",
      custom_domain_verified_at: VERIFIED_AT.toISOString(),
      custom_domain_checked_at: VERIFIED_AT.toISOString(),
    });
    expect(await (await get({ eventId: EVENT_B })).json()).toEqual({
      custom_domain: null,
      custom_domain_status: "unchecked",
      custom_domain_verified_at: null,
      custom_domain_checked_at: null,
    });
  });
});

describe("a failure the route does not expect", () => {
  it("answers 404 when the event is deleted while the change is made, and 500 for any other failure, with nothing stored", async () => {
    const gone = new Prisma.PrismaClientKnownRequestError("foreign key", { code: "P2003", clientVersion: "test" });
    const spy = vi.spyOn(prisma, "$transaction");
    try {
      spy.mockRejectedValueOnce(gone);
      const deleted = await put(OWN, { application: freshApp() });
      expect(deleted.status).toBe(404);
      expect(await deleted.json()).toEqual({ error: "not_found" });

      spy.mockRejectedValueOnce(new Error("unexpected"));
      const broken = await put(OWN, { application: freshApp() });
      expect(broken.status).toBe(500);
    } finally {
      spy.mockRestore();
    }
    expect(await rowOf()).toBeNull();
  });
});

describe("the audit log", () => {
  it("records each change with the event and the address before and after, and by whom, and nothing else", async () => {
    await put(OWN);
    await put("gala.other.example");
    await put(null);

    const entries = await auditOf();
    expect(entries.map((entry) => entry.metadata)).toEqual([
      { event_id: EVENT_A, event_title: `Domain ${EVENT_A}`, custom_domain: OWN, previous_custom_domain: null },
      { event_id: EVENT_A, event_title: `Domain ${EVENT_A}`, custom_domain: "gala.other.example", previous_custom_domain: OWN },
      { event_id: EVENT_A, event_title: `Domain ${EVENT_A}`, custom_domain: null, previous_custom_domain: "gala.other.example" },
    ]);
    expect(entries.every((entry) => entry.organization_id === ORG_A && entry.actor_user_id !== null)).toBe(true);
  });

  it("writes nothing for a refused change", async () => {
    await put("x.com/path");
    await put("tickets.example.com");
    await put(OWN, { eventId: EVENT_B });
    await put(OWN);

    expect(await auditOf(EVENT_A)).toEqual([]);
    expect(await auditOf(EVENT_B)).toHaveLength(1);
  });
});
