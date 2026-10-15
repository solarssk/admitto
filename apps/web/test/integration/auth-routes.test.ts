import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { AUTH_METHOD, SESSION_STAGE, createSession, hashPassword } from "@admitto/auth";
import { hashToken } from "@admitto/tickets";
import { createApp } from "../../src/app.js";
import { createRateLimitStore } from "../../src/rate-limit/index.js";
import { sessionCookie } from "../helpers/session-cookie.js";

const CHECKIN_TOKEN = "test-checkin-token-for-vitest-32chars!";
const EVENT_ID = "event-web-auth-routes";
const ORG_ID = "org-web-auth-routes";
const OPERATOR_EMAIL = "auth-routes-operator@example.com";
const OPERATOR_PASSWORD = "login-pass-123";
const SSO_PROVIDER_ID = "idp-web-auth-routes-with-logout";
const SSO_PROVIDER_NO_LOGOUT_ID = "idp-web-auth-routes-no-logout";
const SSO_PROVIDER_BROKEN_LOGOUT_ID = "idp-web-auth-routes-broken-logout";
const SSO_PROVIDER_IDS = [SSO_PROVIDER_ID, SSO_PROVIDER_NO_LOGOUT_ID, SSO_PROVIDER_BROKEN_LOGOUT_ID];

/** Hono `app.request()` uses `http://localhost` as the request URL. */
const sameOrigin = { Origin: "http://localhost" };

function jsonLoginBody(email: string, password: string): string {
  return JSON.stringify({ email, password });
}

function loginHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { "Content-Type": "application/json", ...sameOrigin, ...extra };
}

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;

/** Seed fixture — schema from integration globalSetup (`migrate deploy`). */
async function seedAuthRoutesFixture(client: PrismaClient): Promise<void> {
  await client.roleAssignment.deleteMany({
    where: { OR: [{ scope_id: EVENT_ID }, { user: { email: OPERATOR_EMAIL } }] },
  });
  await client.session.deleteMany({ where: { user: { email: OPERATOR_EMAIL } } });
  await client.user.deleteMany({ where: { email: OPERATOR_EMAIL } });
  await client.identityProvider.deleteMany({ where: { id: { in: SSO_PROVIDER_IDS } } });
  await client.event.deleteMany({ where: { id: EVENT_ID } });
  await client.organization.deleteMany({ where: { id: ORG_ID } });

  const password_hash = await hashPassword(OPERATOR_PASSWORD);

  await client.organization.create({
    data: { id: ORG_ID, name: "Auth Routes Test Org", slug: "web-auth-routes-org" },
  });

  await client.event.create({
    data: {
      id: EVENT_ID,
      title: "Web Auth Event",
      slug: "web-auth-routes-event",
      date: new Date("2026-09-01T09:00:00Z"),
      organization_id: ORG_ID,
    },
  });

  const operator = await client.user.create({
    data: { email: OPERATOR_EMAIL, password_hash },
  });

  await client.roleAssignment.create({
    data: {
      user_id: operator.id,
      role: "operator",
      scope_type: "event",
      scope_id: EVENT_ID,
    },
  });

  // Three SSO providers: one that advertised a logout endpoint, one that did not, and one whose
  // stored endpoint is not a usable address (the column is free text, so a bad row can exist).
  const provider = (id: string, slug: string, endSession: string | null) => ({
    id,
    issuer: `https://idp.example.test/auth-routes/${slug}/`,
    client_id: `admitto-auth-routes-${slug}`,
    authorization_endpoint: `https://idp.example.test/auth-routes/${slug}/authorize`,
    token_endpoint: `https://idp.example.test/auth-routes/${slug}/token`,
    jwks_uri: `https://idp.example.test/auth-routes/${slug}/jwks`,
    end_session_endpoint: endSession,
    display_name: `Auth routes SSO (${slug})`,
  });
  await client.identityProvider.createMany({
    data: [
      provider(SSO_PROVIDER_ID, "with-logout", "https://idp.example.test/auth-routes/with-logout/end-session"),
      provider(SSO_PROVIDER_NO_LOGOUT_ID, "no-logout", null),
      provider(SSO_PROVIDER_BROKEN_LOGOUT_ID, "broken-logout", "not a url"),
    ],
  });
}

beforeAll(async () => {
  prisma = createTestPrismaClient();
  await seedAuthRoutesFixture(prisma);

  app = createApp({
    prisma,
    checkinToken: CHECKIN_TOKEN,
    allowCheckinBearer: false,
    baseUrl: "https://tickets.example.com",
    rateLimitStore: createRateLimitStore(),
    skipCheckinBootValidation: true,
  });
});

afterAll(async () => {
  await prisma?.identityProvider.deleteMany({ where: { id: { in: SSO_PROVIDER_IDS } } });
  await prisma?.$disconnect();
});

function hasHttpOnlySessionCookie(res: Response): boolean {
  const setCookie = res.headers.getSetCookie?.() ?? [];
  return setCookie.some(
    (line) => line.startsWith("admitto_session=") && line.toLowerCase().includes("httponly"),
  );
}

describe("POST /api/auth/login", () => {
  it("returns session cookie on success", async () => {
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: loginHeaders(),
      body: jsonLoginBody(OPERATOR_EMAIL, OPERATOR_PASSWORD),
    });
    expect(res.status).toBe(200);
    const cookie = sessionCookie(res);
    expect(cookie).toMatch(/^admitto_session=/);
    expect(hasHttpOnlySessionCookie(res)).toBe(true);
  });

  it("returns uniform 401 for wrong email and wrong password", async () => {
    const wrongEmail = await app.request("/api/auth/login", {
      method: "POST",
      headers: loginHeaders(),
      body: jsonLoginBody("nobody@example.com", OPERATOR_PASSWORD),
    });
    const wrongPass = await app.request("/api/auth/login", {
      method: "POST",
      headers: loginHeaders(),
      body: jsonLoginBody(OPERATOR_EMAIL, "wrong"),
    });
    expect(wrongEmail.status).toBe(401);
    expect(wrongPass.status).toBe(401);
    expect(await wrongEmail.json()).toEqual(await wrongPass.json());
  });

  it("rejects cross-site POST without same-origin headers", async () => {
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://evil.example",
      },
      body: jsonLoginBody(OPERATOR_EMAIL, OPERATOR_PASSWORD),
    });
    expect(res.status).toBe(403);
    expect(sessionCookie(res)).toBeUndefined();
  });

  it("cross-origin POST 403 does not consume IP login rate limit", async () => {
    const limitedApp = createApp({
      prisma,
      checkinToken: CHECKIN_TOKEN,
      allowCheckinBearer: false,
      baseUrl: "https://tickets.example.com",
      rateLimitStore: createRateLimitStore(),
      skipCheckinBootValidation: true,
    });
    const evil = { Origin: "https://evil.example" };
    const body = jsonLoginBody(OPERATOR_EMAIL, OPERATOR_PASSWORD);

    for (let i = 0; i < 10; i++) {
      const res = await limitedApp.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...evil },
        body,
      });
      expect(res.status).toBe(403);
    }

    const ok = await limitedApp.request("/api/auth/login", {
      method: "POST",
      headers: loginHeaders(),
      body,
    });
    expect(ok.status).toBe(200);
  });
});

describe("GET /api/auth/me", () => {
  it("returns user and assignments with session", async () => {
    const loginRes = await app.request("/api/auth/login", {
      method: "POST",
      headers: loginHeaders(),
      body: jsonLoginBody(OPERATOR_EMAIL, OPERATOR_PASSWORD),
    });
    const cookie = sessionCookie(loginRes);
    const res = await app.request("/api/auth/me", {
      headers: { Cookie: cookie! },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      user: { email: string; preferred_locale: string | null; preferred_time_format: string | null };
      assignments: unknown[];
    };
    expect(json.user.email).toBe(OPERATOR_EMAIL);
    expect(json.user).toHaveProperty("preferred_locale");
    expect(json.user.preferred_locale).toBeNull();
    expect(json.user.preferred_time_format).toBeNull();
    expect(json.assignments.length).toBeGreaterThan(0);
  });

  it("returns 401 without session", async () => {
    const res = await app.request("/api/auth/me");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/auth/logout", () => {
  async function operatorId(): Promise<string> {
    return (await prisma.user.findUniqueOrThrow({ where: { email: OPERATOR_EMAIL } })).id;
  }

  /** A signed-in session as it would exist after SSO sign-in through `providerId`. */
  async function ssoCookie(providerId: string): Promise<string> {
    const { rawToken } = await createSession(prisma, {
      userId: await operatorId(),
      stage: SESSION_STAGE.FULL,
      authMethod: AUTH_METHOD.OIDC,
      oidcProviderId: providerId,
    });
    return `admitto_session=${rawToken}`;
  }

  async function signOut(cookie: string): Promise<Response> {
    return app.request("/api/auth/logout", {
      method: "POST",
      headers: { Cookie: cookie, ...sameOrigin },
    });
  }

  async function isSignedIn(cookie: string): Promise<boolean> {
    return (await app.request("/api/auth/me", { headers: { Cookie: cookie } })).status === 200;
  }

  it("revokes session and clears cookie", async () => {
    const loginRes = await app.request("/api/auth/login", {
      method: "POST",
      headers: loginHeaders(),
      body: jsonLoginBody(OPERATOR_EMAIL, OPERATOR_PASSWORD),
    });
    const cookie = sessionCookie(loginRes)!;
    const logoutRes = await app.request("/api/auth/logout", {
      method: "POST",
      headers: { Cookie: cookie, ...sameOrigin },
    });
    expect(logoutRes.status).toBe(200);
    expect(await logoutRes.json()).toEqual({ ok: true, end_session_url: null });
    const meRes = await app.request("/api/auth/me", { headers: { Cookie: cookie } });
    expect(meRes.status).toBe(401);
  });

  it("answers with the identity provider's end-session URL for an SSO session, and signs it out", async () => {
    const cookie = await ssoCookie(SSO_PROVIDER_ID);
    expect(await isSignedIn(cookie)).toBe(true);

    const res = await signOut(cookie);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; end_session_url: string | null };
    expect(body.ok).toBe(true);
    const url = new URL(body.end_session_url ?? "");
    expect(`${url.origin}${url.pathname}`).toBe("https://idp.example.test/auth-routes/with-logout/end-session");
    expect(url.searchParams.get("client_id")).toBe("admitto-auth-routes-with-logout");
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe("https://tickets.example.com/login");
    expect(await isSignedIn(cookie)).toBe(false);
  });

  it("answers with no end-session URL when the provider did not advertise one, and still signs out", async () => {
    const cookie = await ssoCookie(SSO_PROVIDER_NO_LOGOUT_ID);

    const res = await signOut(cookie);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, end_session_url: null });
    expect(await isSignedIn(cookie)).toBe(false);
  });

  it("still signs out, with no end-session URL, when the provider's stored logout address cannot be used", async () => {
    const cookie = await ssoCookie(SSO_PROVIDER_BROKEN_LOGOUT_ID);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await signOut(cookie);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, end_session_url: null });
      expect(logged).toHaveBeenCalledWith("resolve OIDC end-session redirect:", expect.any(String));
      expect(await isSignedIn(cookie)).toBe(false);
    } finally {
      logged.mockRestore();
    }
  });

  /** The raw session token inside a `Cookie` header value. */
  const tokenOf = (cookie: string): string => cookie.slice("admitto_session=".length);

  async function endSessionUrlOf(res: Response): Promise<string | null> {
    return ((await res.json()) as { end_session_url: string | null }).end_session_url;
  }

  it("answers with the same end-session URL when the Sign out is repeated, as after an answer that never arrived", async () => {
    const cookie = await ssoCookie(SSO_PROVIDER_ID);

    const first = await signOut(cookie);
    const repeated = await signOut(cookie);

    expect(first.status).toBe(200);
    expect(repeated.status).toBe(200);
    const url = await endSessionUrlOf(first);
    expect(url).toContain("https://idp.example.test/auth-routes/with-logout/end-session");
    expect(await endSessionUrlOf(repeated)).toBe(url);
    expect(await isSignedIn(cookie)).toBe(false);
  });

  it("answers with the end-session URL of an SSO session that has already run out", async () => {
    const cookie = await ssoCookie(SSO_PROVIDER_ID);
    await prisma.session.updateMany({
      where: { token_hash: hashToken(tokenOf(cookie)) },
      data: { expires_at: new Date(Date.now() - 60_000) },
    });

    const res = await signOut(cookie);

    expect(res.status).toBe(200);
    expect(await endSessionUrlOf(res)).toContain("https://idp.example.test/auth-routes/with-logout/end-session");
  });

  it("answers with no end-session URL for a password session that is already revoked", async () => {
    const { rawToken } = await createSession(prisma, {
      userId: await operatorId(),
      stage: SESSION_STAGE.FULL,
    });
    const cookie = `admitto_session=${rawToken}`;
    expect((await signOut(cookie)).status).toBe(200);

    const repeated = await signOut(cookie);

    expect(repeated.status).toBe(200);
    expect(await endSessionUrlOf(repeated)).toBeNull();
  });

  it("answers with no end-session URL for a cookie that names no session, and still clears it", async () => {
    const res = await signOut("admitto_session=not-a-session-token");

    expect(res.status).toBe(200);
    expect(await endSessionUrlOf(res)).toBeNull();
    expect((res.headers.getSetCookie?.() ?? []).some((line) => line.startsWith("admitto_session=;"))).toBe(true);
  });

  it("rejects a cross-site POST and leaves the session signed in", async () => {
    const cookie = await ssoCookie(SSO_PROVIDER_ID);

    const res = await app.request("/api/auth/logout", {
      method: "POST",
      headers: { Cookie: cookie, Origin: "https://evil.example" },
    });

    expect(res.status).toBe(403);
    expect(await isSignedIn(cookie)).toBe(true);
  });
});

describe("check-in session auth E2E", () => {
  it("login → cookie → history without Bearer", async () => {
    const loginRes = await app.request("/api/auth/login", {
      method: "POST",
      headers: loginHeaders(),
      body: jsonLoginBody(OPERATOR_EMAIL, OPERATOR_PASSWORD),
    });
    expect(loginRes.status).toBe(200);
    const cookie = sessionCookie(loginRes)!;
    const res = await app.request(`/api/checkin/history?eventId=${EVENT_ID}`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
  });
});
