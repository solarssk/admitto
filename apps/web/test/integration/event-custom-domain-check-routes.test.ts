import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { LookupAddress } from "node:dns";
import type { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { signDomainCheck } from "@admitto/crypto";
import { SafeHostnameError } from "@admitto/shared/ssrf-guard";
import { createApp } from "../../src/app.js";
import { createRateLimitStore } from "../../src/rate-limit/index.js";
import { enrollConfirmedTotp } from "../helpers/enroll-confirmed-totp.js";
import { sessionCookieFor } from "../helpers/session-cookie.js";

/**
 * `POST /api/admin/events/:eventId/registration/custom-domain/check` (D-C6, PR 120), against a real database through the real app:
 * that only a superadmin may ask for a check, what each result does to the row, that the first ok turns the address on for the
 * routing at once, that a later failure only warns, that the answer never carries the text of an error, and that the number of
 * requests a person can start is bounded. The network is replaced by a lookup and a pinned request that answer as the test says.
 */
const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };

const ORG_A = "org-reg120-check-a";
const ORG_B = "org-reg120-check-b";
const EVENT_A = "evt-reg120-check-a";
const EVENT_B = "evt-reg120-check-b";
const EVENT_ARCHIVED = "evt-reg120-check-archived";
const EVENT_IDS = [EVENT_A, EVENT_B, EVENT_ARCHIVED];
const SLUG_A = "reg120-check-a";

const EMAILS = {
  adminA: "reg120-admin-a@example.com",
  adminB: "reg120-admin-b@example.com",
  operator: "reg120-operator@example.com",
  superadmin: "reg120-super@example.com",
};

const OWN = "summit.acme.example";
const PUBLIC_ADDRESS: LookupAddress = { address: "203.0.113.10", family: 4 };

type Pinned = (url: string, host: string, records: LookupAddress[], init: unknown, handler: (response: Response) => Promise<unknown>) => Promise<unknown>;

let prisma: PrismaClient;
const cookies = { adminA: "", adminB: "", operator: "", superadmin: "" };

/** What the address answers: a proof for this event and address, or whatever else the test needs. */
const proof = (eventId = EVENT_A, domain = OWN) =>
  new Response(JSON.stringify({ ok: true, mac: signDomainCheck(eventId, domain) }), { status: 200, headers: { "content-type": "application/json" } });

function stubs(answer: () => Response | Promise<Response> | never) {
  const fetchPinned = vi.fn<Pinned>(async (_url, _host, _records, _init, handler) => handler(await answer()));
  const resolve = vi.fn(async () => [PUBLIC_ADDRESS]);
  return { fetchPinned, resolve, probe: { fetchPinned: fetchPinned as never, resolve } };
}

/** A fresh app has a fresh rate limit store, so a test never spends the budget of another. */
function freshApp(probe?: ReturnType<typeof stubs>["probe"]) {
  return createApp({
    prisma,
    checkinToken: "reg120-check-checkin-token-32!!!!",
    allowCheckinBearer: true,
    baseUrl: "https://tickets.example.com",
    rateLimitStore: createRateLimitStore(),
    skipCheckinBootValidation: true,
    adminDistRoot,
    domainCheck: probe,
  });
}

async function wipeAll(client: PrismaClient): Promise<void> {
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
      { id: ORG_A, name: "Check Org A", slug: "reg120-org-a" },
      { id: ORG_B, name: "Check Org B", slug: "reg120-org-b" },
    ],
  });
  const event = (id: string, slug: string, extra: Record<string, unknown> = {}) => ({
    id,
    title: `Check ${id}`,
    slug,
    date: new Date("2099-10-01"),
    organization_id: ORG_A,
    ...extra,
  });
  await client.event.createMany({
    data: [event(EVENT_A, SLUG_A), event(EVENT_B, "reg120-check-b"), event(EVENT_ARCHIVED, "reg120-check-archived", { archived_at: new Date() })],
  });
  const [adminA, adminB, operator, superadmin] = await Promise.all(Object.values(EMAILS).map((email) => client.user.create({ data: { email } })));
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

/** The event has an address that is set and not checked, as a superadmin leaves it. */
const setAddress = (eventId = EVENT_A, domain: string | null = OWN) =>
  prisma.eventRegistrationSettings.upsert({
    where: { event_id: eventId },
    create: { event_id: eventId, custom_domain: domain },
    update: { custom_domain: domain, custom_domain_status: "unchecked", custom_domain_check_result: null, custom_domain_verified_at: null, custom_domain_checked_at: null },
  });

beforeAll(async () => {
  prisma = createTestPrismaClient();
  await seed(prisma);
});

beforeEach(async () => {
  await prisma.eventRegistrationSettings.deleteMany({ where: { event_id: { in: EVENT_IDS } } });
});

afterAll(async () => {
  if (prisma) await wipeAll(prisma);
  await prisma?.$disconnect();
});

const path = (eventId: string) => `/api/admin/events/${eventId}/registration/custom-domain/check`;

function check(application: ReturnType<typeof createApp>, init: { eventId?: string; cookie?: string; headers?: Record<string, string> } = {}): Promise<Response> {
  const { eventId = EVENT_A, cookie = cookies.superadmin, headers = sameOrigin } = init;
  return Promise.resolve(application.request(path(eventId), { method: "POST", headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers } }));
}

const rowOf = (eventId = EVENT_A) => prisma.eventRegistrationSettings.findUniqueOrThrow({ where: { event_id: eventId } });

describe("who may ask for a check", () => {
  it("answers 401 to a caller with no session, and makes no request", async () => {
    await setAddress();
    const { probe, fetchPinned } = stubs(() => proof());
    expect((await check(freshApp(probe), { cookie: "" })).status).toBe(401);
    expect(fetchPinned).not.toHaveBeenCalled();
  });

  it("answers 403 to an admin of the event's organisation, an operator and an admin elsewhere, and makes no request", async () => {
    await setAddress();
    const { probe, resolve, fetchPinned } = stubs(() => proof());
    for (const cookie of [cookies.adminA, cookies.operator, cookies.adminB]) {
      const res = await check(freshApp(probe), { cookie });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "forbidden" });
    }
    expect(resolve).not.toHaveBeenCalled();
    expect(fetchPinned).not.toHaveBeenCalled();
    expect(await rowOf()).toMatchObject({ custom_domain_status: "unchecked", custom_domain_check_result: null, custom_domain_checked_at: null });
  });

  it("refuses a cross-site request before it reads anything", async () => {
    await setAddress();
    const { probe, fetchPinned } = stubs(() => proof());
    const res = await check(freshApp(probe), { headers: { Origin: "https://evil.example" } });
    expect(res.status).toBe(403);
    expect(fetchPinned).not.toHaveBeenCalled();
  });

  it("answers 404 for an event that does not exist, and 409 for one that has no address", async () => {
    const { probe, fetchPinned } = stubs(() => proof());
    const missing = await check(freshApp(probe), { eventId: "no-such-event" });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "not_found" });

    const none = await check(freshApp(probe), { eventId: EVENT_B });
    expect(none.status).toBe(409);
    expect(await none.json()).toEqual({ error: "custom_domain_not_set" });

    await setAddress(EVENT_B, null);
    expect((await check(freshApp(probe), { eventId: EVENT_B })).status).toBe(409);
    expect(fetchPinned).not.toHaveBeenCalled();
  });

  it("refuses an archived event, which is read only", async () => {
    await setAddress(EVENT_ARCHIVED, "archived.acme.example");
    const { probe, fetchPinned } = stubs(() => proof());
    const res = await check(freshApp(probe), { eventId: EVENT_ARCHIVED });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ code: "event_archived" });
    expect(fetchPinned).not.toHaveBeenCalled();
  });
});

describe("what a check does to the address", () => {
  it("verifies the address on the first ok, and answers the state", async () => {
    await setAddress();
    const { probe, fetchPinned, resolve } = stubs(() => proof());

    const res = await check(freshApp(probe));

    expect(res.status).toBe(200);
    const answer = (await res.json()) as Record<string, unknown>;
    expect(answer).toEqual({
      custom_domain: OWN,
      custom_domain_status: "ok",
      custom_domain_check_result: "ok",
      custom_domain_verified_at: expect.any(String),
      custom_domain_checked_at: expect.any(String),
    });
    expect(answer["custom_domain_verified_at"]).toBe(answer["custom_domain_checked_at"]);
    expect(resolve).toHaveBeenCalledWith(OWN);
    expect(fetchPinned.mock.calls[0]![0]).toBe(`https://${OWN}/.well-known/admitto-domain-check`);
    expect(await rowOf()).toMatchObject({ custom_domain_status: "ok", custom_domain_check_result: "ok" });
    expect((await rowOf()).custom_domain_verified_at).toBeInstanceOf(Date);
  });

  it("turns the address on for the routing of this process at once: a host that was served as any other is now the guest's", async () => {
    await setAddress();
    const { probe } = stubs(() => proof());
    const app = freshApp(probe);
    // Before: a set address that is not verified is served as any other host, and the cache holds that answer.
    const before = await app.request(`https://${OWN}/`);
    expect(before.headers.get("location")).not.toBe(`/r/${SLUG_A}`);

    expect((await check(app)).status).toBe(200);

    const after = await app.request(`https://${OWN}/`);
    expect(after.status).toBe(302);
    expect(after.headers.get("location")).toBe(`/r/${SLUG_A}`);
  });

  it.each([
    ["dns_failed", () => Promise.reject(new SafeHostnameError("hostname_unresolved", "x")), "failing"],
    ["not_verifiable_from_server", () => Promise.reject(new SafeHostnameError("hostname_blocked", "x")), "unchecked"],
  ] as const)("records %s (a name that does not resolve, or resolves to a private address) without a request", async (result, lookup, status) => {
    await setAddress();
    const { fetchPinned } = stubs(() => proof());
    const probe = { resolve: vi.fn(lookup) as never, fetchPinned: fetchPinned as never };

    const res = await check(freshApp(probe));

    expect(await res.json()).toMatchObject({ custom_domain_status: status, custom_domain_check_result: result, custom_domain_verified_at: null });
    expect(fetchPinned).not.toHaveBeenCalled();
    expect(await rowOf()).toMatchObject({ custom_domain_status: status, custom_domain_check_result: result, custom_domain_verified_at: null });
  });

  it.each([
    ["tls_failed", () => Promise.reject(new TypeError("fetch failed", { cause: Object.assign(new Error("self-signed"), { code: "DEPTH_ZERO_SELF_SIGNED_CERT" }) }))],
    ["unreachable", () => Promise.reject(new TypeError("fetch failed", { cause: Object.assign(new Error("refused"), { code: "ECONNREFUSED" }) }))],
    ["wrong_target", () => new Response("not found", { status: 404 })],
  ] as const)("records %s and verifies nothing", async (result, answer) => {
    await setAddress();
    const { probe } = stubs(answer);

    const res = await check(freshApp(probe));

    expect(await res.json()).toMatchObject({ custom_domain_status: "failing", custom_domain_check_result: result, custom_domain_verified_at: null });
    expect(await rowOf()).toMatchObject({ custom_domain_status: "failing", custom_domain_check_result: result, custom_domain_verified_at: null });
  });

  it("takes the proof of another event's address for a wrong target", async () => {
    await setAddress();
    const { probe } = stubs(() => proof("evt-another-event"));
    expect(await (await check(freshApp(probe))).json()).toMatchObject({ custom_domain_check_result: "wrong_target", custom_domain_verified_at: null });
  });

  it("only warns when a verified address stops answering: it is failing, still verified, and still the guest's host", async () => {
    await setAddress();
    const app = freshApp(stubs(() => proof()).probe);
    expect((await check(app)).status).toBe(200);
    const verifiedAt = (await rowOf()).custom_domain_verified_at;

    const failing = freshApp(stubs(() => new Response("gone", { status: 502 })).probe);
    const res = await check(failing);

    expect(await res.json()).toMatchObject({ custom_domain_status: "failing", custom_domain_check_result: "wrong_target", custom_domain_verified_at: verifiedAt?.toISOString() });
    expect((await rowOf()).custom_domain_verified_at).toEqual(verifiedAt);
    // Guests are not sent back to the instance's address: the routing still treats it as the event's.
    expect((await failing.request(`https://${OWN}/`)).status).toBe(302);
  });

  it("makes no request for the host of the instance, which can never be an event's address", async () => {
    // A row written by hand: the setting itself refuses this value.
    await prisma.eventRegistrationSettings.upsert({
      where: { event_id: EVENT_A },
      create: { event_id: EVENT_A, custom_domain: "tickets.example.com" },
      update: { custom_domain: "tickets.example.com" },
    });
    const { probe, resolve, fetchPinned } = stubs(() => proof());

    const res = await check(freshApp(probe));

    expect(await res.json()).toMatchObject({ custom_domain_check_result: "wrong_target", custom_domain_verified_at: null });
    expect(resolve).not.toHaveBeenCalled();
    expect(fetchPinned).not.toHaveBeenCalled();
  });

  it("never carries the text of an error or of the address' answer", async () => {
    await setAddress();
    const { probe } = stubs(() => Promise.reject(new TypeError("fetch failed", { cause: new Error("SECRET-DETAIL at 10.0.0.7") })));

    const res = await check(freshApp(probe));
    const text = await res.text();

    expect(text).not.toContain("SECRET-DETAIL");
    expect(text).not.toContain("10.0.0.7");
    expect(JSON.parse(text)).toMatchObject({ custom_domain_check_result: "unreachable" });
  });

  it("writes nothing for an address that was changed while the check ran", async () => {
    await setAddress();
    const { probe } = stubs(async () => {
      await setAddress(EVENT_A, "changed.acme.example");
      return proof();
    });

    const res = await check(freshApp(probe));

    expect(await res.json()).toMatchObject({ custom_domain: "changed.acme.example", custom_domain_status: "unchecked", custom_domain_check_result: null, custom_domain_verified_at: null });
    expect(await rowOf()).toMatchObject({ custom_domain: "changed.acme.example", custom_domain_status: "unchecked", custom_domain_verified_at: null });
  });

  it("is a failure of the server, with nothing written, when the database fails", async () => {
    await setAddress();
    const { probe } = stubs(() => proof());
    const spy = vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(new Error("unexpected"));
    try {
      const res = await check(freshApp(probe));
      expect(res.status).toBe(500);
    } finally {
      spy.mockRestore();
    }
    expect(await rowOf()).toMatchObject({ custom_domain_status: "unchecked", custom_domain_verified_at: null });
  });
});

describe("the number of checks a person can start", () => {
  it("allows five a minute for a user and answers the sixth with 429 and a word the panel words, without a request", async () => {
    await setAddress();
    const { probe, fetchPinned } = stubs(() => new Response("no", { status: 404 }));
    const app = freshApp(probe);

    for (let attempt = 0; attempt < 5; attempt += 1) expect((await check(app)).status).toBe(200);
    const sixth = await check(app);

    expect(sixth.status).toBe(429);
    expect(await sixth.json()).toEqual({ error: "domain_check_rate_limited" });
    expect(fetchPinned).toHaveBeenCalledTimes(5);
  });
});

describe("the state an organisation admin reads on the Access tab", () => {
  const settingsPath = (eventId: string) => `/api/admin/events/${eventId}/registration/settings`;
  const readSettings = async (application: ReturnType<typeof createApp>, cookie: string, eventId = EVENT_A) =>
    (await (await application.request(settingsPath(eventId), { headers: { Cookie: cookie } })).json()) as { own_address: unknown; guest_url: string | null };

  it("has no own address for an event without one", async () => {
    const body = await readSettings(freshApp(), cookies.adminA);
    expect(body.own_address).toBeNull();
    expect(body.guest_url).toBe(`https://tickets.example.com/r/${SLUG_A}`);
  });

  it("tells an address that is set but not checked, then one that works and the guests' link on it, then one that stopped", async () => {
    await setAddress();
    const app = freshApp(stubs(() => proof()).probe);
    expect(await readSettings(app, cookies.adminA)).toMatchObject({
      own_address: { domain: OWN, status: "unchecked", check_result: null, verified: false, checked_at: null },
      guest_url: `https://tickets.example.com/r/${SLUG_A}`,
    });

    await check(app);
    expect(await readSettings(app, cookies.adminA)).toMatchObject({
      own_address: { domain: OWN, status: "ok", check_result: "ok", verified: true, checked_at: expect.any(String) },
      guest_url: `https://${OWN}/r/${SLUG_A}`,
    });

    await check(freshApp(stubs(() => Promise.reject(new TypeError("fetch failed", { cause: Object.assign(new Error("x"), { code: "CERT_HAS_EXPIRED" }) }))).probe));
    expect(await readSettings(app, cookies.adminA)).toMatchObject({
      own_address: { domain: OWN, status: "failing", check_result: "tls_failed", verified: true },
      // The guests' link stays on the address: a failure only warns.
      guest_url: `https://${OWN}/r/${SLUG_A}`,
    });
  });
});
