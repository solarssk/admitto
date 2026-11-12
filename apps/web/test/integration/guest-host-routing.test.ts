/**
 * The routing by host (D-C6, 119b), against a real database, through the real app: on the verified own address of an event the
 * application serves the guest's side of that one event and nothing of the panel; on the host of the instance, on a pending address
 * and on any other host it serves what it always did. Every host here is synthetic, and the "browser" is a request to the app with
 * the host in the address, which is how a proxy that passes the host on shows it.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { encryptToString, signDomainCheck, verifyDomainCheck } from "@admitto/crypto";
import { hashToken } from "@admitto/tickets";
import { createApp } from "../../src/app.js";
import { setEnabledAccessMethods } from "../../src/registration/access-methods.js";
import { createRateLimitStore } from "../../src/rate-limit/index.js";
import { enrollConfirmedTotp } from "../helpers/enroll-confirmed-totp.js";
import { startMockOidcIdp, stopMockOidcIdp, type MockOidcIdp } from "../helpers/mock-oidc-idp.js";
import { sessionCookieFor } from "../helpers/session-cookie.js";
import { GUEST_SSO_SESSION_COOKIE, Jar, browse, goToProvider, installProvider, removeProvider, type App } from "../helpers/registration-sso-harness.js";
import { ORIGIN, SelectiveStore, eventSeeder, harness, signature } from "../helpers/registration-submit-harness.js";

const ORG = "org-reg119b-routing";
const MAIN = "tickets.example.com";
const HOST_A = "a.reg119b.example";
const HOST_B = "b.reg119b.example";
const HOST_PENDING = "pending.reg119b.example";
const HOST_UNKNOWN = "nobody.reg119b.example";
const SLUG_A = "reg119b-a";
const SLUG_B = "reg119b-b";
const SLUG_PENDING = "reg119b-pending";
const SLUG_PLAIN = "reg119b-plain";
const TOKEN_A = "reg119b-token-a-AbCdEfGhIjKlMnOpQrStUvWxYz012345";
const TOKEN_B = "reg119b-token-b-AbCdEfGhIjKlMnOpQrStUvWxYz012345";
const SUPERADMIN = "reg119b-super@example.com";
const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");

let prisma: PrismaClient;
let idp: MockOidcIdp;
let seeder: ReturnType<typeof eventSeeder>;
let h: ReturnType<typeof harness>;
let getForEvent: ReturnType<typeof vi.fn>;
const ids = { a: "", b: "", pending: "", plain: "" };

const get = (host: string, path: string, init?: RequestInit) => h.app.request(`https://${host}${path}`, init);
const onHost = (host: string): App => ({ request: (input, init) => h.app.request(input.replace(ORIGIN, `https://${host}`), init) });
/** A nonce is made for every response, so it is the one thing two answers to the same request differ by. */
const noNonce = (text: string): string => text.replace(/nonce[-=]["']?[A-Za-z0-9+/=]+/g, "nonce-X");
const withoutHsts = async (res: Response) => {
  const { headers, body, ...rest } = await signature(res);
  const { "strict-transport-security": _hsts, "content-security-policy": csp, ...others } = headers;
  return { ...rest, body: noNonce(body), headers: { ...others, ...(csp ? { "content-security-policy": noNonce(csp) } : {}) } };
};

async function setDomain(eventId: string, domain: string | null, verified: boolean): Promise<void> {
  await prisma.eventRegistrationSettings.update({
    where: { event_id: eventId },
    data: { custom_domain: domain, custom_domain_verified_at: verified && domain ? new Date() : null, custom_domain_status: verified && domain ? "ok" : "unchecked" },
  });
}

async function addTicket(eventId: string, token: string, label: string): Promise<void> {
  await prisma.attendee.create({
    data: {
      id: `att-${label}`,
      event_id: eventId,
      email: `${label}@example.com`,
      name: `Guest ${label}`,
      first_name: "Guest",
      last_name: label,
      token_hash: hashToken(token),
      token_enc: encryptToString(token),
      status: "registered",
    },
  });
}

beforeAll(async () => {
  prisma = createTestPrismaClient();
  idp = await startMockOidcIdp();
  seeder = eventSeeder(prisma, ORG);
  await seeder.prepare();
  const sso = { access_methods: ["sso"], mode: "approval" };
  ids.a = await seeder.addEvent(SLUG_A, { settings: sso });
  ids.b = await seeder.addEvent(SLUG_B, { settings: sso });
  ids.pending = await seeder.addEvent(SLUG_PENDING);
  ids.plain = await seeder.addEvent(SLUG_PLAIN);
  await addTicket(ids.a, TOKEN_A, "reg119b-a");
  await addTicket(ids.b, TOKEN_B, "reg119b-b");
  await prisma.user.deleteMany({ where: { email: SUPERADMIN } });
});

beforeEach(async () => {
  getForEvent = vi.fn(async () => ({ ok: true, png: Buffer.from("png"), cacheHit: false }));
  h = harness({ prisma, store: new SelectiveStore(), eventStaticMapService: { getForEvent } as never });
  await installProvider(prisma, idp);
  // Both ways in are on, so the events with the company sign-in and the one with the public link are open.
  await setEnabledAccessMethods(prisma, ["sso", "link"]);
  await prisma.registrationSsoState.deleteMany();
  await setDomain(ids.a, HOST_A, true);
  await setDomain(ids.b, HOST_B, true);
  await setDomain(ids.pending, HOST_PENDING, false);
  await setDomain(ids.plain, null, false);
});

afterAll(async () => {
  if (!prisma) return;
  await prisma.registrationSsoState.deleteMany();
  await removeProvider(prisma);
  // The audit entry of the change of an address belongs to this file's organisation, and other files count such entries.
  await prisma.adminAuditLog.deleteMany({ where: { organization_id: ORG } });
  await prisma.session.deleteMany({ where: { user: { email: SUPERADMIN } } });
  await prisma.userMfaMethod.deleteMany({ where: { user: { email: SUPERADMIN } } });
  await prisma.roleAssignment.deleteMany({ where: { user: { email: SUPERADMIN } } });
  await prisma.user.deleteMany({ where: { email: SUPERADMIN } });
  await seeder.wipe();
  await prisma.$disconnect();
  await stopMockOidcIdp(idp);
});

/** What the application answers for a page that is not there, on the host of the instance. */
const NOT_THERE = "/r/no-such-event";

describe("a path of the panel on each kind of host", () => {
  const STAFF_PATHS: Array<[string, string]> = [
    ["GET", "/admin"],
    ["GET", "/admin/events"],
    ["GET", "/login"],
    ["GET", "/setup"],
    ["GET", "/account"],
    ["GET", "/operator"],
    ["GET", "/change-password"],
    ["GET", "/mfa/verify"],
    ["GET", "/api/auth/me"],
    ["GET", "/api/admin/events"],
    ["GET", "/api/admin/me"],
    ["GET", "/api/checkin/events"],
    ["POST", "/api/auth/login"],
    ["POST", "/api/ingest"],
    ["POST", "/api/wallet/webhook/passcreator/evt-1"],
    ["POST", "/api/ops/system-logs"],
    ["GET", "/healthz"],
    ["GET", "/readyz"],
    ["GET", "/robots.txt"],
    ["GET", "/.well-known/change-password"],
  ];

  it("is the same 404, byte for byte, on a guest's address: the panel is not there", async () => {
    const reference = await withoutHsts(await get(HOST_A, NOT_THERE));
    expect(reference.status).toBe(404);
    for (const [method, path] of STAFF_PATHS) {
      const res = await get(HOST_A, path, { method, headers: { "Content-Type": "application/json", Origin: `https://${HOST_A}` }, ...(method === "POST" ? { body: "{}" } : {}) });
      expect(await withoutHsts(res), `${method} ${path}`).toEqual(reference);
    }
  });

  it("is the 404 of a page that is not there on a guest's address, the same as the instance's own for an event that is not there", async () => {
    const onMain = await withoutHsts(await get(MAIN, NOT_THERE));
    expect(await withoutHsts(await get(HOST_A, NOT_THERE))).toEqual(onMain);
    expect(await withoutHsts(await get(HOST_A, "/admin"))).toEqual(onMain);
  });

  it("is answered as it always was on the instance's host, on a pending address and on a host that is nobody's", async () => {
    for (const [method, path] of STAFF_PATHS) {
      const init = { method, headers: { "Content-Type": "application/json", Origin: ORIGIN }, ...(method === "POST" ? { body: "{}" } : {}) };
      const reference = await signature(await get(MAIN, path, init));
      // The Origin differs by host, so only the status and the body are compared for the POSTs.
      for (const host of [HOST_PENDING, HOST_UNKNOWN]) {
        const res = await get(host, path, { ...init, headers: { ...init.headers, Origin: `https://${host}` } });
        const seen = await signature(res);
        expect(seen.status, `${host} ${method} ${path}`).toBe(reference.status);
        expect(noNonce(seen.body), `${host} ${method} ${path}`).toBe(noNonce(reference.body));
      }
    }
  });

  it("is not hidden on the instance's host even when a row names that host as an event's address", async () => {
    const before = await Promise.all(["/login", "/setup", "/admin", "/healthz"].map(async (path) => (await get(MAIN, path, { redirect: "manual" })).status));
    await setDomain(ids.plain, MAIN, true);
    const after = await Promise.all(["/login", "/setup", "/admin", "/healthz"].map(async (path) => (await get(MAIN, path, { redirect: "manual" })).status));
    expect(after).toEqual(before);
    expect(after).not.toContain(404);
  });
});

describe("a path of the guest's side on a guest's address", () => {
  it("serves the form of its own event, its legal text, the files its pages link to and the icons", async () => {
    for (const path of [`/r/${SLUG_A}`, `/legal/${SLUG_A}/privacy-notice`, "/assets/admitto-logo.svg", "/assets/apple-wallet-badge.png", "/favicon.svg", "/favicon-32.png", "/favicon.ico", "/apple-touch-icon.png"]) {
      const res = await get(HOST_A, path);
      expect(res.status, path).toBe(200);
    }
    expect(await (await get(HOST_A, `/r/${SLUG_A}`)).text()).toContain(`/r/${SLUG_A}/sso/start`);
    expect(await (await get(HOST_B, `/r/${SLUG_B}`)).text()).toContain(`/r/${SLUG_B}/sso/start`);
  });

  it("hides the form and the legal texts of another event, with the same 404", async () => {
    const reference = await withoutHsts(await get(HOST_A, NOT_THERE));
    for (const path of [`/r/${SLUG_B}`, `/r/${SLUG_PLAIN}`, `/r/${SLUG_B}/sso/start`, `/legal/${SLUG_B}/privacy-notice`, `/t/${SLUG_B}/a/ref1`, `/t/${SLUG_B}/a/ref1/wallet/apple`, `/q/${SLUG_B}/a/ref1.png`]) {
      expect(await withoutHsts(await get(HOST_A, path)), path).toEqual(reference);
    }
    // The same pages are there on their own address and on the instance's.
    expect((await get(HOST_B, `/r/${SLUG_B}`)).status).toBe(200);
    expect((await get(MAIN, `/r/${SLUG_B}`)).status).toBe(200);
    expect((await get(MAIN, `/r/${SLUG_A}`)).status).toBe(200);
  });

  it("sends the root to the form of its own event, whatever the request carries", async () => {
    for (const path of ["/", `/?next=https://evil.example.net`, "/?slug=reg119b-b", "/?redirect=//evil.example.net/x"]) {
      const res = await get(HOST_A, path, { redirect: "manual" });
      expect(res.status, path).toBe(302);
      expect(res.headers.get("location"), path).toBe(`/r/${SLUG_A}`);
    }
    expect((await get(HOST_B, "/", { redirect: "manual" })).headers.get("location")).toBe(`/r/${SLUG_B}`);
    // Not on the instance's host: there the root is the staff's way in, as before.
    const main = await get(MAIN, "/", { redirect: "manual" });
    expect(main.headers.get("location") ?? "").not.toContain(`/r/${SLUG_A}`);
  });

  it("has the headers of the form that the same page has on the instance's host, but for the HSTS pinning of the subdomains", async () => {
    const own = await get(HOST_A, `/r/${SLUG_A}`);
    const main = await get(MAIN, `/r/${SLUG_A}`);
    expect(noNonce(own.headers.get("content-security-policy") ?? "")).toBe(noNonce(main.headers.get("content-security-policy") ?? ""));
    expect(own.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(own.headers.get("referrer-policy")).toBe("same-origin");
    expect(main.headers.get("referrer-policy")).toBe("same-origin");
    expect(own.headers.get("strict-transport-security")).toBe("max-age=31536000");
    expect(main.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
    expect(await withoutHsts(own)).toEqual(await withoutHsts(main));
  });

  it("drops the pinning of the subdomains from the answers it hides and from the ticket page too", async () => {
    for (const path of ["/admin", `/t/${TOKEN_A}`, "/favicon.svg"]) {
      const res = await get(HOST_A, path);
      expect(res.headers.get("strict-transport-security") ?? "max-age=31536000", path).toBe("max-age=31536000");
    }
  });
});

describe("one address, one event", () => {
  it("serves the ticket page of its own event, and of another event the same 404 as for a token that is not one", async () => {
    expect((await get(HOST_A, `/t/${TOKEN_A}`)).status).toBe(200);
    const unknown = await withoutHsts(await get(HOST_A, "/t/not-a-ticket-token-AbCdEfGhIjKlMnOpQrStUvWxYz0123"));
    expect(unknown.status).toBe(404);
    expect(await withoutHsts(await get(HOST_A, `/t/${TOKEN_B}`))).toEqual(unknown);
    expect((await get(HOST_B, `/t/${TOKEN_B}`)).status).toBe(200);
    expect((await get(HOST_B, `/t/${TOKEN_A}`)).status).toBe(404);
  });

  it("keeps the old links on the instance's host: a ticket of either event is served there", async () => {
    expect((await get(MAIN, `/t/${TOKEN_A}`)).status).toBe(200);
    expect((await get(MAIN, `/t/${TOKEN_B}`)).status).toBe(200);
  });

  it("serves the wallet buttons of its own event's ticket (relative links) and not those of another event's", async () => {
    const page = await (await get(HOST_A, `/t/${TOKEN_A}`)).text();
    expect(page).not.toContain(`https://${MAIN}`);
    // The wallet route finds the ticket; with no wallet configured it answers a redirect back to the ticket page, not a 404.
    expect((await get(HOST_A, `/t/${TOKEN_A}/wallet/apple`, { redirect: "manual" })).status).toBe(302);
    const unknown = await withoutHsts(await get(HOST_A, "/t/not-a-ticket-token-AbCdEfGhIjKlMnOpQrStUvWxYz0123/wallet/apple", { redirect: "manual" }));
    expect(unknown.status).toBe(404);
    expect(await withoutHsts(await get(HOST_A, `/t/${TOKEN_B}/wallet/apple`, { redirect: "manual" }))).toEqual(unknown);
  });

  it("serves the QR image of its own event's ticket, and of another event's a 404 with no body", async () => {
    const own = await get(HOST_A, `/q/${TOKEN_A}.png`);
    expect(own.status).toBe(200);
    expect(own.headers.get("content-type")).toBe("image/png");
    const other = await get(HOST_A, `/q/${TOKEN_B}.png`);
    expect(other.status).toBe(404);
    expect(await other.text()).toBe("");
    expect((await get(MAIN, `/q/${TOKEN_B}.png`)).status).toBe(200);
  });

  it("serves the map image of its own event, and of another event a 404 that never asks the map service", async () => {
    expect((await get(HOST_A, `/m/${ids.a}.png`)).status).toBe(200);
    expect(getForEvent).toHaveBeenCalledTimes(1);
    const other = await get(HOST_A, `/m/${ids.b}.png`);
    expect(other.status).toBe(404);
    expect(await other.text()).toBe("");
    expect(getForEvent).toHaveBeenCalledTimes(1);
    expect((await get(MAIN, `/m/${ids.b}.png`)).status).toBe(200);
  });
});

describe("the form sent from a guest's address", () => {
  const post = (host: string, origin: string | null, slug = SLUG_PLAIN) =>
    h.app.request(`https://${host}/r/${slug}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) },
      body: JSON.stringify(h.body(slug)),
    });

  beforeEach(async () => {
    await setDomain(ids.plain, "plain.reg119b.example", true);
  });

  it("is accepted from the address it was shown on, and refused from another origin or none, as on the instance's host", async () => {
    const host = "plain.reg119b.example";
    expect((await post(host, `https://${host}`)).status).toBeLessThan(300);
    expect((await post(host, `https://${MAIN}`)).status).toBe(403);
    expect((await post(host, "https://evil.example.net")).status).toBe(403);
    expect((await post(host, `http://${host}`)).status).toBe(403);
    expect((await post(host, null)).status).toBe(403);
    // The same on the instance's own host.
    expect((await post(MAIN, ORIGIN)).status).toBeLessThan(300);
    expect((await post(MAIN, `https://${host}`)).status).toBe(403);
  });

  it("is not accepted on another event's address", async () => {
    const reference = await withoutHsts(await get(HOST_A, NOT_THERE));
    expect(await withoutHsts(await post(HOST_A, `https://${HOST_A}`, SLUG_PLAIN))).toEqual(reference);
  });
});

describe("GET /.well-known/admitto-domain-check", () => {
  it("answers the proof of the event and the address for a verified address and for a pending one", async () => {
    for (const [host, id] of [[HOST_A, ids.a], [HOST_B, ids.b], [HOST_PENDING, ids.pending]] as const) {
      const res = await get(host, "/.well-known/admitto-domain-check");
      expect(res.status, host).toBe(200);
      const body = (await res.json()) as { ok: boolean; mac: string };
      expect(body, host).toEqual({ ok: true, mac: expect.any(String) });
      expect(verifyDomainCheck(id, host, body.mac), host).toBe(true);
      expect(body.mac, host).toBe(signDomainCheck(id, host));
    }
  });

  it("gives one address the proof of no other event or address", async () => {
    const a = ((await (await get(HOST_A, "/.well-known/admitto-domain-check")).json()) as { mac: string }).mac;
    expect(verifyDomainCheck(ids.b, HOST_A, a)).toBe(false);
    expect(verifyDomainCheck(ids.a, HOST_B, a)).toBe(false);
  });

  it("is the 404 of a path that is not there on the instance's host and on a host that is nobody's", async () => {
    for (const host of [MAIN, HOST_UNKNOWN]) {
      expect((await get(host, "/.well-known/admitto-domain-check")).status, host).toBe(404);
    }
  });

  it("answers an address only while it is set: removing it takes the proof away", async () => {
    await setDomain(ids.pending, null, false);
    expect((await get(HOST_PENDING, "/.well-known/admitto-domain-check")).status).toBe(404);
  });
});

describe("the company sign-in on a guest's address", () => {
  const callbackOf = (began: Awaited<ReturnType<typeof goToProvider>>) => `${began.callbackUrl.pathname}${began.callbackUrl.search}`;

  it("ends a flow on the address it began on with the cookie of the guest, host-only and Secure", async () => {
    const jar = new Jar();
    const began = await goToProvider(onHost(HOST_A), jar, SLUG_A, idp);
    expect(began.start.headers.getSetCookie().every((line) => !/;\s*domain=/i.test(line) && /;\s*secure/i.test(line))).toBe(true);
    expect(began.authorizeUrl.searchParams.get("redirect_uri")).toBe(`https://${HOST_A}/sso/callback`);
    const done = await browse(onHost(HOST_A), jar, callbackOf(began));
    expect(done.status).toBe(302);
    expect(done.headers.get("location")).toBe(`/r/${SLUG_A}`);
    expect(jar.names()).toEqual([GUEST_SSO_SESSION_COOKIE]);
    expect(done.headers.getSetCookie().every((line) => !/;\s*domain=/i.test(line) && /;\s*secure/i.test(line))).toBe(true);
  });

  it("does not finish the flow of another event on an event's address, even when the browser carries its cookies there", async () => {
    const jar = new Jar();
    const began = await goToProvider(onHost(HOST_B), jar, SLUG_B, idp);
    const exchanged = idp.tokenRedirectUris().length;

    // A browser that sends the cookies of the flow of event B to the address of event A.
    const crossed = await browse(onHost(HOST_A), jar, callbackOf(began));

    expect(crossed.status).toBe(302);
    expect(crossed.headers.get("location")).toBe(`/r/${SLUG_B}?sso=failed`);
    expect(idp.tokenRedirectUris()).toHaveLength(exchanged);
    expect(jar.has(GUEST_SSO_SESSION_COOKIE)).toBe(false);
  });
});

describe("the memory of the addresses", () => {
  /** An app with the real lifetimes on a clock the test moves, and a superadmin who can change an address. */
  async function appWithMemory() {
    let now = Date.UTC(2026, 10, 12, 12, 0, 0);
    const app = createApp({
      prisma,
      checkinToken: "reg119b-routing-checkin-token-32!!",
      allowCheckinBearer: true,
      baseUrl: ORIGIN,
      rateLimitStore: createRateLimitStore(),
      skipCheckinBootValidation: true,
      adminDistRoot,
      guestHosts: { now: () => now },
    });
    const user = await prisma.user.upsert({ where: { email: SUPERADMIN }, update: {}, create: { email: SUPERADMIN } });
    await prisma.roleAssignment.deleteMany({ where: { user_id: user.id } });
    await prisma.roleAssignment.create({ data: { user_id: user.id, role: "superadmin", scope_type: "instance", scope_id: null } });
    await prisma.userMfaMethod.deleteMany({ where: { user_id: user.id } });
    await enrollConfirmedTotp(prisma, user.id);
    const cookie = await sessionCookieFor(prisma, user.id);
    return { app, cookie, advance: (ms: number) => (now += ms) };
  }

  it("keeps an answer for the lifetime of the entry, then reads the table again", async () => {
    const { app, advance } = await appWithMemory();
    const probe = (host: string) => app.request(`https://${host}/admin`, { redirect: "manual" });
    expect((await probe(HOST_A)).status).toBe(404);
    expect((await probe(HOST_UNKNOWN)).status).toBe(302);

    // The table changes behind the application's back: the old answers hold until they expire.
    await setDomain(ids.a, null, false);
    await prisma.eventRegistrationSettings.update({ where: { event_id: ids.plain }, data: { custom_domain: HOST_UNKNOWN, custom_domain_verified_at: new Date() } });
    expect((await probe(HOST_A)).status).toBe(404);
    expect((await probe(HOST_UNKNOWN)).status).toBe(302);

    advance(10_000); // the entry of a host that was nobody's is 10 s old
    expect((await probe(HOST_UNKNOWN)).status).toBe(404);
    expect((await probe(HOST_A)).status).toBe(404);
    advance(20_000); // 30 s since the address of A was read
    expect((await probe(HOST_A)).status).toBe(302);
  });

  it("forgets at once when a superadmin changes an address through this process", async () => {
    const { app, cookie } = await appWithMemory();
    const probe = (host: string) => app.request(`https://${host}/admin`, { redirect: "manual" });
    expect((await probe(HOST_A)).status).toBe(404);
    expect((await probe("moved.reg119b.example")).status).toBe(302);

    const put = await app.request(`https://${MAIN}/api/admin/events/${ids.a}/registration/custom-domain`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: cookie },
      body: JSON.stringify({ custom_domain: "moved.reg119b.example" }),
    });
    expect(put.status).toBe(200);
    // The change resets the proof: the old address is no guest's now, and the new one is only pending. Both are the instance's behaviour.
    expect((await probe(HOST_A)).status).toBe(302);
    expect((await probe("moved.reg119b.example")).status).toBe(302);
    expect((await app.request("https://moved.reg119b.example/.well-known/admitto-domain-check")).status).toBe(200);
    expect((await app.request(`https://${HOST_A}/.well-known/admitto-domain-check`)).status).toBe(404);
  });

  it("holds a bounded number of hosts however many different names come in", async () => {
    const { app } = await appWithMemory();
    const findUnique = vi.spyOn(prisma.eventRegistrationSettings, "findUnique");
    for (let i = 0; i < 1_200; i += 1) await app.request(`https://random-${i}.reg119b.example/healthz`);
    expect(findUnique).toHaveBeenCalledTimes(1_200);
    // A host seen a moment ago is not read again, and the real address is still known.
    findUnique.mockClear();
    expect((await app.request(`https://${HOST_A}/admin`)).status).toBe(404);
    expect((await app.request(`https://${HOST_A}/admin`)).status).toBe(404);
    expect(findUnique).toHaveBeenCalledTimes(1);
    findUnique.mockRestore();
  });
});

describe("a lookup that fails", () => {
  it("is a 500 that names neither the host nor what the database said, and the panel does not appear", async () => {
    const failing = new Proxy(prisma, {
      get(client, key) {
        if (key === "eventRegistrationSettings") {
          return {
            findUnique: async () => {
              throw new Error(`could not read ${HOST_A}`);
            },
          };
        }
        const value: unknown = Reflect.get(client, key);
        return typeof value === "function" ? value.bind(client) : value;
      },
    });
    const app = createApp({ prisma: failing, baseUrl: ORIGIN, skipCheckinBootValidation: true, checkinToken: null, allowCheckinBearer: false, adminDistRoot });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await app.request(`https://${HOST_A}/login`);
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "internal_error" });
      expect(JSON.stringify(logged.mock.calls.map((call) => call.map(String)))).not.toContain(HOST_A);
    } finally {
      logged.mockRestore();
    }
  });
});
