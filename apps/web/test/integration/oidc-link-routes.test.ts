import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  createSession,
  hashPassword,
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
      client_id: "test-oidc-link-client",
      client_secret_enc: encryptClientSecret("mock-secret"),
      authorization_endpoint: mockIdp.authorizeEndpoint,
      token_endpoint: mockIdp.tokenEndpoint,
      jwks_uri: mockIdp.jwksUri,
      display_name: "Mock SSO Link",
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

describe("oidc link step-up", () => {
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
});
