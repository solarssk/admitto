import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { hashPassword, SESSION_COOKIE_NAME, OIDC_FLOW_COOKIE_NAME } from "@admitto/auth";
import { createApp } from "../../src/app.js";
import { createRateLimitStore } from "../../src/rate-limit/index.js";
import { startMockOidcIdp, stopMockOidcIdp, type MockOidcIdp } from "../helpers/mock-oidc-idp.js";
import { encryptClientSecret } from "@admitto/auth";

const PROVIDER_ID = "web-oidc-flow-provider";
const BASE = "http://localhost";

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let mockIdp: MockOidcIdp;

beforeAll(async () => {
  prisma = new PrismaClient();
  mockIdp = await startMockOidcIdp();

  await prisma.oidcAuthState.deleteMany({ where: { provider_id: PROVIDER_ID } });
  await prisma.externalIdentity.deleteMany({ where: { provider_id: PROVIDER_ID } });
  await prisma.identityProvider.deleteMany({ where: { id: PROVIDER_ID } });
  await prisma.user.deleteMany({ where: { email: "oidc-flow@example.com" } });

  await prisma.identityProvider.create({
    data: {
      id: PROVIDER_ID,
      provider_type: "oidc",
      issuer: mockIdp.issuer,
      client_id: "test-oidc-client",
      client_secret_enc: encryptClientSecret("mock-secret"),
      authorization_endpoint: mockIdp.authorizeEndpoint,
      token_endpoint: mockIdp.tokenEndpoint,
      jwks_uri: mockIdp.jwksUri,
      display_name: "Mock SSO",
      enabled: true,
    },
  });

  app = createApp({
    prisma,
    baseUrl: BASE,
    skipCheckinBootValidation: true,
    rateLimitStore: createRateLimitStore(),
    allowCheckinBearer: false,
    checkinToken: "test-checkin-token-for-vitest-32chars!",
  });
});

afterAll(async () => {
  await prisma.oidcAuthState.deleteMany({ where: { provider_id: PROVIDER_ID } });
  await prisma.externalIdentity.deleteMany({ where: { provider_id: PROVIDER_ID } });
  await prisma.identityProvider.deleteMany({ where: { id: PROVIDER_ID } });
  await prisma.session.deleteMany({ where: { user: { email: "oidc-flow@example.com" } } });
  await prisma.user.deleteMany({ where: { email: "oidc-flow@example.com" } });
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

describe("oidc routes", () => {
  it("start redirects to authorize with state", async () => {
    const res = await app.request(`/api/auth/oidc/${PROVIDER_ID}/start`, { redirect: "manual" });
    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).toContain("/authorize");
    expect(location).toContain("state=");
    expect(location).toContain("code_challenge=");
  });

  it("start?link=1 redirects to step-up page", async () => {
    const res = await app.request(`/api/auth/oidc/${PROVIDER_ID}/start?link=1`, {
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/account/oidc/${PROVIDER_ID}/link`);
  });

  it("callback with invalid state redirects to login error", async () => {
    const res = await app.request(
      `/api/auth/oidc/${PROVIDER_ID}/callback?code=x&state=invalid-state`,
      { redirect: "manual" },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login?error=oidc_failed");
  });

  it("callback rejects link flow when session cookie missing at callback", async () => {
    const linkUser = await prisma.user.create({
      data: {
        email: "oidc-link-user@example.com",
        password_hash: await hashPassword("pw"),
      },
    });
    const state = "link-flow-state-test";
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await prisma.oidcAuthState.create({
      data: {
        provider_id: PROVIDER_ID,
        state,
        nonce: "nonce",
        code_verifier: "verifier",
        link_user_id: linkUser.id,
        expires_at: expiresAt,
      },
    });

    const res = await app.request(
      `/api/auth/oidc/${PROVIDER_ID}/callback?code=fake&state=${encodeURIComponent(state)}`,
      {
        redirect: "manual",
        headers: { Cookie: `${OIDC_FLOW_COOKIE_NAME}=${state}` },
      },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login?error=oidc_failed");

    await prisma.oidcAuthState.deleteMany({ where: { state } });
    await prisma.user.delete({ where: { id: linkUser.id } });
  });

  it("happy path creates full session", async () => {
    const start = await app.request(`/api/auth/oidc/${PROVIDER_ID}/start`, { redirect: "manual" });
    const authorizeUrl = new URL(start.headers.get("location")!);
    const state = authorizeUrl.searchParams.get("state")!;

    const callbackFromIdp = await fetch(authorizeUrl.toString(), { redirect: "manual" });
    const callbackLocation = new URL(callbackFromIdp.headers.get("location")!);
    const code = callbackLocation.searchParams.get("code")!;

    const res = await app.request(
      `/api/auth/oidc/${PROVIDER_ID}/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
      {
        redirect: "manual",
        headers: { Cookie: `${OIDC_FLOW_COOKIE_NAME}=${state}` },
      },
    );
    expect(res.status).toBe(302);
    const sessionCookie = extractSessionCookie(res);
    expect(sessionCookie).toBeDefined();

    const user = await prisma.user.findUnique({ where: { email: "oidc-flow@example.com" } });
    expect(user).not.toBeNull();
    const me = await app.request("/api/auth/me", {
      headers: { Cookie: sessionCookie! },
    });
    expect(me.status).toBe(200);
  });
});
