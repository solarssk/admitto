import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { Hono } from "hono";
import { hashPassword, SESSION_COOKIE_NAME, OIDC_FLOW_COOKIE_NAME, createSession, SESSION_STAGE } from "@admitto/auth";
import { createApp } from "../../src/app.js";
import { beginOidcAuthorizationRedirect } from "../../src/auth/oidc-flow.js";
import { createRateLimitStore, type InMemoryRateLimitStore } from "../../src/rate-limit/index.js";
import { startMockOidcIdp, stopMockOidcIdp, type MockOidcIdp } from "../helpers/mock-oidc-idp.js";
import { encryptClientSecret } from "@admitto/auth";

const PROVIDER_ID = "web-oidc-flow-provider";
const BASE = "http://localhost";

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let mockIdp: MockOidcIdp;
let rateLimitStore: InMemoryRateLimitStore;

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

  rateLimitStore = createRateLimitStore() as InMemoryRateLimitStore;
  app = createApp({
    prisma,
    baseUrl: BASE,
    skipCheckinBootValidation: true,
    rateLimitStore,
    allowCheckinBearer: false,
    checkinToken: "test-checkin-token-for-vitest-32chars!",
  });
});

beforeEach(() => rateLimitStore.reset());

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

async function runOidcCallback(startQuery = ""): Promise<Response> {
  const start = await app.request(`/api/auth/oidc/${PROVIDER_ID}/start${startQuery}`, {
    redirect: "manual",
  });
  const authorizeUrl = new URL(start.headers.get("location")!);
  const state = authorizeUrl.searchParams.get("state")!;

  const callbackFromIdp = await fetch(authorizeUrl.toString(), { redirect: "manual" });
  const callbackLocation = new URL(callbackFromIdp.headers.get("location")!);
  const code = callbackLocation.searchParams.get("code")!;

  return app.request(
    `/api/auth/oidc/${PROVIDER_ID}/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
    {
      redirect: "manual",
      headers: { Cookie: `${OIDC_FLOW_COOKIE_NAME}=${state}` },
    },
  );
}

async function withOidcLinkedUser(
  email: string,
  assignment: { role: string; scope_type: string; scope_id: string | null },
  run: () => Promise<void>,
): Promise<void> {
  await prisma.externalIdentity.deleteMany({ where: { provider_id: PROVIDER_ID } });
  await prisma.roleAssignment.deleteMany({ where: { user: { email } } });
  await prisma.session.deleteMany({ where: { user: { email } } });
  await prisma.user.deleteMany({ where: { email } });

  const user = await prisma.user.create({
    data: {
      email,
      password_hash: await hashPassword("unused"),
      is_active: true,
    },
  });
  await prisma.roleAssignment.create({
    data: {
      user_id: user.id,
      role: assignment.role,
      scope_type: assignment.scope_type,
      scope_id: assignment.scope_id,
    },
  });
  await prisma.externalIdentity.create({
    data: {
      provider_id: PROVIDER_ID,
      subject: "mock-subject-oidc",
      user_id: user.id,
      email,
    },
  });

  try {
    await run();
  } finally {
    await prisma.externalIdentity.deleteMany({ where: { user_id: user.id } });
    await prisma.roleAssignment.deleteMany({ where: { user_id: user.id } });
    await prisma.session.deleteMany({ where: { user_id: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
}

describe("oidc routes", () => {
  it("rejects a missing provider before either OIDC redirect entry point", async () => {
    const start = await app.request("/api/auth/oidc/not-configured/start", { redirect: "manual" });
    expect(start.headers.get("location")).toBe("/login?error=oidc_failed");

    const directFlow = new Hono();
    directFlow.get("/", (c) => beginOidcAuthorizationRedirect(c, prisma, BASE, "not-configured"));
    const flow = await directFlow.request("/", { redirect: "manual" });
    expect(flow.headers.get("location")).toBe("/login?error=oidc_failed");
  });

  it("start redirects to authorize with state", async () => {
    const res = await app.request(`/api/auth/oidc/${PROVIDER_ID}/start`, { redirect: "manual" });
    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).toContain("/authorize");
    expect(location).toContain("state=");
    expect(location).toContain("code_challenge=");
  });

  it("start without next stores null redirect_next for role-based callback landing", async () => {
    const res = await app.request(`/api/auth/oidc/${PROVIDER_ID}/start`, { redirect: "manual" });
    const authorizeUrl = new URL(res.headers.get("location")!);
    const state = authorizeUrl.searchParams.get("state")!;
    const row = await prisma.oidcAuthState.findFirst({ where: { state } });
    expect(row?.redirect_next).toBeNull();
  });

  it("callback without next redirects superadmin to /admin", async () => {
    await withOidcLinkedUser(
      "oidc-superadmin@example.com",
      { role: "superadmin", scope_type: "instance", scope_id: null },
      async () => {
        const res = await runOidcCallback();
        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toBe("/admin");
      },
    );
  });

  it("callback without next redirects operator to /operator", async () => {
    await withOidcLinkedUser(
      "oidc-operator@example.com",
      { role: "operator", scope_type: "event", scope_id: "ev-1" },
      async () => {
        const res = await runOidcCallback();
        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toBe("/operator");
      },
    );
  });

  it("callback honors explicit allowed next for operator", async () => {
    const explicitNext = "/operator/events/ev-1/checkin";
    await withOidcLinkedUser(
      "oidc-operator-next@example.com",
      { role: "operator", scope_type: "event", scope_id: "ev-1" },
      async () => {
        const start = await app.request(
          `/api/auth/oidc/${PROVIDER_ID}/start?next=${encodeURIComponent(explicitNext)}`,
          { redirect: "manual" },
        );
        const authorizeUrl = new URL(start.headers.get("location")!);
        const state = authorizeUrl.searchParams.get("state")!;
        const row = await prisma.oidcAuthState.findFirst({ where: { state } });
        expect(row?.redirect_next).toBe(explicitNext);

        const res = await runOidcCallback(`?next=${encodeURIComponent(explicitNext)}`);
        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toBe(explicitNext);
      },
    );
  });

  it("start?link=1 redirects to step-up page", async () => {
    const res = await app.request(`/api/auth/oidc/${PROVIDER_ID}/start?link=1`, {
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/account/oidc/${PROVIDER_ID}/link`);
  });

  it("callback requires both an authorization code and a state", async () => {
    const res = await app.request(`/api/auth/oidc/${PROVIDER_ID}/callback?code=x`, {
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login?error=oidc_failed");
  });

  it("callback rejects a mismatched OIDC flow cookie", async () => {
    const res = await app.request(
      `/api/auth/oidc/${PROVIDER_ID}/callback?code=x&state=invalid-state`,
      {
        redirect: "manual",
        headers: { Cookie: `${OIDC_FLOW_COOKIE_NAME}=another-state` },
      },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login?error=oidc_failed");
  });

  it("callback rejects a state that was not created or was replayed", async () => {
    const state = "unconsumed-state";
    const res = await app.request(
      `/api/auth/oidc/${PROVIDER_ID}/callback?code=x&state=${encodeURIComponent(state)}`,
      {
        redirect: "manual",
        headers: { Cookie: `${OIDC_FLOW_COOKIE_NAME}=${state}` },
      },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login?error=oidc_failed");
  });

  it("callback rejects a missing or disabled provider after the flow cookie is validated", async () => {
    const state = "missing-provider-state";
    const res = await app.request(
      `/api/auth/oidc/not-configured/callback?code=x&state=${encodeURIComponent(state)}`,
      {
        redirect: "manual",
        headers: { Cookie: `${OIDC_FLOW_COOKIE_NAME}=${state}` },
      },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login?error=oidc_failed");
  });

  it("callback rejects link flow when the step-up time is missing", async () => {
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

  it("callback rejects link flow when step-up timestamp expired", async () => {
    const linkUser = await prisma.user.create({
      data: {
        email: "oidc-link-expired@example.com",
        password_hash: await hashPassword("pw"),
      },
    });
    const state = "link-flow-expired-state";
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await prisma.oidcAuthState.create({
      data: {
        provider_id: PROVIDER_ID,
        state,
        nonce: "nonce",
        code_verifier: "verifier",
        link_user_id: linkUser.id,
        link_step_up_at: new Date(Date.now() - 10 * 60 * 1000),
        expires_at: expiresAt,
      },
    });

    const session = await createSession(prisma, {
      userId: linkUser.id,
      stage: SESSION_STAGE.FULL,
    });

    const res = await app.request(
      `/api/auth/oidc/${PROVIDER_ID}/callback?code=fake&state=${encodeURIComponent(state)}`,
      {
        redirect: "manual",
        headers: {
          Cookie: `${OIDC_FLOW_COOKIE_NAME}=${state}; ${SESSION_COOKIE_NAME}=${session.rawToken}`,
        },
      },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login?error=oidc_failed");

    await prisma.oidcAuthState.deleteMany({ where: { state } });
    await prisma.session.deleteMany({ where: { user_id: linkUser.id } });
    await prisma.user.delete({ where: { id: linkUser.id } });
  });

  it("callback rejects link flow when no current session accompanies a fresh step-up", async () => {
    const linkUser = await prisma.user.create({
      data: {
        email: "oidc-link-no-session@example.com",
        password_hash: await hashPassword("pw"),
      },
    });
    const state = "link-flow-no-session-state";
    await prisma.oidcAuthState.create({
      data: {
        provider_id: PROVIDER_ID,
        state,
        nonce: "nonce",
        code_verifier: "verifier",
        link_user_id: linkUser.id,
        link_step_up_at: new Date(),
        expires_at: new Date(Date.now() + 10 * 60 * 1000),
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

  it("callback rejects link flow when the current full session belongs to a different user", async () => {
    const [linkUser, otherUser] = await Promise.all([
      prisma.user.create({
        data: { email: "oidc-link-mismatch@example.com", password_hash: await hashPassword("pw") },
      }),
      prisma.user.create({
        data: { email: "oidc-link-other-user@example.com", password_hash: await hashPassword("pw") },
      }),
    ]);
    const state = "link-flow-session-mismatch-state";
    await prisma.oidcAuthState.create({
      data: {
        provider_id: PROVIDER_ID,
        state,
        nonce: "nonce",
        code_verifier: "verifier",
        link_user_id: linkUser.id,
        link_step_up_at: new Date(),
        expires_at: new Date(Date.now() + 10 * 60 * 1000),
      },
    });
    const session = await createSession(prisma, { userId: otherUser.id, stage: SESSION_STAGE.FULL });

    const res = await app.request(
      `/api/auth/oidc/${PROVIDER_ID}/callback?code=fake&state=${encodeURIComponent(state)}`,
      {
        redirect: "manual",
        headers: {
          Cookie: `${OIDC_FLOW_COOKIE_NAME}=${state}; ${SESSION_COOKIE_NAME}=${session.rawToken}`,
        },
      },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login?error=oidc_failed");

    await prisma.oidcAuthState.deleteMany({ where: { state } });
    await prisma.session.deleteMany({ where: { user_id: otherUser.id } });
    await prisma.user.deleteMany({ where: { id: { in: [linkUser.id, otherUser.id] } } });
  });

  it("fails closed when the authorization code exchange is rejected", async () => {
    const start = await app.request(`/api/auth/oidc/${PROVIDER_ID}/start`, { redirect: "manual" });
    const authorizeUrl = new URL(start.headers.get("location")!);
    const state = authorizeUrl.searchParams.get("state")!;

    const res = await app.request(
      `/api/auth/oidc/${PROVIDER_ID}/callback?code=unissued-code&state=${encodeURIComponent(state)}`,
      {
        redirect: "manual",
        headers: { Cookie: `${OIDC_FLOW_COOKIE_NAME}=${state}` },
      },
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login?error=oidc_failed");
  });

  it("fails closed instead of auto-linking a pre-existing local account", async () => {
    const existing = await prisma.user.create({
      data: {
        email: "oidc-flow@example.com",
        password_hash: await hashPassword("local-only-password"),
      },
    });

    try {
      const res = await runOidcCallback();
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/login?error=oidc_failed");
      expect(
        await prisma.externalIdentity.count({ where: { provider_id: PROVIDER_ID, user_id: existing.id } }),
      ).toBe(0);
    } finally {
      await prisma.session.deleteMany({ where: { user_id: existing.id } });
      await prisma.user.delete({ where: { id: existing.id } });
    }
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
