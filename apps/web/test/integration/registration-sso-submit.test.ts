/**
 * The page and `POST /r/:slug` of an event whose way in is the company sign-in (D-C4), through the real app and a real
 * database: what a guest sees before and after signing in, and what the route does with a form that carries (or lacks) a
 * sign-in. The flow that gives the cookie is in registration-sso-flow.test.ts; here the cookie is also made by hand, because
 * every way it can be wrong is a test.
 */
import { JSDOM } from "jsdom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { setSsoProviderId } from "../../src/registration/sso-provider.js";
import { TURNSTILE_SETTINGS_KEY } from "../../src/registration/turnstile-settings.js";
import { GUEST_SSO_SESSION_COOKIE as SESSION, GUEST_SSO_SESSION_TTL_MS, signGuestSsoSession } from "../../src/registration/sso-session.js";
import { startMockOidcIdp, stopMockOidcIdp, type MockOidcIdp } from "../helpers/mock-oidc-idp.js";
import { Jar, PROVIDER_ID, installProvider, removeProvider, walk } from "../helpers/registration-sso-harness.js";
import {
  ORIGIN,
  SelectiveStore,
  eventSeeder,
  harness,
  holdCapacityLock,
  nextEmail,
  recordingPace,
  signature,
} from "../helpers/registration-submit-harness.js";

const ORG = "org-reg118a-submit";
const SUBJECT = "mock-subject-oidc";
const EMAIL = "oidc-flow@example.com";

let prisma: PrismaClient;
let idp: MockOidcIdp;
let seeder: ReturnType<typeof eventSeeder>;
let h: ReturnType<typeof harness>;
let sleeper: ReturnType<typeof recordingPace>["sleep"];
let store: SelectiveStore;
let counter = 0;
const eventIds = new Map<string, string>();

async function addEvent(label: string, seed: Parameters<typeof seeder.addEvent>[1] = {}): Promise<string> {
  const slug = `reg118a-sub-${label}-${(counter += 1)}`;
  eventIds.set(
    slug,
    await seeder.addEvent(slug, { ...seed, settings: { access_methods: ["sso"], mode: "approval", verify_email: true, ...seed.settings } }),
  );
  return slug;
}

/** A guest who signed in through the whole flow. */
async function signedIn(slug: string, token: Parameters<typeof walk>[4] = {}): Promise<Jar> {
  const jar = new Jar();
  const w = await walk(h.app, jar, slug, idp, token);
  expect(w.callback.headers.get("location"), "the sign-in worked").toBe(`/r/${slug}`);
  return jar;
}

/** What the page sends for an event with the company sign-in: no challenge, and an address nobody reads. */
const bodyOf = (overrides: Record<string, unknown> = {}) => ({
  first_name: "Ada",
  last_name: "Example",
  email: "typed-by-the-guest@example.com",
  terms: true,
  consents: [] as string[],
  ...overrides,
});

const post = async (slug: string, jar: Jar, body: unknown = bodyOf(), headers: Record<string, string> = {}): Promise<Response> => {
  const cookie = jar.header(`/r/${slug}`);
  const res = await h.app.request(`${ORIGIN}/r/${slug}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: JSON.stringify(body),
  });
  jar.absorb(res);
  return res;
};

const page = (slug: string, jar: Jar, query = "") => {
  const cookie = jar.header(`/r/${slug}`);
  return h.app.request(`${ORIGIN}/r/${slug}${query}`, { headers: cookie ? { Cookie: cookie } : {} });
};

const rows = (slug: string) => prisma.registration.findMany({ where: { event_id: eventIds.get(slug)! }, include: { mails: true } });
const dom = async (res: Response) => new JSDOM(await res.text()).window.document;

beforeAll(async () => {
  prisma = createTestPrismaClient();
  idp = await startMockOidcIdp();
  seeder = eventSeeder(prisma, ORG);
  await seeder.prepare();
});

beforeEach(async () => {
  await installProvider(prisma, idp);
  const paced = recordingPace(250);
  sleeper = paced.sleep;
  store = new SelectiveStore();
  h = harness({ prisma, store, pace: paced.pace });
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  if (!prisma) return;
  await removeProvider(prisma);
  await seeder.wipe();
  await prisma.$disconnect();
  await stopMockOidcIdp(idp);
});

describe("the page of an event with the company sign-in", () => {
  it("asks a guest who has not signed in to sign in, and shows no form, no script and no widget", async () => {
    const slug = await addEvent("page-out");

    const res = await page(slug, new Jar());
    const html = await res.clone().text();
    const document = await dom(res);

    expect(res.status).toBe(200);
    expect(document.querySelector("form")).toBeNull();
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector(".cf-turnstile")).toBeNull();
    expect(document.querySelector("#reg-sign-in-link")?.getAttribute("href")).toBe(`/r/${slug}/sso/start`);
    expect(document.querySelector("h1")?.textContent).toContain("Submit Summit");
    expect(html).not.toContain("challenges.cloudflare.com");
    expect(res.headers.get("content-security-policy")).not.toContain("cloudflare");
    expect(res.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it("shows the form to a guest who has, with the address the provider gave locked and no bot check", async () => {
    const slug = await addEvent("page-in");
    const jar = await signedIn(slug);

    const res = await page(slug, jar);
    const document = await dom(res);

    expect(res.status).toBe(200);
    const email = document.querySelector("#f-email");
    expect(email?.value).toBe(EMAIL);
    expect(email?.hasAttribute("readonly")).toBe(true);
    expect(email?.hasAttribute("disabled")).toBe(false);
    expect(document.querySelector("#reg-form")).not.toBeNull();
    expect(document.querySelector(".cf-turnstile")).toBeNull();
    expect(document.querySelector('[data-kind="challenge"]')).toBeNull();
    expect(document.querySelector("#f-password")).toBeNull();
    // The widget's script and its frame are not in the page; the text of the form's script names the host in a sentence it never shows.
    expect(document.querySelector("script[src]")).toBeNull();
    expect(document.querySelector("iframe")).toBeNull();
    expect(res.headers.get("content-security-policy")).not.toContain("cloudflare");
    // Two scripts under the nonce of the response: the form's, and the small one of this way in.
    const nonce = /script-src 'nonce-([^']+)'/.exec(res.headers.get("content-security-policy") ?? "")?.[1];
    expect([...document.querySelectorAll("script")].map((script) => script.getAttribute("nonce"))).toEqual([nonce, nonce]);
    expect(document.querySelector("#reg-sign-in")).toBeNull();
  });

  it("says in the note that no link is sent: the provider vouches for the address, whatever the event's setting says", async () => {
    const slug = await addEvent("page-note", { settings: { verify_email: true } });
    const jar = await signedIn(slug);

    const text = (await dom(await page(slug, jar))).body.textContent ?? "";

    expect(text).toContain("This is the address from your company sign-in");
    expect(text).not.toContain("confirmation link");
    expect(text).not.toContain("confirm your address");
  });

  it("treats a cookie that is forged, expired, of another event or provider, or changed as no cookie: the sign-in page, byte for byte", async () => {
    const slug = await addEvent("page-bad");
    const other = await addEvent("page-bad-other");
    const good = await signedIn(slug);
    const goodValue = good.value(SESSION)!;
    const scope = { eventId: eventIds.get(slug)!, slug, providerId: PROVIDER_ID };
    const identity = { subject: SUBJECT, email: EMAIL, proof: null };
    const bad: [string, string][] = [
      ["forged", `${goodValue.split(".")[0]}.${"A".repeat(43)}`],
      ["changed", `${Buffer.from(JSON.stringify({ v: 1 })).toString("base64url")}.${goodValue.split(".")[1]}`],
      ["expired", signGuestSsoSession(scope, { ...identity, issuedAt: Date.now() - GUEST_SSO_SESSION_TTL_MS - 1_000 })],
      ["of another event", signGuestSsoSession({ ...scope, eventId: eventIds.get(other)!, slug: other }, { ...identity, issuedAt: Date.now() })],
      ["of another slug", signGuestSsoSession({ ...scope, slug: other }, { ...identity, issuedAt: Date.now() })],
      ["of another provider", signGuestSsoSession({ ...scope, providerId: "some-other-provider" }, { ...identity, issuedAt: Date.now() })],
      ["junk", "junk"],
    ];
    const withoutCookie = await (await page(slug, new Jar())).text();

    for (const [label, value] of bad) {
      const jar = new Jar();
      jar.set(SESSION, value, `/r/${slug}`);
      const res = await page(slug, jar);
      expect(await res.text(), label).toBe(withoutCookie);
    }
  });

  it("shows the sign-in page again once the provider chosen for guests is another one", async () => {
    const slug = await addEvent("page-provider");
    const jar = await signedIn(slug);
    await prisma.identityProvider.create({
      data: {
        id: "reg118a-second-idp",
        issuer: "https://second-idp.example.com/",
        client_id: "second",
        authorization_endpoint: "https://second-idp.example.com/authorize",
        token_endpoint: "https://second-idp.example.com/token",
        jwks_uri: "https://second-idp.example.com/jwks",
        display_name: "Second",
        enabled: true,
      },
    });
    try {
      await setSsoProviderId(prisma, "reg118a-second-idp");

      const document = await dom(await page(slug, jar));

      expect(document.querySelector("#reg-sign-in")).not.toBeNull();
      expect(document.querySelector("form")).toBeNull();
    } finally {
      await setSsoProviderId(prisma, PROVIDER_ID);
      await prisma.identityProvider.delete({ where: { id: "reg118a-second-idp" } });
    }
  });

  it("shows the sign-in page again when the event tightens its restriction, though the sign-in has not run out", async () => {
    const slug = await addEvent("page-tight", { settings: { sso_claim_name: "tid", sso_claim_values: ["tenant-a", "tenant-b"] } });
    const jar = await signedIn(slug, { claims: { tid: "tenant-a" } });
    expect((await dom(await page(slug, jar))).querySelector("#reg-form")).not.toBeNull();

    await prisma.eventRegistrationSettings.update({ where: { event_id: eventIds.get(slug)! }, data: { sso_claim_values: ["tenant-b"] } });

    expect((await dom(await page(slug, jar))).querySelector("#reg-form")).toBeNull();
    await prisma.eventRegistrationSettings.update({ where: { event_id: eventIds.get(slug)! }, data: { sso_claim_name: "groups", sso_claim_values: ["tenant-a"] } });
    expect((await dom(await page(slug, jar))).querySelector("#reg-form")).toBeNull();
  });

  it("keeps a sign-in whose restriction was lifted, and refuses one made before a restriction was set", async () => {
    const lifted = await addEvent("page-lift", { settings: { sso_claim_name: "tid", sso_claim_values: ["tenant-a"] } });
    const set = await addEvent("page-set");
    const liftedJar = await signedIn(lifted, { claims: { tid: "tenant-a" } });
    const setJar = await signedIn(set);

    await prisma.eventRegistrationSettings.update({ where: { event_id: eventIds.get(lifted)! }, data: { sso_claim_name: null, sso_claim_values: [] } });
    await prisma.eventRegistrationSettings.update({ where: { event_id: eventIds.get(set)! }, data: { sso_claim_name: "tid", sso_claim_values: ["tenant-a"] } });

    expect((await dom(await page(lifted, liftedJar))).querySelector("#reg-form")).not.toBeNull();
    expect((await dom(await page(set, setJar))).querySelector("#reg-form")).toBeNull();
  });

  it.each([
    ["no_email", "did not give us a verified email address"],
    ["not_allowed", "not open to your company account"],
    ["failed", "could not sign you in"],
  ])("tells a guest who came back with ?sso=%s so, in a sentence of the page's own", async (word, sentence) => {
    const slug = await addEvent(`page-notice-${word}`);

    const document = await dom(await page(slug, new Jar(), `?sso=${word}`));

    expect(document.querySelector("#reg-sso-notice")?.getAttribute("role")).toBe("alert");
    expect(document.querySelector("#reg-sso-notice")?.textContent).toContain(sentence);
  });

  it("reads one of three words from the query and nothing else, never printing what came", async () => {
    const slug = await addEvent("page-reflect");
    const attack = "%3Cscript%3Ealert(1)%3C/script%3E";

    for (const query of [`?sso=${attack}`, "?sso=FAILED", "?sso=constructor", "?sso=", `?sso=failed&x=${attack}`, `?${attack}=1`]) {
      const res = await page(slug, new Jar(), query);
      const text = await res.text();
      expect(text.includes("alert(1)"), query).toBe(false);
      expect(text.includes("<script>alert"), query).toBe(false);
      if (!query.startsWith("?sso=failed")) expect(text.includes("reg-sso-notice"), query).toBe(false);
    }
  });

  it("does not show a notice to a guest who is signed in", async () => {
    const slug = await addEvent("page-notice-in");
    const jar = await signedIn(slug);

    const document = await dom(await page(slug, jar, "?sso=failed"));

    expect(document.querySelector("#reg-sso-notice")).toBeNull();
    expect(document.querySelector("#reg-form")).not.toBeNull();
  });

  it("is the 404 of the registration routes while the provider is off, as for a stranger, and the page of an event of the link is the page it was", async () => {
    const slug = await addEvent("page-off");
    await installProvider(prisma, idp, { enabled: false });

    const res = await page(slug, new Jar());

    expect(res.status).toBe(404);
    expect(await signature(res)).toEqual(await signature(await page("reg118a-no-such-event", new Jar())));
  });

  it("makes the page of the sign-in the same for every event but its words: no database value reaches the markup of the button", async () => {
    const slug = await addEvent("page-button");

    const html = await (await page(slug, new Jar())).text();

    expect(html).not.toContain(PROVIDER_ID);
    expect(html).not.toContain(idp.baseUrl);
    expect(html).not.toContain("client_id");
  });
});

describe("POST /r/:slug without a sign-in that checks out", () => {
  it("is the one 401, whatever is wrong with the cookie, and writes nothing", async () => {
    const slug = await addEvent("post-401");
    const other = await addEvent("post-401-other");
    const good = await signedIn(slug);
    const scope = { eventId: eventIds.get(slug)!, slug, providerId: PROVIDER_ID };
    const identity = { subject: SUBJECT, email: EMAIL, proof: null };
    const cookies: [string, string | null][] = [
      ["no cookie", null],
      ["junk", "junk"],
      ["a changed signature", `${good.value(SESSION)!.split(".")[0]}.${"B".repeat(43)}`],
      ["an expired sign-in", signGuestSsoSession(scope, { ...identity, issuedAt: Date.now() - GUEST_SSO_SESSION_TTL_MS - 1 })],
      ["the sign-in of another event", signGuestSsoSession({ ...scope, eventId: eventIds.get(other)!, slug: other }, { ...identity, issuedAt: Date.now() })],
      ["the sign-in of another provider", signGuestSsoSession({ ...scope, providerId: "another-provider" }, { ...identity, issuedAt: Date.now() })],
    ];

    const answers: unknown[] = [];
    for (const [label, value] of cookies) {
      const jar = new Jar();
      if (value !== null) jar.set(SESSION, value, `/r/${slug}`);
      const res = await post(slug, jar);
      expect(res.status, label).toBe(401);
      expect(await res.clone().json(), label).toEqual({ error: "sign_in_required" });
      answers.push(await signature(res));
    }

    // The same bytes for every reason: nothing tells a stranger which it was.
    expect(new Set(answers.map((answer) => JSON.stringify(answer))).size).toBe(1);
    expect(await rows(slug)).toHaveLength(0);
    expect(sleeper).not.toHaveBeenCalled();
  });

  it("does not read the bot challenge of such a body, and does not call Cloudflare", async () => {
    const slug = await addEvent("post-no-challenge");

    const res = await post(slug, new Jar(), bodyOf({ challenge: h.cf.token(slug) }));

    expect(res.status).toBe(401);
    expect(h.cf.mock).not.toHaveBeenCalled();
  });

  it("refuses a cookie of an event that is used at another, though both have the sign-in", async () => {
    const slug = await addEvent("post-cross");
    const other = await addEvent("post-cross-other");
    const jar = await signedIn(slug);
    const crossed = new Jar();
    crossed.set(SESSION, jar.value(SESSION)!, `/r/${other}`);

    const res = await post(other, crossed);

    expect(res.status).toBe(401);
    expect(await rows(other)).toHaveLength(0);
  });

  it("refuses a sign-in that is thirty minutes old, though the browser still holds its cookie", async () => {
    const slug = await addEvent("post-expiry");
    const jar = await signedIn(slug);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + GUEST_SSO_SESSION_TTL_MS + 1_000);

    const res = await post(slug, jar);

    expect(res.status).toBe(401);
    expect(await rows(slug)).toHaveLength(0);
  });

  it("refuses a sign-in the event's restriction does not let in any more, and one made before the event had a restriction", async () => {
    const tightened = await addEvent("post-tight", { settings: { sso_claim_name: "tid", sso_claim_values: ["tenant-a", "tenant-b"] } });
    const added = await addEvent("post-added");
    const tightJar = await signedIn(tightened, { claims: { tid: "tenant-a" } });
    const addedJar = await signedIn(added);

    await prisma.eventRegistrationSettings.update({ where: { event_id: eventIds.get(tightened)! }, data: { sso_claim_values: ["tenant-b"] } });
    await prisma.eventRegistrationSettings.update({ where: { event_id: eventIds.get(added)! }, data: { sso_claim_name: "tid", sso_claim_values: ["tenant-a"] } });

    expect((await post(tightened, tightJar)).status).toBe(401);
    expect((await post(added, addedJar)).status).toBe(401);
    expect(await rows(tightened)).toHaveLength(0);
    expect(await rows(added)).toHaveLength(0);
  });

  it("refuses a sign-in once the provider chosen for guests is another one", async () => {
    const slug = await addEvent("post-provider");
    const jar = await signedIn(slug);
    await prisma.identityProvider.create({
      data: {
        id: "reg118a-post-idp",
        issuer: "https://post-idp.example.com/",
        client_id: "post",
        authorization_endpoint: "https://post-idp.example.com/authorize",
        token_endpoint: "https://post-idp.example.com/token",
        jwks_uri: "https://post-idp.example.com/jwks",
        display_name: "Post",
        enabled: true,
      },
    });
    try {
      await setSsoProviderId(prisma, "reg118a-post-idp");

      expect((await post(slug, jar)).status).toBe(401);
    } finally {
      await setSsoProviderId(prisma, PROVIDER_ID);
      await prisma.identityProvider.delete({ where: { id: "reg118a-post-idp" } });
    }
  });

  it("is still the cross-site check and the 404 of a form that is not open, before the sign-in is looked at", async () => {
    const slug = await addEvent("post-order");
    const jar = await signedIn(slug);
    const cookie = jar.header(`/r/${slug}`);

    const crossSite = await h.app.request(`${ORIGIN}/r/${slug}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://evil.example.net", Cookie: cookie },
      body: JSON.stringify(bodyOf()),
    });
    await prisma.eventRegistrationSettings.update({ where: { event_id: eventIds.get(slug)! }, data: { mode: null } });
    const closed = await post(slug, jar);

    expect(crossSite.status).toBe(403);
    expect(closed.status).toBe(404);
    expect(await rows(slug)).toHaveLength(0);
  });
});

describe("POST /r/:slug with a sign-in", () => {
  it("registers the guest under the address and the person the provider gave, and ignores the address of the body", async () => {
    const slug = await addEvent("post-ok");
    const jar = await signedIn(slug);

    const res = await post(slug, jar, bodyOf({ email: "attacker@example.com" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const [row] = await rows(slug);
    expect(row).toMatchObject({
      email: EMAIL,
      first_name: "Ada",
      last_name: "Example",
      status: "pending",
      sso_provider_id: PROVIDER_ID,
      sso_subject: SUBJECT,
      confirm_expires_at: null,
    });
    expect(row?.email_verified_at).not.toBeNull();
    expect(row?.mails.map((mail) => mail.template_name)).toEqual(["registration-received"]);
    expect(await prisma.registration.count({ where: { email: "attacker@example.com" } })).toBe(0);
  });

  it("needs no Turnstile keys, calls Cloudflare for nothing, and ignores a challenge or a password in the body", async () => {
    const slug = await addEvent("post-no-keys");
    await prisma.systemSettings.deleteMany({ where: { key: TURNSTILE_SETTINGS_KEY } });
    const jar = await signedIn(slug);

    const res = await post(slug, jar, bodyOf({ challenge: "refused:anything:1", password: "a password nobody asked for" }));

    expect(res.status).toBe(200);
    expect(h.cf.mock).not.toHaveBeenCalled();
    expect(await rows(slug)).toHaveLength(1);
  });

  it("accepts the guest at once in an automatic event with a seat: an attendee and the ticket mail, no confirmation", async () => {
    const slug = await addEvent("post-auto", { settings: { mode: "automatic" }, capacity: 5 });
    const jar = await signedIn(slug);

    expect((await post(slug, jar)).status).toBe(200);

    const [row] = await rows(slug);
    expect(row).toMatchObject({ status: "accepted", email: EMAIL, sso_subject: SUBJECT });
    expect(row?.attendee_id).not.toBeNull();
    expect(row?.mails.map((mail) => mail.template_name)).toEqual(["ticket"]);
    expect(await prisma.attendee.count({ where: { event_id: eventIds.get(slug)!, email: EMAIL } })).toBe(1);
  });

  it("stores the person and the address and no claim of the token, and not the value of the claim of the restriction", async () => {
    const slug = await addEvent("post-claims", { settings: { sso_claim_name: "tid", sso_claim_values: ["tenant-secret-guid"] } });
    const jar = await signedIn(slug, { claims: { tid: "tenant-secret-guid", groups: ["admins"], phone_number: "+48123456789", name: "Ada Lovelace" } });

    expect((await post(slug, jar)).status).toBe(200);

    const stored = JSON.stringify(await rows(slug));
    expect(stored).not.toContain("tenant-secret-guid");
    expect(stored).not.toContain("admins");
    expect(stored).not.toContain("+48123456789");
    expect(stored).not.toContain("Lovelace");
  });

  it("spends the sign-in with the answer that says it was received, and with no other", async () => {
    const slug = await addEvent("post-spend");
    const jar = await signedIn(slug);

    const refused = await post(slug, jar, bodyOf({ first_name: "" }));
    expect(refused.status).toBe(422);
    expect(jar.has(SESSION)).toBe(true);

    const accepted = await post(slug, jar);
    expect(accepted.status).toBe(200);
    expect(accepted.headers.getSetCookie().find((line) => line.startsWith(`${SESSION}=`))).toMatch(/Max-Age=0/);
    expect(jar.has(SESSION)).toBe(false);
    expect((await post(slug, jar)).status).toBe(401);
  });

  it("keeps the sign-in for a form that is refused, an event that is full and a lock that is held", async () => {
    const slug = await addEvent("post-keep", { settings: { mode: "automatic", waitlist_enabled: false }, capacity: 1 });
    const jar = await signedIn(slug);
    expect((await post(slug, jar, bodyOf({ terms: false }))).status).toBe(422);
    expect(jar.has(SESSION)).toBe(true);

    const lock = holdCapacityLock(prisma, eventIds.get(slug)!);
    await lock.started;
    const busy = await h.app.request(`${ORIGIN}/r/${slug}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: jar.header(`/r/${slug}`) },
      body: JSON.stringify(bodyOf()),
    });
    await lock.release();
    expect(busy.status).toBe(503);
    expect(await busy.json()).toEqual({ error: "try_again" });
    expect(await rows(slug)).toHaveLength(0);

    await prisma.attendee.create({ data: { id: "reg118a-seat", event_id: eventIds.get(slug)!, email: nextEmail("seat"), name: "Seat", status: "registered" } });
    const full = await post(slug, jar);
    expect(full.status).toBe(409);
    expect(await full.json()).toEqual({ error: "full" });
    expect(jar.has(SESSION)).toBe(true);
  });

  it("asks the terms and the consents of the event as for any guest", async () => {
    const slug = await addEvent("post-consents", { settings: { consent_keys: ["photos"] }, legal: { consents: ["photos"] } });
    const jar = await signedIn(slug);

    const missing = await post(slug, jar, bodyOf({ terms: false }));
    const unknown = await post(slug, jar, bodyOf({ consents: ["not-a-consent"] }));
    const ok = await post(slug, jar, bodyOf({ consents: ["photos"] }));

    expect(missing.status).toBe(422);
    expect(unknown.status).toBe(400);
    expect(ok.status).toBe(200);
    expect((await rows(slug))[0]?.consents).toHaveProperty("photos");
  });
});

describe("POST /r/:slug: one answer for every address, and one place for a person (D-C2)", () => {
  /** Waits for the floor, as every answer after the sign-in is checked does. */
  const floors = () => sleeper.mock.calls.map(([ms]) => ms);

  it("answers a new person, the same person again, the same person under another address, and an address another person holds, with the same bytes", async () => {
    const slug = await addEvent("same");
    const first = await signedIn(slug);
    const firstAnswer = await post(slug, first);
    // A second tab of the same browser, still holding the cookie.
    const again = await signedIn(slug);
    const secondTab = new Jar();
    secondTab.set(SESSION, again.value(SESSION)!, `/r/${slug}`);
    const sameAgain = await post(slug, secondTab);
    const moved = await signedIn(slug, { claims: { email: "moved-to-another@example.com" } });
    const sameUnderOtherAddress = await post(slug, moved);
    const other = await signedIn(slug, { subject: "another-person", claims: { email: EMAIL } });
    const otherHoldsAddress = await post(slug, other);

    const answers = [firstAnswer, sameAgain, sameUnderOtherAddress, otherHoldsAddress];
    expect(answers.map((res) => res.status)).toEqual([200, 200, 200, 200]);
    const signatures = await Promise.all(answers.map(async (res) => JSON.stringify(await signature(res))));
    expect(new Set(signatures).size).toBe(1);
    // One registration, one mail, the first person's: nothing was changed or added.
    const stored = await rows(slug);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ email: EMAIL, sso_subject: SUBJECT });
    expect(stored[0]?.mails).toHaveLength(1);
    expect(floors()).toEqual([250, 250, 250, 250]);
  });

  it("answers an address that an attendee holds like any other, and adds nothing", async () => {
    const slug = await addEvent("attendee-holds");
    await prisma.attendee.create({ data: { id: "reg118a-held", event_id: eventIds.get(slug)!, email: EMAIL, name: "Held", status: "registered" } });
    const jar = await signedIn(slug);

    const res = await post(slug, jar);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await rows(slug)).toHaveLength(0);
  });

  it("makes one registration of two requests for one person at the same moment, and answers both alike", async () => {
    const slug = await addEvent("race");
    const jar = await signedIn(slug);
    const copy = new Jar();
    copy.set(SESSION, jar.value(SESSION)!, `/r/${slug}`);

    const [one, two] = await Promise.all([post(slug, jar), post(slug, copy)]);

    expect([one.status, two.status]).toEqual([200, 200]);
    expect(await signature(one)).toEqual(await signature(two));
    expect(await rows(slug)).toHaveLength(1);
  });

  it("is told what the P2002 of a race is told: the same answer, after the same wait", async () => {
    const slug = await addEvent("p2002");
    const jar = await signedIn(slug);
    const seeded = await prisma.registration.create({
      data: {
        event_id: eventIds.get(slug)!,
        email: "someone-else@example.com",
        first_name: "Some",
        last_name: "One",
        name: "Some One",
        status: "pending",
        sso_provider_id: PROVIDER_ID,
        sso_subject: SUBJECT,
      },
    });

    const res = await post(slug, jar);

    expect(res.status).toBe(200);
    expect(await prisma.registration.count({ where: { event_id: eventIds.get(slug)! } })).toBe(1);
    expect((await prisma.registration.findUniqueOrThrow({ where: { id: seeded.id } })).email).toBe("someone-else@example.com");
    expect(floors()).toEqual([250]);
  });

  it("withholds the mail, and stores the registration, when the budget of the address is spent: the answer does not change", async () => {
    const slug = await addEvent("budget");
    const jar = await signedIn(slug);
    store.deny = (key) => key.startsWith("registration:mail-recipient:");

    const res = await post(slug, jar);

    expect(res.status).toBe(200);
    const [row] = await rows(slug);
    expect(row).toMatchObject({ email: EMAIL });
    expect(row?.mails).toHaveLength(0);
  });
});
