/**
 * The two cookies of a guest's company sign-in (D-C4): what is signed, what is refused, and the attributes they are set with.
 * Every refusal is the same null, so a guest can be told nothing of why.
 */
import { createHmac } from "node:crypto";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getEncryptionKey } from "@admitto/crypto";
import {
  GUEST_SSO_SESSION_COOKIE,
  GUEST_SSO_SESSION_TTL_MS,
  GUEST_SSO_STATE_TTL_MS,
  clearGuestSsoFlowCookie,
  clearGuestSsoSessionCookie,
  guestSsoFlowCookieMatches,
  readGuestSsoSession,
  setGuestSsoFlowCookie,
  setGuestSsoSessionCookie,
  signGuestSsoSession,
  verifyGuestSsoSession,
  type GuestSsoScope,
} from "../../src/registration/sso-session.js";
import { GUEST_SSO_FLOW_COOKIE_PREFIX, newGuestSsoStateValue, parseGuestSsoStateValue } from "../../src/registration/sso-state-value.js";

const NOW = Date.UTC(2026, 10, 5, 12, 0, 0);
const scope: GuestSsoScope = { eventId: "evt-1", slug: "northwind-summit", providerId: "idp-1" };
const flow = newGuestSsoStateValue("northwind-summit");
const identity = { subject: "00uabc123", email: "ada@example.com", issuedAt: NOW, proof: null };

afterEach(() => {
  vi.unstubAllEnvs();
});

/** A cookie value signed with the instance key under a domain of the caller's choosing, around any payload. */
function signedAs(domain: string, payload: unknown): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${createHmac("sha256", getEncryptionKey()).update(`${domain}${encoded}`).digest("base64url")}`;
}

const DOMAIN = "registration-sso-session:v1:";
const payloadOf = (overrides: Record<string, unknown> = {}) => ({
  v: 1,
  ev: scope.eventId,
  sl: scope.slug,
  pr: scope.providerId,
  su: identity.subject,
  em: identity.email,
  iat: NOW,
  ...overrides,
});

describe("the session cookie: what it carries", () => {
  it("gives back the sign-in it was made from, for the event, the slug and the provider it was made for", () => {
    const value = signGuestSsoSession(scope, identity);

    expect(verifyGuestSsoSession(value, scope, NOW + 1_000)).toEqual({ providerId: "idp-1", ...identity });
  });

  it("carries the claim of the restriction and the one value it held, together", () => {
    const value = signGuestSsoSession(scope, { ...identity, proof: { name: "tid", value: "tenant-a" } });

    expect(verifyGuestSsoSession(value, scope, NOW)?.proof).toEqual({ name: "tid", value: "tenant-a" });
  });

  it("holds the person, the address and the time, and no token and no claim of the provider but the one of the restriction", () => {
    const value = signGuestSsoSession(scope, { ...identity, proof: { name: "tid", value: "tenant-a" } });

    const payload = JSON.parse(Buffer.from(value.split(".")[0]!, "base64url").toString("utf8")) as Record<string, unknown>;

    expect(Object.keys(payload).sort((a, b) => String(a).localeCompare(String(b), "en"))).toEqual(["cn", "cv", "em", "ev", "iat", "pr", "sl", "su", "v"]);
  });
});

describe("the session cookie: what is read as no cookie", () => {
  it("a value changed after it was signed: the address, the person, the event, the time", () => {
    const value = signGuestSsoSession(scope, identity);
    const [encoded, signature] = value.split(".") as [string, string];
    const original = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Record<string, unknown>;

    for (const change of [{ em: "mallory@example.com" }, { su: "someone-else" }, { ev: "evt-2" }, { iat: NOW + 600_000 }]) {
      const forged = `${Buffer.from(JSON.stringify({ ...original, ...change })).toString("base64url")}.${signature}`;
      expect(verifyGuestSsoSession(forged, scope, NOW), JSON.stringify(change)).toBeNull();
    }
  });

  it("a signature that is changed, cut, doubled or from nowhere", () => {
    const value = signGuestSsoSession(scope, identity);
    const [encoded, signature] = value.split(".") as [string, string];
    const flipped = `${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`;

    for (const bad of [`${encoded}.${flipped}`, `${encoded}.${signature.slice(0, 10)}`, `${encoded}.${signature}${signature}`, `${encoded}.`, `${encoded}`]) {
      expect(verifyGuestSsoSession(bad, scope, NOW), bad.slice(-12)).toBeNull();
    }
  });

  it("a value signed under another domain of the same key: the confirmation link, or a made-up domain, is not a sign-in", () => {
    for (const domain of ["registration-confirm:", "registration-sso-session:v2:", "", "oidc-flow:"]) {
      expect(verifyGuestSsoSession(signedAs(domain, payloadOf()), scope, NOW), domain).toBeNull();
    }
    expect(verifyGuestSsoSession(signedAs(DOMAIN, payloadOf()), scope, NOW)).not.toBeNull();
  });

  it("a sign-in of another event, another slug or another provider, so a cookie of one event is nothing at another", () => {
    const value = signGuestSsoSession(scope, identity);

    expect(verifyGuestSsoSession(value, { ...scope, eventId: "evt-2" }, NOW)).toBeNull();
    expect(verifyGuestSsoSession(value, { ...scope, slug: "another-summit" }, NOW)).toBeNull();
    expect(verifyGuestSsoSession(value, { ...scope, providerId: "idp-2" }, NOW)).toBeNull();
  });

  it("a sign-in that is thirty minutes old, to the millisecond, and not one that is a millisecond younger", () => {
    const value = signGuestSsoSession(scope, identity);

    expect(verifyGuestSsoSession(value, scope, NOW + GUEST_SSO_SESSION_TTL_MS - 1)).not.toBeNull();
    expect(verifyGuestSsoSession(value, scope, NOW + GUEST_SSO_SESSION_TTL_MS)).toBeNull();
    expect(GUEST_SSO_SESSION_TTL_MS).toBe(30 * 60 * 1000);
  });

  it("a sign-in issued in the future, beyond a minute of drift between two servers", () => {
    const value = signGuestSsoSession(scope, { ...identity, issuedAt: NOW + 60_000 });
    const tooFar = signGuestSsoSession(scope, { ...identity, issuedAt: NOW + 60_001 });

    expect(verifyGuestSsoSession(value, scope, NOW)).not.toBeNull();
    expect(verifyGuestSsoSession(tooFar, scope, NOW)).toBeNull();
  });

  it("anything that is not one: nothing, empty, junk, a value too long, a payload of the wrong shape signed by us", () => {
    const wrongShapes: unknown[] = [
      [],
      "text",
      null,
      payloadOf({ v: 2 }),
      payloadOf({ su: "" }),
      payloadOf({ su: "s".repeat(256) }),
      payloadOf({ em: 7 }),
      payloadOf({ iat: "now" }),
      payloadOf({ iat: Number.NaN }),
      payloadOf({ cn: "tid" }),
      payloadOf({ cv: "tenant-a" }),
      payloadOf({ cn: "", cv: "x" }),
    ];

    for (const value of [undefined, "", "junk", "a.b.c", ".", "..", `${"x".repeat(3_000)}.y`, ...wrongShapes.map((payload) => signedAs(DOMAIN, payload))]) {
      expect(verifyGuestSsoSession(value, scope, NOW), String(value).slice(0, 24)).toBeNull();
    }
  });
});

describe("the cookies as they are set", () => {
  function app() {
    const hono = new Hono();
    hono.get("/set", (c) => {
      setGuestSsoSessionCookie(c, scope, identity);
      setGuestSsoFlowCookie(c, flow);
      return c.body(null, 204);
    });
    hono.get("/clear", (c) => {
      clearGuestSsoSessionCookie(c, scope.slug);
      clearGuestSsoFlowCookie(c, flow);
      return c.body(null, 204);
    });
    return hono;
  }

  const line = (res: Response, name: string) => res.headers.getSetCookie().find((entry) => entry.startsWith(`${name}=`)) ?? "";

  it("sets the session cookie host-only, HttpOnly, Secure, SameSite=Lax, for the path of the event and thirty minutes", async () => {
    const cookie = line(await app().request("https://tickets.example.com/set"), GUEST_SSO_SESSION_COOKIE);

    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/r/northwind-summit;");
    expect(cookie).toContain("Max-Age=1800");
    expect(cookie).not.toMatch(/Domain=/i);
  });

  it("sets the flow cookie to the path of the one callback only, for the length of the state, with the state as its value", async () => {
    const cookie = line(await app().request("https://tickets.example.com/set"), flow.cookieName);

    expect(cookie.startsWith(`${flow.cookieName}=${flow.value};`)).toBe(true);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/sso/callback;");
    expect(cookie).toContain(`Max-Age=${GUEST_SSO_STATE_TTL_MS / 1000}`);
    expect(cookie).not.toMatch(/Domain=/i);
  });

  it("never lets the flow cookie live longer than the state it belongs to", () => {
    expect(GUEST_SSO_STATE_TTL_MS).toBe(10 * 60 * 1000);
  });

  it("drops Secure in development alone, so a guest on a plain http address can try the flow", async () => {
    vi.stubEnv("NODE_ENV", "development");

    const res = await app().request("http://localhost:3000/set");

    expect(line(res, GUEST_SSO_SESSION_COOKIE)).not.toContain("Secure");
    expect(line(res, flow.cookieName)).not.toContain("Secure");
    expect(line(res, GUEST_SSO_SESSION_COOKIE)).toContain("HttpOnly");
  });

  it("deletes each cookie on the path it was set on", async () => {
    const res = await app().request("https://tickets.example.com/clear");

    expect(line(res, GUEST_SSO_SESSION_COOKIE)).toMatch(/Max-Age=0/);
    expect(line(res, GUEST_SSO_SESSION_COOKIE)).toContain("Path=/r/northwind-summit;");
    expect(line(res, flow.cookieName)).toMatch(/Max-Age=0/);
    expect(line(res, flow.cookieName)).toContain("Path=/sso/callback;");
  });
});

describe("reading the cookies of a request", () => {
  const app = new Hono();
  app.get("/session", (c) => c.json(readGuestSsoSession(c, scope, NOW) ?? null));
  app.get("/flow/:state", (c) => c.json(guestSsoFlowCookieMatches(c, parseGuestSsoStateValue(c.req.param("state"))!)));
  const withCookie = (path: string, cookie?: string) => app.request(`https://tickets.example.com${path}`, cookie ? { headers: { Cookie: cookie } } : {});

  it("reads the session from the cookie of its name", async () => {
    const value = signGuestSsoSession(scope, identity);

    expect(await (await withCookie("/session", `${GUEST_SSO_SESSION_COOKIE}=${value}`)).json()).toMatchObject({ email: "ada@example.com" });
    expect(await (await withCookie("/session", `other=${value}`)).json()).toBeNull();
    expect(await (await withCookie("/session")).json()).toBeNull();
  });

  it("holds the flow cookie to be exactly the state of the callback, and to be there", async () => {
    const matches = async (state: string, cookie?: string) => (await (await withCookie(`/flow/${state}`, cookie)).json()) as boolean;
    const mine = newGuestSsoStateValue("northwind-summit");
    const name = mine.cookieName;

    expect(await matches(mine.value, `${name}=${mine.value}`)).toBe(true);
    expect(await matches(mine.value, `${name}=${mine.value.slice(0, -1)}x`)).toBe(false);
    expect(await matches(mine.value, `${name}=${mine.value.slice(0, -1)}`)).toBe(false);
    expect(await matches(mine.value, `${name}=${mine.value}x`)).toBe(false);
    expect(await matches(mine.value, `${name}=`)).toBe(false);
    // The cookie of another name, of the session or of another flow, is not this flow's.
    expect(await matches(mine.value, `${GUEST_SSO_SESSION_COOKIE}=${mine.value}`)).toBe(false);
    expect(await matches(mine.value, `${newGuestSsoStateValue("northwind-summit").cookieName}=${mine.value}`)).toBe(false);
    expect(await matches(mine.value)).toBe(false);
  });
});

describe("the state of a flow", () => {
  it("is 43 random characters, a dot and the slug, and the name of its cookie comes from the random part", () => {
    const one = newGuestSsoStateValue("northwind-summit");
    const two = newGuestSsoStateValue("northwind-summit");

    expect(one.value).toMatch(/^[A-Za-z0-9_-]{43}\.northwind-summit$/);
    expect(one.cookieName).toMatch(new RegExp(`^${GUEST_SSO_FLOW_COOKIE_PREFIX}[A-Za-z0-9_-]{16}$`));
    expect(one.cookieName).not.toBe(two.cookieName);
    expect(parseGuestSsoStateValue(one.value)).toEqual(one);
  });

  it.each([
    "",
    "no-dot",
    "short.northwind",
    `${"a".repeat(43)}.`,
    `${"a".repeat(43)}.Upper`,
    `${"a".repeat(43)}.../etc`,
    `${"a".repeat(43)}.//evil.example`,
    `${"a".repeat(43)}.https://evil.example`,
    `${"a".repeat(43)}.${"s".repeat(81)}`,
    `${"a".repeat(44)}.slug`,
    `${"a".repeat(43)}.slug.extra`,
    `${"a".repeat(43)}.slug\n`,
  ])("is not a state of ours: %s", (value) => {
    expect(parseGuestSsoStateValue(value)).toBeNull();
  });
});
