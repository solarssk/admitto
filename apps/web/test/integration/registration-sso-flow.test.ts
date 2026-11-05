/**
 * `GET /r/:slug/sso/start` and the one `GET /sso/callback` (D-C4) against a real database and a stand-in identity provider, through the
 * real app: what the start does, what a callback is refused for (every way to make a guest sign in as somebody else), what
 * it hands out, and that the whole flow creates nothing of staff and logs nothing of the guest.
 *
 * The provider is the mock of the staff sign-in tests. By default it spends a code on its first use, as a real one does; the
 * tests of a second callback let it accept the code again, so that it is the state of the flow and not the provider that
 * stops it.
 */
import { Hono } from "hono";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { codeChallengeS256 } from "@admitto/auth";
import type { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";
import { setEnabledAccessMethods } from "../../src/registration/access-methods.js";
import { handleSsoCallback, handleSsoStart } from "../../src/registration/sso-routes.js";
import { setSsoProviderId } from "../../src/registration/sso-provider.js";
import { verifyGuestSsoSession } from "../../src/registration/sso-session.js";
import { createGuestSsoState } from "../../src/registration/sso-state.js";
import { newGuestSsoStateValue } from "../../src/registration/sso-state-value.js";
import { startMockOidcIdp, stopMockOidcIdp, type MockOidcIdp } from "../helpers/mock-oidc-idp.js";
import {
  GUEST_SSO_CALLBACK_PATH,
  GUEST_SSO_SESSION_COOKIE,
  Jar,
  PROVIDER_ID,
  browse,
  callbackPath,
  flowCookieName,
  goToProvider,
  installProvider,
  removeProvider,
  startPath,
  walk,
} from "../helpers/registration-sso-harness.js";
import { ORIGIN, PAST, SelectiveStore, eventSeeder, harness, signature } from "../helpers/registration-submit-harness.js";

const ORG = "org-reg118a-flow";
const SUBJECT = "mock-subject-oidc";
const EMAIL = "oidc-flow@example.com";

let prisma: PrismaClient;
let idp: MockOidcIdp;
let seeder: ReturnType<typeof eventSeeder>;
let h: ReturnType<typeof harness>;
let counter = 0;
const eventIds = new Map<string, string>();

/** An event whose way in is the company sign-in, open, with its slug. */
async function addEvent(label: string, seed: Parameters<typeof seeder.addEvent>[1] = {}): Promise<string> {
  const slug = `reg118a-${label}-${(counter += 1)}`;
  eventIds.set(slug, await seeder.addEvent(slug, { ...seed, settings: seed.settings === null ? null : { access_methods: ["sso"], mode: "approval", ...seed.settings } }));
  return slug;
}

/** How many times the provider's token endpoint was called since the test began. */
let baseline = 0;
const calls = () => idp.tokenRequests() - baseline;
const stateRows = () => prisma.registrationSsoState.findMany({ orderBy: { created_at: "asc" } });
const failedAt = (slug: string, word = "failed") => `/r/${slug}?sso=${word}`;
/** A browser that holds the flow cookie of `state`, the way the start puts it there. */
const holdFlow = (jar: Jar, state: string) => jar.set(flowCookieName(state), state, GUEST_SSO_CALLBACK_PATH);

/**
 * `db`, but the provider is switched off the moment after it was read for the first time: after the check that the event is
 * open (which reads the provider to know the company sign-in is available), before the read that fetches the provider's settings.
 */
function switchProviderOffAfterFirstRead(db: PrismaClient): PrismaClient {
  let reads = 0;
  const provider = new Proxy(db.identityProvider, {
    get(model, key) {
      if (key !== "findFirst") return Reflect.get(model, key);
      return async (args: Parameters<typeof model.findFirst>[0]) => {
        const row = await model.findFirst(args);
        reads += 1;
        if (reads === 1) await model.update({ where: { id: PROVIDER_ID }, data: { enabled: false } });
        return row;
      };
    },
  });
  return new Proxy(db, {
    get(client, key) {
      if (key === "identityProvider") return provider;
      const value: unknown = Reflect.get(client, key);
      return typeof value === "function" ? value.bind(client) : value;
    },
  });
}

beforeAll(async () => {
  prisma = createTestPrismaClient();
  idp = await startMockOidcIdp();
  seeder = eventSeeder(prisma, ORG);
  await seeder.prepare();
  h = harness({ prisma, store: new SelectiveStore() });
});

beforeEach(async () => {
  await installProvider(prisma, idp);
  await prisma.registrationSsoState.deleteMany();
  (h.store as SelectiveStore).inner.reset();
  (h.store as SelectiveStore).deny = () => false;
  idp.reuseCodes(false);
  baseline = idp.tokenRequests();
  resetSystemLogBufferForTest();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  if (!prisma) return;
  await prisma.registrationSsoState.deleteMany();
  await removeProvider(prisma);
  await seeder.wipe();
  await prisma.$disconnect();
  await stopMockOidcIdp(idp);
});

describe("the start", () => {
  it("sends the guest to the provider with PKCE, a state and a nonce, and the address of the guest callback to come back to", async () => {
    const slug = await addEvent("start");
    const jar = new Jar();

    const { start, authorizeUrl, state, nonce } = await goToProvider(h.app, jar, slug, idp);

    expect(start.status).toBe(302);
    expect(authorizeUrl.origin + authorizeUrl.pathname).toBe(idp.authorizeEndpoint);
    const query = authorizeUrl.searchParams;
    expect(query.get("response_type")).toBe("code");
    expect(query.get("client_id")).toBe("test-oidc-client");
    expect(query.get("redirect_uri")).toBe("https://tickets.example.com/sso/callback");
    expect(query.get("scope")).toBe("openid email profile");
    expect(query.get("code_challenge_method")).toBe("S256");
    expect(state).toBe(`${state.slice(0, 43)}.${slug}`);
    expect(state.slice(0, 43)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(state).not.toBe(nonce);

    const [row] = await stateRows();
    expect(row).toMatchObject({ state, nonce, event_id: eventIds.get(slug), provider_id: PROVIDER_ID, consumed_at: null });
    expect(codeChallengeS256(row!.code_verifier)).toBe(query.get("code_challenge"));
    // Ten minutes, counted from now.
    expect(row!.expires_at.getTime() - Date.now()).toBeGreaterThan(9 * 60_000);
    expect(row!.expires_at.getTime() - Date.now()).toBeLessThanOrEqual(10 * 60_000);
  });

  it("sets the flow cookie, with the state as its value, and no other cookie", async () => {
    const slug = await addEvent("start-cookie");
    const jar = new Jar();

    const { start, state } = await goToProvider(h.app, jar, slug, idp);

    expect(jar.names()).toEqual([flowCookieName(state)]);
    expect(jar.value(flowCookieName(state))).toBe(state);
    const line = start.headers.getSetCookie()[0]!;
    expect(line).toContain("Path=/sso/callback;");
    expect(line).toContain("HttpOnly");
  });

  it("is never cached and sends no referrer, and a new state every time", async () => {
    const slug = await addEvent("start-headers");

    const first = await browse(h.app, new Jar(), startPath(slug));
    const second = await browse(h.app, new Jar(), startPath(slug));

    expect(first.headers.get("cache-control")).toBe("no-store");
    expect(first.headers.get("referrer-policy")).toBe("no-referrer");
    expect(first.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new URL(first.headers.get("location")!).searchParams.get("state")).not.toBe(new URL(second.headers.get("location")!).searchParams.get("state"));
  });

  it("is the one 404 of the registration routes for an event that is not open with the company sign-in, and writes nothing", async () => {
    const link = await addEvent("start-link", { settings: { access_methods: ["link"] } });
    const off = await addEvent("start-off", { settings: { mode: null } });
    const archived = await addEvent("start-archived", { archived: true });
    const over = await addEvent("start-over", { date: PAST });
    const noPrivacy = await addEvent("start-notice", { legal: { privacy: false } });
    await setEnabledAccessMethods(prisma, ["sso", "link"]);
    const unknown = await signature(await browse(h.app, new Jar(), startPath("reg118a-no-such-event")));

    for (const slug of [link, off, archived, over, noPrivacy, "Bad_Slug_With_Capitals", "a b"]) {
      const res = await browse(h.app, new Jar(), startPath(slug));
      expect(res.status, slug).toBe(404);
      expect(await signature(res), slug).toEqual(unknown);
      expect(res.headers.getSetCookie(), slug).toEqual([]);
    }
    expect(await stateRows()).toHaveLength(0);
  });

  it("is the same 404 while no provider is chosen, the chosen one is switched off, or it was deleted", async () => {
    const slug = await addEvent("start-provider");
    const unknown = await signature(await browse(h.app, new Jar(), startPath("reg118a-no-such-event")));

    for (const breakIt of [
      () => setSsoProviderId(prisma, null),
      () => installProvider(prisma, idp, { enabled: false }),
      () => removeProvider(prisma),
    ]) {
      await breakIt();
      const res = await browse(h.app, new Jar(), startPath(slug));
      expect(await signature(res)).toEqual(unknown);
    }
    expect(await stateRows()).toHaveLength(0);
  });

  it("is held to the budget per client address, and writes nothing past it", async () => {
    const slug = await addEvent("start-limit");
    (h.store as SelectiveStore).deny = (key) => key.startsWith("registration:sso:ip:");

    const res = await browse(h.app, new Jar(), startPath(slug));

    expect(res.status).toBe(429);
    expect(await stateRows()).toHaveLength(0);
  });

  it("goes back to the page with the general notice, and writes nothing, when the instance has no address to come back to", async () => {
    const slug = await addEvent("start-no-url");
    const app = new Hono();
    app.get("/r/:slug/sso/start", (c) => handleSsoStart(c, { db: prisma, baseUrl: async () => Promise.reject(new Error("no address")) }));

    const res = await app.request(`https://tickets.example.com${startPath(slug)}`);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(failedAt(slug));
    expect(await stateRows()).toHaveLength(0);
  });
});

describe("the callback: a guest who signs in", () => {
  it("gets a signed cookie for the page of the event, the flow cookie is deleted, and the answer is a redirect to the page", async () => {
    const slug = await addEvent("ok");
    const jar = new Jar();

    const w = await walk(h.app, jar, slug, idp);

    expect(w.callback.status).toBe(302);
    expect(w.callback.headers.get("location")).toBe(`/r/${slug}`);
    expect(w.callback.headers.get("cache-control")).toBe("no-store");
    expect(w.callback.headers.get("referrer-policy")).toBe("no-referrer");
    expect(jar.names()).toEqual([GUEST_SSO_SESSION_COOKIE]);
    const lines = w.callback.headers.getSetCookie();
    expect(lines.find((line) => line.startsWith(`${flowCookieName(w.state)}=`))).toMatch(/Max-Age=0/);
    expect(lines.find((line) => line.startsWith(`${GUEST_SSO_SESSION_COOKIE}=`))).toContain(`Path=/r/${slug}`);
    const identity = verifyGuestSsoSession(jar.value(GUEST_SSO_SESSION_COOKIE), { eventId: eventIds.get(slug)!, slug, providerId: PROVIDER_ID }, Date.now());
    expect(identity).toMatchObject({ providerId: PROVIDER_ID, subject: SUBJECT, email: EMAIL, proof: null });
    // The state is spent.
    expect((await stateRows())[0]?.consumed_at).not.toBeNull();
  });

  it("goes only to the page of the event, whatever the request carries: no return address is read from it", async () => {
    const slug = await addEvent("no-next");
    const jar = new Jar();
    const before = await goToProvider(h.app, jar, slug, idp);
    const evil = `${before.callbackUrl.pathname}${before.callbackUrl.search}&next=https://evil.example.net&return=https://evil.example.net&redirect=//evil.example.net`;

    const res = await browse(h.app, jar, evil);

    expect(res.headers.get("location")).toBe(`/r/${slug}`);
  });
});

describe("the callback: a refusal also takes away the sign-in the browser still holds", () => {
  const SESSION_LINE = new RegExp(`^${GUEST_SSO_SESSION_COOKIE}=;.*Max-Age=0`, "i");

  /** A browser that is signed in as the previous guest, on the page of `slug`. */
  async function signedInJar(slug: string): Promise<Jar> {
    const jar = new Jar();
    await walk(h.app, jar, slug, idp);
    expect(jar.has(GUEST_SSO_SESSION_COOKIE)).toBe(true);
    return jar;
  }

  const pageHtml = async (slug: string, jar: Jar) => (await browse(h.app, jar, `/r/${slug}`)).text();

  it.each([
    ["a callback without the flow cookie", "csrf"],
    ["a callback without a code", "params"],
    ["a callback with a state the system never wrote", "unknown-state"],
  ])("deletes the session cookie on %s, and the next visit to the page shows the sign-in", async (_label, kind) => {
    const slug = await addEvent(`refuse-${kind}`);
    const jar = await signedInJar(slug);
    expect(await pageHtml(slug, jar)).toContain('id="reg-form"');
    let path: string;
    if (kind === "csrf") {
      const other = await goToProvider(h.app, new Jar(), slug, idp);
      path = `${other.callbackUrl.pathname}${other.callbackUrl.search}`;
    } else if (kind === "unknown-state") {
      const made = `${"n".repeat(43)}.${slug}`;
      holdFlow(jar, made);
      path = `${callbackPath()}?code=abc&state=${made}`;
    } else {
      const own = await goToProvider(h.app, jar, slug, idp);
      path = `${callbackPath()}?state=${own.state}`;
    }

    const res = await browse(h.app, jar, path);

    expect(res.headers.get("location")).toBe(failedAt(slug));
    expect(res.headers.getSetCookie().some((line) => SESSION_LINE.test(line))).toBe(true);
    expect(jar.has(GUEST_SSO_SESSION_COOKIE)).toBe(false);
    const html = await pageHtml(slug, jar);
    expect(html).not.toContain('id="reg-form"');
    expect(html).toContain('id="reg-sign-in-link"');
  });

  it("deletes the session cookie when the company restriction turns the guest away (not_allowed)", async () => {
    const slug = await addEvent("refuse-not-allowed", { settings: { sso_claim_name: "tid", sso_claim_values: ["tenant-a"] } });
    const jar = new Jar();
    await walk(h.app, jar, slug, idp, { claims: { tid: "tenant-a" } });
    expect(jar.has(GUEST_SSO_SESSION_COOKIE)).toBe(true);

    const w = await walk(h.app, jar, slug, idp, { claims: { tid: "tenant-evil" } });

    expect(w.callback.headers.get("location")).toBe(failedAt(slug, "not_allowed"));
    expect(jar.has(GUEST_SSO_SESSION_COOKIE)).toBe(false);
  });
});

describe("the one callback of the instance", () => {
  it("is the same address for every event, so the provider is told of it once", async () => {
    const first = await addEvent("one-address-a");
    const second = await addEvent("one-address-b");

    const a = await goToProvider(h.app, new Jar(), first, idp);
    const b = await goToProvider(h.app, new Jar(), second, idp);

    expect(a.authorizeUrl.searchParams.get("redirect_uri")).toBe("https://tickets.example.com/sso/callback");
    expect(b.authorizeUrl.searchParams.get("redirect_uri")).toBe(a.authorizeUrl.searchParams.get("redirect_uri"));
    expect(a.callbackUrl.pathname).toBe(GUEST_SSO_CALLBACK_PATH);
  });

  it("is not under the pages of the events, and the callback of an event's own path is gone", async () => {
    const slug = await addEvent("old-path");
    const jar = new Jar();
    const before = await goToProvider(h.app, jar, slug, idp);
    const unknown = await signature(await browse(h.app, new Jar(), "/r/reg118a-no-such-event/sso/nothing"));

    const old = await browse(h.app, jar, `/r/${slug}/sso/callback${before.callbackUrl.search}`);

    expect(old.status).toBe(404);
    expect(old.headers.get("location")).toBeNull();
    expect(await signature(old)).toEqual(unknown);
    expect((await stateRows())[0]?.consumed_at).toBeNull();
  });

  it("lets one browser sign in for two events at once: two flows in two tabs, and neither cookie is overwritten", async () => {
    const first = await addEvent("tabs-a");
    const second = await addEvent("tabs-b");
    const jar = new Jar();

    const a = await goToProvider(h.app, jar, first, idp);
    const b = await goToProvider(h.app, jar, second, idp);
    expect(jar.flowNames().sort((x, y) => x.localeCompare(y, "en"))).toEqual([flowCookieName(a.state), flowCookieName(b.state)].sort((x, y) => x.localeCompare(y, "en")));
    // The second tab finishes first.
    const backB = await browse(h.app, jar, `${b.callbackUrl.pathname}${b.callbackUrl.search}`);
    const backA = await browse(h.app, jar, `${a.callbackUrl.pathname}${a.callbackUrl.search}`);

    expect(backB.headers.get("location")).toBe(`/r/${second}`);
    expect(backA.headers.get("location")).toBe(`/r/${first}`);
    expect(jar.flowNames()).toEqual([]);
    // Each answer set the cookie of its own event, for the path of that event, signed for that event.
    for (const [slug, back] of [[first, backA], [second, backB]] as const) {
      const line = back.headers.getSetCookie().find((entry) => entry.startsWith(`${GUEST_SSO_SESSION_COOKIE}=`))!;
      expect(line, slug).toContain(`Path=/r/${slug};`);
      const value = line.slice(GUEST_SSO_SESSION_COOKIE.length + 1, line.indexOf(";"));
      expect(verifyGuestSsoSession(value, { eventId: eventIds.get(slug)!, slug, providerId: PROVIDER_ID }, Date.now()), slug).toMatchObject({ subject: SUBJECT });
    }
  });

  it("goes back only to /r/<a slug> or to the 404, whatever the slug in the state says", async () => {
    const hostile = [
      "https://evil.example",
      "//evil.example",
      "../",
      "..%2F..%2Fadmin",
      "a/b",
      "evil.example",
      "UPPER",
      "",
      "s".repeat(81),
      "x\r\nLocation: https://evil.example",
    ];
    for (const hint of hostile) {
      const state = `${"h".repeat(43)}.${hint}`;

      const res = await browse(h.app, new Jar(), `${callbackPath()}?code=abc&state=${encodeURIComponent(state)}`);

      expect(res.status, hint).toBe(404);
      expect(res.headers.get("location"), hint).toBeNull();
    }
    // A hint that is a slug, of an event that does not exist, goes to the 404 page of that path: still only /r/<slug>.
    const state = `${"h".repeat(43)}.no-such-event`;
    const jar = new Jar();
    holdFlow(jar, state);
    const res = await browse(h.app, jar, `${callbackPath()}?code=abc&state=${state}`);
    expect(res.headers.get("location")).toBe(failedAt("no-such-event"));
    expect(calls()).toBe(0);
  });

  it("refuses the code of one flow used in another: the provider spent it, and nobody is signed in", async () => {
    const slug = await addEvent("same-code");
    const first = await walk(h.app, new Jar(), slug, idp);
    expect(first.callback.headers.get("location")).toBe(`/r/${slug}`);
    const code = first.callbackUrl.searchParams.get("code")!;
    const jar = new Jar();
    const second = await goToProvider(h.app, jar, slug, idp);

    const res = await browse(h.app, jar, `${callbackPath()}?code=${code}&state=${second.state}`);

    expect(res.headers.get("location")).toBe(failedAt(slug));
    expect(jar.has(GUEST_SSO_SESSION_COOKIE)).toBe(false);
  });

  it("goes back to the page of the event of the row, not to the one the slug in the state names", async () => {
    const slug = await addEvent("row-wins");
    const eventId = eventIds.get(slug)!;
    const written = newGuestSsoStateValue("some-other-slug");
    await createGuestSsoState(prisma, { state: written.value, nonce: "n", codeVerifier: "v", eventId, providerId: PROVIDER_ID }, new Date());
    const jar = new Jar();
    holdFlow(jar, written.value);

    const res = await browse(h.app, jar, `${callbackPath()}?code=abc&state=${written.value}`);

    // The provider does not know the code, so it is refused, and the guest goes back to the page of the event of the ROW.
    expect(res.headers.get("location")).toBe(failedAt(slug));
  });
});

describe("the callback: every way to make a guest sign in as somebody else, or as nobody", () => {
  it("refuses a callback that comes without the flow cookie (login CSRF), before it asks the provider for anything", async () => {
    const slug = await addEvent("csrf");
    // The attacker starts a flow in their own browser and hands the callback link, with their code and state, to the victim.
    const attacker = new Jar();
    const { callbackUrl } = await goToProvider(h.app, attacker, slug, idp);
    const victim = new Jar();
    const requestsBefore = calls();

    const res = await browse(h.app, victim, `${callbackUrl.pathname}${callbackUrl.search}`);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(failedAt(slug));
    expect(victim.names()).toEqual([]);
    expect(calls()).toBe(requestsBefore);
    // Not even the state was touched: the check of the cookie came before everything that depends on the code.
    expect((await stateRows())[0]?.consumed_at).toBeNull();
  });

  it("refuses a callback whose flow cookie is another flow's state", async () => {
    const slug = await addEvent("other-state");
    const first = await goToProvider(h.app, new Jar(), slug, idp);
    const second = await goToProvider(h.app, new Jar(), slug, idp);
    const browser = new Jar();
    holdFlow(browser, second.state);

    const res = await browse(h.app, browser, `${first.callbackUrl.pathname}${first.callbackUrl.search}`);

    expect(res.headers.get("location")).toBe(failedAt(slug));
    // The cookie of the other flow is no help to this callback, and is left where it is.
    expect(browser.flowNames()).toEqual([flowCookieName(second.state)]);
    expect(browser.has(GUEST_SSO_SESSION_COOKIE)).toBe(false);
    expect((await stateRows()).every((row) => row.consumed_at === null)).toBe(true);
    expect(calls()).toBe(0);
  });

  it("refuses a callback with no code, or with a code that is empty or absurdly long, back to the form it began from", async () => {
    const slug = await addEvent("params");
    const jar = new Jar();
    const { state } = await goToProvider(h.app, jar, slug, idp);

    for (const query of [`?state=${state}`, `?code=&state=${state}`, `?code=${"c".repeat(5_000)}&state=${state}`]) {
      const res = await browse(h.app, jar, `${callbackPath()}${query}`);
      expect(res.headers.get("location"), query.slice(0, 20)).toBe(failedAt(slug));
    }
    expect(calls()).toBe(0);
  });

  it("is the one 404, with nothing set, for a callback with no state, an empty state, a state that is absurdly long or one of no shape of ours", async () => {
    const slug = await addEvent("no-state");
    const jar = new Jar();
    await goToProvider(h.app, jar, slug, idp);
    const unknown = await signature(await browse(h.app, new Jar(), "/r/reg118a-no-such-event"));

    for (const query of ["", "?code=abc", "?code=abc&state=", `?code=abc&state=${"s".repeat(300)}`, "?code=abc&state=made-up-state", `?code=abc&state=${"a".repeat(43)}`]) {
      const res = await browse(h.app, jar, `${callbackPath()}${query}`);
      expect(res.status, query.slice(0, 24)).toBe(404);
      expect(res.headers.get("location"), query.slice(0, 24)).toBeNull();
      expect(res.headers.getSetCookie(), query.slice(0, 24)).toEqual([]);
      expect(await signature(res), query.slice(0, 24)).toEqual(unknown);
    }
    expect(calls()).toBe(0);
  });

  it("refuses the answer of a provider that turned the guest down, and does not repeat what it said", async () => {
    const slug = await addEvent("denied");
    const jar = new Jar();
    const { state } = await goToProvider(h.app, jar, slug, idp);

    const res = await browse(h.app, jar, `${callbackPath()}?error=access_denied&error_description=Ada%20Lovelace%20said%20no&state=${state}`);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(failedAt(slug));
    expect(JSON.stringify([...res.headers.entries()])).not.toContain("Lovelace");
    expect(await res.text()).not.toContain("Lovelace");
  });

  it("refuses a callback with a state the system never wrote, though the cookie says it is that state", async () => {
    const slug = await addEvent("unknown-state");
    const jar = new Jar();
    const made = `${"m".repeat(43)}.${slug}`;
    holdFlow(jar, made);

    const res = await browse(h.app, jar, `${callbackPath()}?code=abc&state=${made}`);

    expect(res.headers.get("location")).toBe(failedAt(slug));
    expect(calls()).toBe(0);
  });

  it("refuses a state that is used twice, and the second callback signs nobody in", async () => {
    const slug = await addEvent("replay");
    const jar = new Jar();
    const first = await walk(h.app, jar, slug, idp);
    expect(first.callback.headers.get("location")).toBe(`/r/${slug}`);
    idp.reuseCodes(true);
    const replayer = new Jar();
    holdFlow(replayer, first.state);

    const second = await browse(h.app, replayer, `${first.callbackUrl.pathname}${first.callbackUrl.search}`);

    expect(second.headers.get("location")).toBe(failedAt(slug));
    expect(replayer.has(GUEST_SSO_SESSION_COOKIE)).toBe(false);
    expect(calls()).toBe(1);
  });

  it("refuses a state that ran out, without asking the provider", async () => {
    const slug = await addEvent("expired");
    const jar = new Jar();
    const before = await goToProvider(h.app, jar, slug, idp);
    await prisma.registrationSsoState.updateMany({ where: { state: before.state }, data: { expires_at: new Date(Date.now() - 1_000) } });

    const res = await browse(h.app, jar, `${before.callbackUrl.pathname}${before.callbackUrl.search}`);

    expect(res.headers.get("location")).toBe(failedAt(slug));
    expect(jar.has(GUEST_SSO_SESSION_COOKIE)).toBe(false);
    expect(calls()).toBe(0);
  });

  it("refuses an ID token whose nonce is not the flow's", async () => {
    const slug = await addEvent("nonce");
    const jar = new Jar();

    const w = await walk(h.app, jar, slug, idp, { nonce: "a-nonce-of-another-flow" });

    expect(w.callback.headers.get("location")).toBe(failedAt(slug));
    expect(jar.has(GUEST_SSO_SESSION_COOKIE)).toBe(false);
    expect(calls()).toBe(1);
  });

  it("refuses a code the provider does not know, and the state is spent all the same", async () => {
    const slug = await addEvent("bad-code");
    const jar = new Jar();
    const { state } = await goToProvider(h.app, jar, slug, idp);

    const res = await browse(h.app, jar, `${callbackPath()}?code=not-a-code-of-the-provider&state=${state}`);

    expect(res.headers.get("location")).toBe(failedAt(slug));
    expect((await stateRows())[0]?.consumed_at).not.toBeNull();
  });

  it("lets exactly one of two callbacks with one state win, though the provider would accept the code twice", async () => {
    const slug = await addEvent("race");
    idp.reuseCodes(true);
    const first = new Jar();
    const before = await goToProvider(h.app, first, slug, idp);
    const second = new Jar();
    holdFlow(second, before.state);
    const target = `${before.callbackUrl.pathname}${before.callbackUrl.search}`;

    const [one, two] = await Promise.all([browse(h.app, first, target), browse(h.app, second, target)]);

    const locations = [one, two].map((res) => res.headers.get("location")).sort((a, b) => String(a).localeCompare(String(b), "en"));
    expect(locations).toEqual([`/r/${slug}`, failedAt(slug)].sort((a, b) => String(a).localeCompare(String(b), "en")));
    expect([first, second].filter((jar) => jar.has(GUEST_SSO_SESSION_COOKIE))).toHaveLength(1);
    // The one that lost never asked the provider.
    expect(calls()).toBe(1);
  });

  it("is the 404, with the flow cookie deleted, when the provider is switched off between the start and the callback", async () => {
    const slug = await addEvent("provider-off");
    const jar = new Jar();
    const before = await goToProvider(h.app, jar, slug, idp);
    await prisma.identityProvider.update({ where: { id: PROVIDER_ID }, data: { enabled: false } });

    const res = await browse(h.app, jar, `${before.callbackUrl.pathname}${before.callbackUrl.search}`);

    expect(res.status).toBe(404);
    expect(jar.names()).toEqual([]);
    expect(calls()).toBe(0);
  });

  it("goes back to the page with the general notice, with the flow cookie deleted and without asking the provider, when the provider is switched off in the instant after the event was found open", async () => {
    const slug = await addEvent("provider-race");
    const jar = new Jar();
    const before = await goToProvider(h.app, jar, slug, idp);
    const racing = new Hono();
    racing.get(GUEST_SSO_CALLBACK_PATH, (c) =>
      handleSsoCallback(c, { db: switchProviderOffAfterFirstRead(prisma), baseUrl: async () => "https://tickets.example.com" }),
    );

    const res = await racing.request(`${ORIGIN}${before.callbackUrl.pathname}${before.callbackUrl.search}`, {
      headers: { Cookie: jar.header(before.callbackUrl.pathname) },
    });
    jar.absorb(res);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(failedAt(slug));
    expect(jar.names()).toEqual([]);
    expect(calls()).toBe(0);
    const refusals = querySystemLogs({ source: "security" }).filter((entry) => entry.message === "registration_sso_refused");
    expect(refusals.map((entry) => entry.fields)).toEqual([{ reason: "provider_unavailable", event_id: eventIds.get(slug) }]);
  });

  it("is the 404 when the event has closed between the start and the callback", async () => {
    const slug = await addEvent("event-off");
    const jar = new Jar();
    const before = await goToProvider(h.app, jar, slug, idp);
    await prisma.eventRegistrationSettings.update({ where: { event_id: eventIds.get(slug)! }, data: { mode: null } });

    const res = await browse(h.app, jar, `${before.callbackUrl.pathname}${before.callbackUrl.search}`);

    expect(res.status).toBe(404);
    expect(jar.has(GUEST_SSO_SESSION_COOKIE)).toBe(false);
    expect(calls()).toBe(0);
  });

  it("takes the event from the row of the state, never from the slug the state carries: a state that names another event signs the guest in for its own", async () => {
    const slug = await addEvent("hint");
    const other = await addEvent("hint-other");
    const jar = new Jar();
    const before = await goToProvider(h.app, jar, slug, idp);
    // A guest who builds the request by hand puts the slug of ANOTHER event in the state of a real flow.
    const forged = newGuestSsoStateValue(other).value;
    await prisma.registrationSsoState.updateMany({ where: { state: before.state }, data: { state: forged } });
    holdFlow(jar, forged);
    const code = before.callbackUrl.searchParams.get("code");

    const res = await browse(h.app, jar, `${callbackPath()}?code=${code}&state=${forged}`);

    expect(res.headers.get("location")).toBe(`/r/${slug}`);
    expect(res.headers.getSetCookie().find((line) => line.startsWith(`${GUEST_SSO_SESSION_COOKIE}=`))).toContain(`Path=/r/${slug};`);
    expect(jar.has(GUEST_SSO_SESSION_COOKIE)).toBe(true);
  });

  it("refuses a state that was written for another provider than the one the event has now", async () => {
    const slug = await addEvent("mismatch");
    const second = new Jar();
    const again = await goToProvider(h.app, second, slug, idp);
    await prisma.identityProvider.create({
      data: {
        id: "reg118a-other-idp",
        issuer: "https://other-idp.example.com/",
        client_id: "other",
        authorization_endpoint: "https://other-idp.example.com/authorize",
        token_endpoint: "https://other-idp.example.com/token",
        jwks_uri: "https://other-idp.example.com/jwks",
        display_name: "Other",
        enabled: true,
      },
    });
    try {
      await prisma.registrationSsoState.updateMany({ where: { state: again.state }, data: { provider_id: "reg118a-other-idp" } });

      const wrongProvider = await browse(h.app, second, `${again.callbackUrl.pathname}${again.callbackUrl.search}`);

      expect(wrongProvider.headers.get("location")).toBe(failedAt(slug));
      expect(second.has(GUEST_SSO_SESSION_COOKIE)).toBe(false);
      expect(calls()).toBe(0);
    } finally {
      await prisma.registrationSsoState.deleteMany({ where: { provider_id: "reg118a-other-idp" } });
      await prisma.identityProvider.delete({ where: { id: "reg118a-other-idp" } });
    }
  });

  it("goes back to the page with the general notice, without asking the provider, when the instance has no address to build the redirect on", async () => {
    const slug = await addEvent("callback-no-url");
    const jar = new Jar();
    const before = await goToProvider(h.app, jar, slug, idp);
    const bare = new Hono();
    bare.get(GUEST_SSO_CALLBACK_PATH, (c) => handleSsoCallback(c, { db: prisma, baseUrl: async () => Promise.reject(new Error("no address")) }));

    const res = await bare.request(`${ORIGIN}${before.callbackUrl.pathname}${before.callbackUrl.search}`, {
      headers: { Cookie: jar.header(before.callbackUrl.pathname) },
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(failedAt(slug));
    expect(calls()).toBe(0);
  });

  it("is held to the budget per client address", async () => {
    (h.store as SelectiveStore).deny = (key) => key.startsWith("registration:sso:ip:");

    const res = await browse(h.app, new Jar(), `${callbackPath()}?code=a&state=b`);

    expect(res.status).toBe(429);
  });
});

describe("the callback: what the token says of the guest", () => {
  it("refuses an address the provider says it did not verify, and signs a guest in when it says nothing or says yes", async () => {
    const slug = await addEvent("verified");

    for (const email_verified of [false, "false"]) {
      const jar = new Jar();
      const w = await walk(h.app, jar, slug, idp, { claims: { email_verified } });
      expect(w.callback.headers.get("location"), String(email_verified)).toBe(failedAt(slug, "no_email"));
      expect(jar.has(GUEST_SSO_SESSION_COOKIE)).toBe(false);
    }
    for (const claims of [{ email_verified: true }, { email_verified: "true" }, {}]) {
      const jar = new Jar();
      const w = await walk(h.app, jar, slug, idp, { claims });
      expect(w.callback.headers.get("location"), JSON.stringify(claims)).toBe(`/r/${slug}`);
      expect(jar.has(GUEST_SSO_SESSION_COOKIE)).toBe(true);
    }
  });

  it("refuses a guest the provider gives no address for, with the notice about the address", async () => {
    const slug = await addEvent("no-email");
    const jar = new Jar();

    const w = await walk(h.app, jar, slug, idp, { claims: { email: undefined } });

    expect(w.callback.headers.get("location")).toBe(failedAt(slug, "no_email"));
    expect(jar.has(GUEST_SSO_SESSION_COOKIE)).toBe(false);
  });

  it("refuses a token without a subject", async () => {
    const slug = await addEvent("no-sub");
    const jar = new Jar();

    const w = await walk(h.app, jar, slug, idp, { subject: "" });

    expect(w.callback.headers.get("location")).toBe(failedAt(slug));
    expect(jar.has(GUEST_SSO_SESSION_COOKIE)).toBe(false);
  });

  describe("with the restriction of the event to one company", () => {
    const restricted = (label: string) =>
      addEvent(label, { settings: { sso_claim_name: "tid", sso_claim_values: ["tenant-a", "tenant-b"] } });
    const sessionOf = (jar: Jar, slug: string) =>
      verifyGuestSsoSession(jar.value(GUEST_SSO_SESSION_COOKIE), { eventId: eventIds.get(slug)!, slug, providerId: PROVIDER_ID }, Date.now());

    it("lets in a guest whose claim is one of the values, and keeps which in the cookie", async () => {
      const slug = await restricted("claim-ok");
      const jar = new Jar();

      const w = await walk(h.app, jar, slug, idp, { claims: { tid: "tenant-b" } });

      expect(w.callback.headers.get("location")).toBe(`/r/${slug}`);
      expect(sessionOf(jar, slug)?.proof).toEqual({ name: "tid", value: "tenant-b" });
    });

    it("lets in a guest whose claim is a list that holds one of the values", async () => {
      const slug = await restricted("claim-list");
      const jar = new Jar();

      const w = await walk(h.app, jar, slug, idp, { claims: { tid: ["tenant-z", "tenant-a"] } });

      expect(w.callback.headers.get("location")).toBe(`/r/${slug}`);
      expect(sessionOf(jar, slug)?.proof).toEqual({ name: "tid", value: "tenant-a" });
    });

    it.each([
      ["a value that is not listed", { tid: "tenant-evil" }],
      ["a value that differs by case", { tid: "TENANT-A" }],
      ["a claim that is a list with no listed value", { tid: ["x", "y"] }],
      ["no such claim", {}],
      ["a claim that is not text", { tid: 7 }],
      ["an address that ends as a listed value does", { email: "ada@tenant-a" }],
    ])("refuses a guest with %s, signs nobody in, and says nothing of the values", async (_label, claims) => {
      const slug = await restricted("claim-no");
      const jar = new Jar();

      const w = await walk(h.app, jar, slug, idp, { claims });

      expect(w.callback.headers.get("location")).toBe(failedAt(slug, "not_allowed"));
      expect(jar.has(GUEST_SSO_SESSION_COOKIE)).toBe(false);
      const everything = JSON.stringify([...w.callback.headers.entries()]) + (await w.callback.text());
      expect(everything).not.toContain("tenant-a");
      expect(everything).not.toContain("tenant-b");
    });

    it("judges the restriction as the event has it at the callback, not as it had at the start", async () => {
      const slug = await restricted("claim-moved");
      const jar = new Jar();
      const before = await goToProvider(h.app, jar, slug, idp, { claims: { tid: "tenant-a" } });
      await prisma.eventRegistrationSettings.update({ where: { event_id: eventIds.get(slug)! }, data: { sso_claim_values: ["tenant-b"] } });

      const res = await browse(h.app, jar, `${before.callbackUrl.pathname}${before.callbackUrl.search}`);

      expect(res.headers.get("location")).toBe(failedAt(slug, "not_allowed"));
    });
  });
});

describe("the whole flow creates nothing of staff", () => {
  const tables = async () => ({
    users: await prisma.user.count(),
    externalIdentities: await prisma.externalIdentity.count(),
    sessions: await prisma.session.count(),
    roleAssignments: await prisma.roleAssignment.count(),
    oidcAuthStates: await prisma.oidcAuthState.count(),
    groupGrants: await prisma.oidcRoleGrant.count(),
    mfaMethods: await prisma.userMfaMethod.count(),
  });

  it("leaves User, ExternalIdentity, Session, RoleAssignment, OidcAuthState and the grants of the provider as they were, signed in or refused", async () => {
    const slug = await addEvent("no-staff", { settings: { sso_claim_name: "tid", sso_claim_values: ["tenant-a"] } });
    const before = await tables();
    // The provider says the guest is in the groups of an administrator: groups of the provider are not read by this flow.
    const claimsOf = [{ tid: "tenant-a", groups: ["admins", "superadmins"] }, { tid: "tenant-x" }, { tid: "tenant-a", email_verified: false }, { tid: "tenant-a", email: undefined }];

    for (const claims of claimsOf) {
      const jar = new Jar();
      const w = await walk(h.app, jar, slug, idp, { claims });
      expect(jar.names().filter((name) => name !== GUEST_SSO_SESSION_COOKIE)).toEqual([]);
      expect(w.callback.headers.getSetCookie().map((line) => line.split("=")[0])).not.toContain("admitto_session");
    }
    await goToProvider(h.app, new Jar(), slug, idp);

    expect(await tables()).toEqual(before);
  });

  it("does not leave an account of staff behind for a guest whose address a member of staff also holds", async () => {
    const slug = await addEvent("same-address");
    const staff = await prisma.user.create({ data: { email: EMAIL, password_hash: "not-a-hash" } });
    try {
      const before = await tables();
      const jar = new Jar();

      const w = await walk(h.app, jar, slug, idp);

      expect(w.callback.headers.get("location")).toBe(`/r/${slug}`);
      expect(await tables()).toEqual(before);
      expect(await prisma.session.count({ where: { user_id: staff.id } })).toBe(0);
      expect(await prisma.externalIdentity.count({ where: { user_id: staff.id } })).toBe(0);
    } finally {
      await prisma.user.delete({ where: { id: staff.id } });
    }
  });
});

describe("what the flow writes to a log and to an answer", () => {
  it("holds no code, state, nonce, token, subject, address or claim of the guest, in a log line, in the system log, or in an answer", async () => {
    const lines: string[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(" "));
      });
    }
    const slug = await addEvent("logs", { settings: { sso_claim_name: "tid", sso_claim_values: ["tenant-secret-guid"] } });
    const logged = harness({ prisma, store: new SelectiveStore(), logHttpRequests: true });
    const answers: string[] = [];
    const secrets: string[] = [SUBJECT, EMAIL, "tenant-secret-guid", "tenant-evil-guid"];

    // A success, and a refusal of each kind the callback has.
    for (const token of [
      { claims: { tid: "tenant-secret-guid" } },
      { claims: { tid: "tenant-evil-guid" } },
      { claims: { tid: "tenant-secret-guid", email_verified: false } },
      { claims: { tid: "tenant-secret-guid", email: undefined } },
      { nonce: "a-nonce-of-another-flow", claims: { tid: "tenant-secret-guid" } },
    ]) {
      const jar = new Jar();
      const before = await goToProvider(logged.app, jar, slug, idp, token);
      const code = before.callbackUrl.searchParams.get("code")!;
      secrets.push(before.state, before.nonce, code);
      const res = await browse(logged.app, jar, `${before.callbackUrl.pathname}${before.callbackUrl.search}`);
      answers.push(JSON.stringify([...res.headers.entries()].filter(([name]) => name !== "set-cookie")), await res.text());
      secrets.push(...(await stateRows()).map((row) => row.code_verifier));
    }
    // And the failures that stop before the token: an unknown code, a state that is made up.
    const jar = new Jar();
    const made = `${"q".repeat(43)}.${slug}`;
    holdFlow(jar, made);
    const res = await browse(logged.app, jar, `${callbackPath()}?code=made-up-code-value&state=${made}`);
    answers.push(JSON.stringify([...res.headers.entries()]), await res.text());
    secrets.push(made, "made-up-code-value");

    const everything = [
      ...lines,
      JSON.stringify(querySystemLogs({})),
      ...answers,
    ].join("\n");
    for (const secret of secrets) expect(everything, secret.slice(0, 12)).not.toContain(secret);
    expect(everything).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
    // The access log names the route and not what the provider sent back.
    const requests = lines.filter((line) => line.includes("http_request")).map((line) => JSON.parse(line) as { path: string });
    expect(requests.some((entry) => entry.path === GUEST_SSO_CALLBACK_PATH)).toBe(true);
    expect(requests.every((entry) => !entry.path.includes("?"))).toBe(true);
    // A refusal is one line with a reason from a fixed set and the id of the event.
    const refusals = querySystemLogs({ source: "security" }).filter((entry) => entry.message === "registration_sso_refused");
    expect(refusals.length).toBeGreaterThanOrEqual(5);
    for (const entry of refusals) {
      // The reason, and the id of the event once the state has named it.
      const keys = Object.keys(entry.fields ?? {}).sort((a, b) => String(a).localeCompare(String(b), "en"));
      expect(["reason", "event_id,reason"]).toContain(keys.join(","));
      expect(entry.fields?.["reason"]).toMatch(/^[a-z_]+$/);
    }
  });
});
