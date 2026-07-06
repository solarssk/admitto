import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  hashPassword,
  createSession,
  SESSION_STAGE,
  encryptClientSecret,
} from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { createApp } from "../../src/app.js";
import { createRateLimitStore } from "../../src/rate-limit/index.js";

const PROVIDER_ID = "web-idp-api-provider";
const SUPER_ID = "web-idp-api-super";
const OPERATOR_ID = "web-idp-api-operator";
const ADMIN_ID = "web-idp-api-admin";
const SUPER_EMAIL = "idp-api-super@example.com";
const OPERATOR_EMAIL = "idp-api-op@example.com";
const ADMIN_EMAIL = "idp-api-admin@example.com";
const sameOrigin = { Origin: "http://localhost" };

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let superCookie: string;
let operatorCookie: string;
let adminCookie: string;

beforeAll(async () => {
  prisma = new PrismaClient();
  await prisma.oidcGroupRoleMapping.deleteMany({ where: { provider_id: PROVIDER_ID } });
  await prisma.identityProvider.deleteMany({ where: { id: PROVIDER_ID } });
  await prisma.userMfaMethod.deleteMany({ where: { user_id: { in: [SUPER_ID, OPERATOR_ID, ADMIN_ID] } } });
  await prisma.roleAssignment.deleteMany({ where: { user_id: { in: [SUPER_ID, OPERATOR_ID, ADMIN_ID] } } });
  await prisma.session.deleteMany({ where: { user_id: { in: [SUPER_ID, OPERATOR_ID, ADMIN_ID] } } });
  await prisma.user.deleteMany({ where: { id: { in: [SUPER_ID, OPERATOR_ID, ADMIN_ID] } } });

  const password_hash = await hashPassword("admin-pass-123");
  await prisma.user.createMany({
    data: [
      { id: SUPER_ID, email: SUPER_EMAIL, password_hash },
      { id: OPERATOR_ID, email: OPERATOR_EMAIL, password_hash },
      { id: ADMIN_ID, email: ADMIN_EMAIL, password_hash },
    ],
  });
  await prisma.roleAssignment.create({
    data: { user_id: SUPER_ID, role: "superadmin", scope_type: "instance", scope_id: null },
  });
  await prisma.roleAssignment.create({
    data: { user_id: OPERATOR_ID, role: "operator", scope_type: "instance", scope_id: null },
  });
  await prisma.roleAssignment.create({
    data: { user_id: ADMIN_ID, role: "admin", scope_type: "instance", scope_id: null },
  });

  await prisma.userMfaMethod.create({
    data: {
      user_id: SUPER_ID,
      type: "totp",
      secret_enc: encryptTotpSecret(generateTotpSecret()),
      confirmed_at: new Date(),
    },
  });
  // admin role is MFA-required by default; enroll confirmed TOTP so the session validates
  // and we exercise the authorization (403), not the session layer (401).
  await prisma.userMfaMethod.create({
    data: {
      user_id: ADMIN_ID,
      type: "totp",
      secret_enc: encryptTotpSecret(generateTotpSecret()),
      confirmed_at: new Date(),
    },
  });

  const superSession = await createSession(prisma, { userId: SUPER_ID, stage: SESSION_STAGE.FULL });
  superCookie = `admitto_session=${superSession.rawToken}`;
  const opSession = await createSession(prisma, { userId: OPERATOR_ID, stage: SESSION_STAGE.FULL });
  operatorCookie = `admitto_session=${opSession.rawToken}`;
  const adminSession = await createSession(prisma, { userId: ADMIN_ID, stage: SESSION_STAGE.FULL });
  adminCookie = `admitto_session=${adminSession.rawToken}`;

  await prisma.identityProvider.create({
    data: {
      id: PROVIDER_ID,
      provider_type: "oidc",
      issuer: "https://idp-api-test.example.com/",
      client_id: "api-test-client",
      client_secret_enc: encryptClientSecret("original-secret"),
      authorization_endpoint: "https://idp-api-test.example.com/a",
      token_endpoint: "https://idp-api-test.example.com/t",
      jwks_uri: "https://idp-api-test.example.com/j",
      display_name: "API Test IdP",
      enabled: false,
    },
  });

  app = createApp({
    prisma,
    skipCheckinBootValidation: true,
    rateLimitStore: createRateLimitStore(),
    allowCheckinBearer: false,
    checkinToken: "test-checkin-token-for-vitest-32chars!",
  });
});

afterAll(async () => {
  await prisma.oidcGroupRoleMapping.deleteMany({ where: { provider_id: PROVIDER_ID } });
  await prisma.identityProvider.deleteMany({ where: { id: PROVIDER_ID } });
  await prisma.userMfaMethod.deleteMany({ where: { user_id: { in: [SUPER_ID, OPERATOR_ID, ADMIN_ID] } } });
  await prisma.roleAssignment.deleteMany({ where: { user_id: { in: [SUPER_ID, OPERATOR_ID, ADMIN_ID] } } });
  await prisma.session.deleteMany({ where: { user_id: { in: [SUPER_ID, OPERATOR_ID, ADMIN_ID] } } });
  await prisma.user.deleteMany({ where: { id: { in: [SUPER_ID, OPERATOR_ID, ADMIN_ID] } } });
  await prisma.$disconnect();
});

async function json(path: string, init: RequestInit = {}) {
  return app.request(path, {
    ...init,
    headers: {
      Cookie: superCookie,
      "Content-Type": "application/json",
      ...sameOrigin,
      ...(init.headers ?? {}),
    },
  });
}

interface ProviderListItem {
  id: string;
  display_name: string;
  issuer: string;
  enabled: boolean;
}
interface ProviderDetail {
  id: string;
  display_name: string;
  has_client_secret: boolean;
  claim_email: string;
  claim_name: string;
  claim_groups: string;
  enabled: boolean;
  login_button_label: string | null;
  mappings: { group: string; role: string; scope_type: string; scope_id: string }[];
}
interface ProviderListResponse {
  providers: ProviderListItem[];
}
interface CfAccessResponse {
  enabled: boolean;
  teamDomain: string;
  audience: string[];
  protectedPrefixes: string[];
  locks: { enabled: boolean; teamDomain: boolean; audience: boolean; protectedPrefixes: boolean };
}
interface TestResult {
  ok: boolean;
  error?: string;
}

async function jsonAs<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe("identity providers API — auth gating", () => {
  it("operator gets 403 on provider list", async () => {
    const res = await app.request("/api/admin/identity/providers", {
      headers: { Cookie: operatorCookie },
    });
    expect(res.status).toBe(403);
  });

  it("admin (non-superadmin) gets 403 on provider list", async () => {
    const res = await app.request("/api/admin/identity/providers", {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(403);
  });

  it("unauthenticated gets 401 JSON", async () => {
    const res = await app.request("/api/admin/identity/providers");
    expect(res.status).toBe(401);
    expect(await jsonAs<{ error: string }>(res)).toEqual({ error: "authentication_required" });
  });

  it("CSRF blocks POST without Origin", async () => {
    const res = await app.request(`/api/admin/identity/providers/${PROVIDER_ID}/toggle`, {
      method: "POST",
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(403);
  });
});

describe("identity providers API — list & get", () => {
  it("superadmin lists providers", async () => {
    const res = await json("/api/admin/identity/providers");
    expect(res.status).toBe(200);
    const body = await jsonAs<ProviderListResponse>(res);
    const ids = body.providers.map((p) => p.id);
    expect(ids).toContain(PROVIDER_ID);
    const row = body.providers.find((p) => p.id === PROVIDER_ID);
    expect(row).toMatchObject({
      display_name: "API Test IdP",
      issuer: "https://idp-api-test.example.com/",
      enabled: false,
    });
  });

  it("get provider detail returns form view + mappings", async () => {
    await prisma.oidcGroupRoleMapping.create({
      data: {
        provider_id: PROVIDER_ID,
        group: "admins",
        role: "superadmin",
        scope_type: "instance",
        scope_id: "",
      },
    });
    try {
      const res = await json(`/api/admin/identity/providers/${PROVIDER_ID}`);
      expect(res.status).toBe(200);
      const body = await jsonAs<ProviderDetail>(res);
      expect(body).toMatchObject({
        id: PROVIDER_ID,
        display_name: "API Test IdP",
        has_client_secret: true,
        claim_email: "email",
        claim_name: "name",
        claim_groups: "groups",
      });
      expect(body.mappings).toEqual([
        { group: "admins", role: "superadmin", scope_type: "instance", scope_id: "" },
      ]);
    } finally {
      await prisma.oidcGroupRoleMapping.deleteMany({ where: { provider_id: PROVIDER_ID } });
    }
  });

  it("get unknown provider returns 404 JSON", async () => {
    const res = await json("/api/admin/identity/providers/does-not-exist");
    expect(res.status).toBe(404);
    expect(await jsonAs<{ error: string }>(res)).toEqual({ error: "not_found" });
  });
});

describe("identity providers API — toggle", () => {
  it("toggles enabled flag and returns new state", async () => {
    await prisma.identityProvider.update({ where: { id: PROVIDER_ID }, data: { enabled: false } });
    const on = await json(`/api/admin/identity/providers/${PROVIDER_ID}/toggle`, { method: "POST" });
    expect(on.status).toBe(200);
    expect(await jsonAs<{ id: string; enabled: boolean }>(on)).toEqual({ id: PROVIDER_ID, enabled: true });
    expect(
      (await prisma.identityProvider.findUniqueOrThrow({ where: { id: PROVIDER_ID } })).enabled,
    ).toBe(true);

    const off = await json(`/api/admin/identity/providers/${PROVIDER_ID}/toggle`, { method: "POST" });
    expect(off.status).toBe(200);
    expect(await jsonAs<{ id: string; enabled: boolean }>(off)).toEqual({ id: PROVIDER_ID, enabled: false });
  });
});

describe("identity providers API — update", () => {
  it("updates provider fields and preserves secret when client_secret omitted", async () => {
    const before = await prisma.identityProvider.findUniqueOrThrow({ where: { id: PROVIDER_ID } });
    const res = await json(`/api/admin/identity/providers/${PROVIDER_ID}`, {
      method: "PUT",
      body: JSON.stringify({
        display_name: "API Test IdP (renamed)",
        issuer: "https://idp-api-test.example.com/",
        client_id: "api-test-client",
        authorization_endpoint: "https://idp-api-test.example.com/a",
        token_endpoint: "https://idp-api-test.example.com/t",
        jwks_uri: "https://idp-api-test.example.com/j",
        enabled: true,
        mappings: [
          { group: "ops", role: "operator", scope_type: "event", scope_id: "evt-1" },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = await jsonAs<ProviderDetail>(res);
    expect(body.display_name).toBe("API Test IdP (renamed)");
    expect(body.enabled).toBe(true);
    expect(body.mappings).toEqual([
      { group: "ops", role: "operator", scope_type: "event", scope_id: "evt-1" },
    ]);

    const after = await prisma.identityProvider.findUniqueOrThrow({ where: { id: PROVIDER_ID } });
    expect(after.client_secret_enc).toBe(before.client_secret_enc);
  });

  it("rejects invalid mapping role with 400", async () => {
    const res = await json(`/api/admin/identity/providers/${PROVIDER_ID}`, {
      method: "PUT",
      body: JSON.stringify({
        display_name: "API Test IdP (renamed)",
        issuer: "https://idp-api-test.example.com/",
        client_id: "api-test-client",
        mappings: [{ group: "x", role: "god", scope_type: "instance" }],
      }),
    });
    expect(res.status).toBe(400);
    expect(await jsonAs<{ error: string }>(res)).toEqual({ error: "validation_failed" });
  });

  it("rejects missing required fields with 400", async () => {
    const res = await json(`/api/admin/identity/providers/${PROVIDER_ID}`, {
      method: "PUT",
      body: JSON.stringify({ issuer: "https://idp-api-test.example.com/" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects PUT without mappings (replace-all contract) with 400", async () => {
    const res = await json(`/api/admin/identity/providers/${PROVIDER_ID}`, {
      method: "PUT",
      body: JSON.stringify({
        display_name: "API Test IdP (renamed)",
        issuer: "https://idp-api-test.example.com/",
        client_id: "api-test-client",
      }),
    });
    expect(res.status).toBe(400);
    expect(await jsonAs<{ error: string }>(res)).toEqual({ error: "mappings_required" });
  });

  it("rejects organization-scoped mapping without scope_id with 400", async () => {
    const res = await json(`/api/admin/identity/providers/${PROVIDER_ID}`, {
      method: "PUT",
      body: JSON.stringify({
        display_name: "API Test IdP (renamed)",
        issuer: "https://idp-api-test.example.com/",
        client_id: "api-test-client",
        mappings: [{ group: "ops", role: "operator", scope_type: "organization" }],
      }),
    });
    expect(res.status).toBe(400);
    expect(await jsonAs<{ error: string }>(res)).toEqual({ error: "validation_failed" });
  });

  it("omitting login_button_label preserves the stored label; null clears it", async () => {
    await prisma.identityProvider.update({
      where: { id: PROVIDER_ID },
      data: { login_button_label: "Sign in with Acme" },
    });

    // Omit login_button_label entirely → preserved.
    const preserved = await json(`/api/admin/identity/providers/${PROVIDER_ID}`, {
      method: "PUT",
      body: JSON.stringify({
        display_name: "API Test IdP (renamed)",
        issuer: "https://idp-api-test.example.com/",
        client_id: "api-test-client",
        authorization_endpoint: "https://idp-api-test.example.com/a",
        token_endpoint: "https://idp-api-test.example.com/t",
        jwks_uri: "https://idp-api-test.example.com/j",
        mappings: [],
      }),
    });
    expect(preserved.status).toBe(200);
    expect((await jsonAs<ProviderDetail>(preserved)).login_button_label).toBe("Sign in with Acme");

    // Explicit null → cleared.
    const cleared = await json(`/api/admin/identity/providers/${PROVIDER_ID}`, {
      method: "PUT",
      body: JSON.stringify({
        display_name: "API Test IdP (renamed)",
        issuer: "https://idp-api-test.example.com/",
        client_id: "api-test-client",
        authorization_endpoint: "https://idp-api-test.example.com/a",
        token_endpoint: "https://idp-api-test.example.com/t",
        jwks_uri: "https://idp-api-test.example.com/j",
        login_button_label: null,
        mappings: [],
      }),
    });
    expect(cleared.status).toBe(200);
    expect((await jsonAs<ProviderDetail>(cleared)).login_button_label).toBeNull();
  });
});

describe("identity providers API — create", () => {
  it("creates a provider and returns 201 with detail", async () => {
    const res = await json("/api/admin/identity/providers", {
      method: "POST",
      body: JSON.stringify({
        display_name: "Created via API",
        issuer: "https://idp-api-create.example.com/",
        client_id: "created-client",
        authorization_endpoint: "https://idp-api-create.example.com/a",
        token_endpoint: "https://idp-api-create.example.com/t",
        jwks_uri: "https://idp-api-create.example.com/j",
        mappings: [],
      }),
    });
    expect(res.status).toBe(201);
    const body = await jsonAs<ProviderDetail>(res);
    expect(body.display_name).toBe("Created via API");
    expect(body.has_client_secret).toBe(false);
    const createdId = body.id;
    await prisma.oidcGroupRoleMapping.deleteMany({ where: { provider_id: createdId } });
    await prisma.identityProvider.delete({ where: { id: createdId } });
  });

  it("creates a provider without mappings (defaults to empty list)", async () => {
    const res = await json("/api/admin/identity/providers", {
      method: "POST",
      body: JSON.stringify({
        display_name: "Created No Mappings",
        issuer: "https://idp-api-create-nomap.example.com/",
        client_id: "created-nomap-client",
        authorization_endpoint: "https://idp-api-create-nomap.example.com/a",
        token_endpoint: "https://idp-api-create-nomap.example.com/t",
        jwks_uri: "https://idp-api-create-nomap.example.com/j",
      }),
    });
    expect(res.status).toBe(201);
    const body = await jsonAs<ProviderDetail>(res);
    expect(body.display_name).toBe("Created No Mappings");
    expect(body.mappings).toEqual([]);
    await prisma.oidcGroupRoleMapping.deleteMany({ where: { provider_id: body.id } });
    await prisma.identityProvider.delete({ where: { id: body.id } });
  });
});

describe("identity providers API — test connection", () => {
  it("returns ok/false shape without persisting changes", async () => {
    const res = await json(`/api/admin/identity/providers/${PROVIDER_ID}/test`, { method: "POST" });
    expect([200, 400]).toContain(res.status);
    const body = await jsonAs<TestResult>(res);
    expect(typeof body.ok).toBe("boolean");
    if (!body.ok) expect(typeof body.error).toBe("string");
  });

  it("draft test endpoint returns ok/false shape without a saved provider", async () => {
    const res = await json("/api/admin/identity/providers/test", {
      method: "POST",
      body: JSON.stringify({
        issuer: "https://idp-api-draft-test.example.com/",
      }),
    });
    expect([200, 400]).toContain(res.status);
    const body = await jsonAs<TestResult>(res);
    expect(typeof body.ok).toBe("boolean");
    if (!body.ok) expect(typeof body.error).toBe("string");
  });

  it("rejects draft test without an issuer (400)", async () => {
    const res = await json("/api/admin/identity/providers/test", {
      method: "POST",
      body: JSON.stringify({ issuer: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("draft test accepts optional endpoints (covers optionalOidcEndpoint truthy path)", async () => {
    const res = await json("/api/admin/identity/providers/test", {
      method: "POST",
      body: JSON.stringify({
        issuer: "https://idp-api-draft-test.example.com/",
        authorization_endpoint: "https://idp-api-draft-test.example.com/auth",
        token_endpoint: "https://idp-api-draft-test.example.com/token",
        jwks_uri: "https://idp-api-draft-test.example.com/jwks",
      }),
    });
    expect([200, 400]).toContain(res.status);
    const body = await jsonAs<TestResult>(res);
    expect(typeof body.ok).toBe("boolean");
  });
});

describe("identity providers API — discover preview", () => {
  it("returns endpoints or a failure without persisting", async () => {
    const res = await json("/api/admin/identity/providers/discover-preview", {
      method: "POST",
      body: JSON.stringify({ issuer: "https://idp-api-discover-preview.example.com/" }),
    });
    expect([200, 400]).toContain(res.status);
    if (res.status === 200) {
      const body = await jsonAs<{ ok: true; endpoints: { issuer: string } }>(res);
      expect(body.ok).toBe(true);
      expect(typeof body.endpoints.issuer).toBe("string");
    } else {
      const body = await jsonAs<{ ok: false; error: string }>(res);
      expect(body.ok).toBe(false);
      expect(typeof body.error).toBe("string");
    }
  });

  it("rejects discover preview without an issuer (400)", async () => {
    const res = await json("/api/admin/identity/providers/discover-preview", {
      method: "POST",
      body: JSON.stringify({ issuer: "" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("cloudflare access API", () => {
  it("returns CF access dto with locks", async () => {
    const res = await json("/api/admin/identity/cf-access");
    expect(res.status).toBe(200);
    const body = await jsonAs<CfAccessResponse>(res);
    expect(body).toHaveProperty("enabled");
    expect(body).toHaveProperty("teamDomain");
    expect(Array.isArray(body.audience)).toBe(true);
    expect(Array.isArray(body.protectedPrefixes)).toBe(true);
    expect(body.locks).toMatchObject({
      enabled: expect.any(Boolean),
      teamDomain: expect.any(Boolean),
      audience: expect.any(Boolean),
      protectedPrefixes: expect.any(Boolean),
    });
  });

  it("test endpoint returns ok/false shape", async () => {
    const res = await json("/api/admin/identity/cf-access/test", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect([200, 400]).toContain(res.status);
    const body = await jsonAs<TestResult>(res);
    expect(typeof body.ok).toBe("boolean");
  });
});
