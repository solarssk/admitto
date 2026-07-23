import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  createSession,
  hashPassword,
  OIDC_FLOW_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  SESSION_STAGE,
} from "@admitto/auth";
import { createApp } from "../../src/app.js";
import { createRateLimitStore } from "../../src/rate-limit/index.js";
import { startMockOidcIdp, stopMockOidcIdp, type MockOidcIdp } from "../helpers/mock-oidc-idp.js";
import { encryptClientSecret } from "@admitto/auth";

const PROVIDER_ID = "web-oidc-link-provider";
const BASE = "http://localhost";
const sameOrigin = { Origin: "http://localhost" };
const LINK_EMAIL = "oidc-link-flow@example.com";
const LINK_PASSWORD = "link-test-password";

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let mockIdp: MockOidcIdp;
let linkUserId: string;
let rateLimitStore: ReturnType<typeof createRateLimitStore>;

beforeAll(async () => {
  prisma = new PrismaClient();
  mockIdp = await startMockOidcIdp();

  await prisma.oidcAuthState.deleteMany({ where: { provider_id: PROVIDER_ID } });
  await prisma.externalIdentity.deleteMany({ where: { provider_id: PROVIDER_ID } });
  await prisma.identityProvider.deleteMany({ where: { id: PROVIDER_ID } });
  await prisma.session.deleteMany({ where: { user: { email: LINK_EMAIL } } });
  await prisma.user.deleteMany({ where: { email: LINK_EMAIL } });

  const user = await prisma.user.create({
    data: {
      email: LINK_EMAIL,
      password_hash: await hashPassword(LINK_PASSWORD),
      is_active: true,
    },
  });
  linkUserId = user.id;

  await prisma.identityProvider.create({
    data: {
      id: PROVIDER_ID,
      provider_type: "oidc",
      issuer: mockIdp.issuer,
      // mock-oidc-idp signs tokens for this audience; keeping the provider in sync lets the
      // callback test exercise the full link flow instead of failing token validation first.
      client_id: "test-oidc-client",
      client_secret_enc: encryptClientSecret("mock-secret"),
      authorization_endpoint: mockIdp.authorizeEndpoint,
      token_endpoint: mockIdp.tokenEndpoint,
      jwks_uri: mockIdp.jwksUri,
      display_name: "Mock SSO Link",
      enabled: true,
    },
  });

  rateLimitStore = createRateLimitStore();
  app = createApp({
    prisma,
    baseUrl: BASE,
    skipCheckinBootValidation: true,
    rateLimitStore,
    allowCheckinBearer: false,
    checkinToken: "test-checkin-token-for-vitest-32chars!",
  });
});

afterAll(async () => {
  await prisma.oidcAuthState.deleteMany({ where: { provider_id: PROVIDER_ID } });
  await prisma.externalIdentity.deleteMany({ where: { provider_id: PROVIDER_ID } });
  await prisma.identityProvider.deleteMany({ where: { id: PROVIDER_ID } });
  await prisma.session.deleteMany({ where: { user: { email: LINK_EMAIL } } });
  await prisma.user.deleteMany({ where: { email: LINK_EMAIL } });
  await prisma.$disconnect();
  await stopMockOidcIdp(mockIdp);
});

function extractSessionCookie(res: Response): string | undefined {
  const lines =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [res.headers.get("set-cookie") ?? ""];
  const match = lines.find((line) => line.startsWith(`${SESSION_COOKIE_NAME}=`));
  return match?.split(";")[0];
}

async function fullSessionCookie(): Promise<string> {
  const { rawToken } = await createSession(prisma, {
    userId: linkUserId,
    stage: SESSION_STAGE.FULL,
  });
  return `${SESSION_COOKIE_NAME}=${rawToken}`;
}

async function fullSession(): Promise<{ cookie: string; sessionId: string }> {
  const { rawToken, session } = await createSession(prisma, {
    userId: linkUserId,
    stage: SESSION_STAGE.FULL,
  });
  return { cookie: `${SESSION_COOKIE_NAME}=${rawToken}`, sessionId: session.id };
}

describe("oidc link step-up", () => {
  it("redirects GET and POST link requests when the provider is missing", async () => {
    const cookie = await fullSessionCookie();
    const getRes = await app.request("/account/oidc/not-configured/link", {
      redirect: "manual",
      headers: { Cookie: cookie },
    });
    expect(getRes.headers.get("location")).toBe("/login?error=oidc_failed");

    const postRes = await app.request("/account/oidc/not-configured/link", {
      method: "POST",
      redirect: "manual",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/x-www-form-urlencoded",
        ...sameOrigin,
      },
      body: new URLSearchParams({ password: LINK_PASSWORD }).toString(),
    });
    expect(postRes.headers.get("location")).toBe("/login?error=oidc_failed");
  });

  it("start?link=1 redirects to step-up page", async () => {
    const cookie = await fullSessionCookie();
    const res = await app.request(`/api/auth/oidc/${PROVIDER_ID}/start?link=1`, {
      redirect: "manual",
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/account/oidc/${PROVIDER_ID}/link`);
  });

  it("POST link with wrong password shows error", async () => {
    const cookie = await fullSessionCookie();
    const res = await app.request(`/account/oidc/${PROVIDER_ID}/link`, {
      method: "POST",
      redirect: "manual",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/x-www-form-urlencoded",
        ...sameOrigin,
      },
      body: new URLSearchParams({ password: "wrong" }).toString(),
    });
    expect(res.status).toBe(401);
    const html = await res.text();
    expect(html).toContain("Invalid password or code");
  });

  it("POST link with correct password redirects to IdP authorize", async () => {
    const cookie = await fullSessionCookie();
    const res = await app.request(`/account/oidc/${PROVIDER_ID}/link`, {
      method: "POST",
      redirect: "manual",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/x-www-form-urlencoded",
        ...sameOrigin,
      },
      body: new URLSearchParams({ password: LINK_PASSWORD }).toString(),
    });
    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).toContain("/authorize");
    expect(location).toContain("state=");
  });

  it("POST link without next stores null redirect_next", async () => {
    const cookie = await fullSessionCookie();
    const res = await app.request(`/account/oidc/${PROVIDER_ID}/link`, {
      method: "POST",
      redirect: "manual",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/x-www-form-urlencoded",
        ...sameOrigin,
      },
      body: new URLSearchParams({ password: LINK_PASSWORD }).toString(),
    });
    expect(res.status).toBe(302);
    const authorizeUrl = new URL(res.headers.get("location")!);
    const state = authorizeUrl.searchParams.get("state")!;
    const row = await prisma.oidcAuthState.findFirst({ where: { state } });
    expect(row?.redirect_next).toBeNull();
  });

  it("GET link without next omits hidden next field", async () => {
    const cookie = await fullSessionCookie();
    const res = await app.request(`/account/oidc/${PROVIDER_ID}/link`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain('name="next"');
  });

  it("returns 429 when the step-up code rate limit is exceeded", async () => {
    const { cookie, sessionId } = await fullSession();
    // Pre-fill this endpoint's own "oidc-link"-namespaced bucket directly: hitting it via
    // repeated real requests would also drive the separate oidc:link-stepup limiter (also
    // max 10, keyed by userId — shared across every test in this file), making it ambiguous
    // which limiter actually produced a 429.
    for (let i = 0; i < 10; i++) {
      await rateLimitStore.hit(`mfa:totp:session:oidc-link:${sessionId}`, 15 * 60_000, 10);
    }
    const res = await app.request(`/account/oidc/${PROVIDER_ID}/link`, {
      method: "POST",
      redirect: "manual",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/x-www-form-urlencoded",
        ...sameOrigin,
      },
      body: new URLSearchParams({ password: LINK_PASSWORD, code: "000000" }).toString(),
    });
    expect(res.status).toBe(429);
    expect(await res.text()).toBe("Too many requests");
  });

  it("accepts a fresh full session through the callback and links its OIDC identity", async () => {
    const { cookie } = await fullSession();
    const start = await app.request(`/account/oidc/${PROVIDER_ID}/link`, {
      method: "POST",
      redirect: "manual",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/x-www-form-urlencoded",
        ...sameOrigin,
      },
      body: new URLSearchParams({ password: LINK_PASSWORD }).toString(),
    });
    expect(start.status).toBe(302);

    const authorizeUrl = new URL(start.headers.get("location")!);
    const state = authorizeUrl.searchParams.get("state")!;
    const callbackFromIdp = await fetch(authorizeUrl.toString(), { redirect: "manual" });
    const callbackLocation = new URL(callbackFromIdp.headers.get("location")!);
    const code = callbackLocation.searchParams.get("code")!;

    try {
      const callback = await app.request(
        `/api/auth/oidc/${PROVIDER_ID}/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
        {
          redirect: "manual",
          headers: { Cookie: `${OIDC_FLOW_COOKIE_NAME}=${state}; ${cookie}` },
        },
      );
      expect(callback.status).toBe(302);
      const identity = await prisma.externalIdentity.findUnique({
        where: { provider_id_subject: { provider_id: PROVIDER_ID, subject: "mock-subject-oidc" } },
      });
      expect(identity?.user_id).toBe(linkUserId);
    } finally {
      await prisma.externalIdentity.deleteMany({
        where: { provider_id: PROVIDER_ID, user_id: linkUserId },
      });
    }
  });
});
