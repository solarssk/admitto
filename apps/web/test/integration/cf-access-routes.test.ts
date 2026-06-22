import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  hashPassword,
  createSession,
  SESSION_STAGE,
  SETTING_CF_ACCESS_ENABLED,
  SETTING_CF_ACCESS_TEAM_DOMAIN,
  SETTING_CF_ACCESS_AUD,
  clearCfAccessJwksCacheForTests,
} from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { createApp } from "../../src/app.js";
import { createRateLimitStore } from "../../src/rate-limit/index.js";
import {
  startMockCfAccess,
  signCfAccessJwt,
  stopMockCfAccess,
  type MockCfAccess,
} from "../helpers/mock-cf-access.js";
import { CF_ACCESS_HEADER } from "@admitto/auth";

const SUPER_ID = "cf-superadmin";
const NO_ROLE_ID = "cf-norole";
const SUPER_EMAIL = "cf-super@example.com";
const NO_ROLE_EMAIL = "cf-norole@example.com";
const sameOrigin = { Origin: "http://localhost" };
const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let mock: MockCfAccess;
let superCookie: string;

async function seedCfSettings(): Promise<void> {
  await prisma.systemSettings.upsert({
    where: { key: SETTING_CF_ACCESS_ENABLED },
    create: { key: SETTING_CF_ACCESS_ENABLED, value_json: "true" },
    update: { value_json: "true" },
  });
  await prisma.systemSettings.upsert({
    where: { key: SETTING_CF_ACCESS_TEAM_DOMAIN },
    create: { key: SETTING_CF_ACCESS_TEAM_DOMAIN, value_json: JSON.stringify(mock.teamDomain) },
    update: { value_json: JSON.stringify(mock.teamDomain) },
  });
  await prisma.systemSettings.upsert({
    where: { key: SETTING_CF_ACCESS_AUD },
    create: { key: SETTING_CF_ACCESS_AUD, value_json: JSON.stringify([mock.audience]) },
    update: { value_json: JSON.stringify([mock.audience]) },
  });
}

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  mock = await startMockCfAccess();
  prisma = new PrismaClient();

  await prisma.externalIdentity.deleteMany();
  await prisma.identityProvider.deleteMany({ where: { provider_type: "cloudflare_access" } });
  await prisma.userMfaMethod.deleteMany({ where: { user_id: { in: [SUPER_ID, NO_ROLE_ID] } } });
  await prisma.roleAssignment.deleteMany({ where: { user_id: { in: [SUPER_ID, NO_ROLE_ID] } } });
  await prisma.session.deleteMany({ where: { user_id: { in: [SUPER_ID, NO_ROLE_ID] } } });
  await prisma.user.deleteMany({ where: { id: { in: [SUPER_ID, NO_ROLE_ID] } } });

  const password_hash = await hashPassword("admin-pass-123");
  await prisma.user.createMany({
    data: [
      { id: SUPER_ID, email: SUPER_EMAIL, password_hash },
      { id: NO_ROLE_ID, email: NO_ROLE_EMAIL, password_hash },
    ],
  });
  await prisma.roleAssignment.create({
    data: { user_id: SUPER_ID, role: "superadmin", scope_type: "instance", scope_id: null },
  });

  await prisma.userMfaMethod.create({
    data: {
      user_id: SUPER_ID,
      type: "totp",
      secret_enc: encryptTotpSecret(generateTotpSecret()),
      confirmed_at: new Date(),
    },
  });

  const { rawToken } = await createSession(prisma, {
    userId: SUPER_ID,
    stage: SESSION_STAGE.FULL,
  });
  superCookie = `admitto_session=${rawToken}`;

  await seedCfSettings();

  const provider = await prisma.identityProvider.create({
    data: {
      provider_type: "cloudflare_access",
      issuer: mock.teamDomain,
      client_id: "__cloudflare_access__",
      authorization_endpoint: `${mock.teamDomain}/cdn-cgi/access/login`,
      token_endpoint: `${mock.teamDomain}/cdn-cgi/access/login`,
      jwks_uri: mock.jwksUri,
      display_name: "Cloudflare Access",
      enabled: true,
    },
  });
  await prisma.externalIdentity.create({
    data: {
      provider_id: provider.id,
      subject: "cf-super-sub",
      user_id: SUPER_ID,
      email: SUPER_EMAIL,
    },
  });
  await prisma.externalIdentity.create({
    data: {
      provider_id: provider.id,
      subject: "cf-norole-sub",
      user_id: NO_ROLE_ID,
      email: NO_ROLE_EMAIL,
    },
  });

  app = createApp({
    prisma,
    skipCheckinBootValidation: true,
    rateLimitStore: createRateLimitStore(),
    adminDistRoot,
  });
});

afterAll(async () => {
  clearCfAccessJwksCacheForTests();
  await stopMockCfAccess(mock);
  await prisma.$disconnect();
});

describe("CF Access admin collision point", () => {
  it("redirects /admin to /login when JWT absent and no session (not 401)", async () => {
    const res = await app.request("/admin/auth/providers");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
  });

  it("GET / redirects to /login", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
  });

  it("allows break-glass session without CF JWT", async () => {
    const res = await app.request("/admin/auth/providers", {
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(200);
  });

  it("ignores stale CF_Authorization cookie and allows break-glass session", async () => {
    const res = await app.request("/admin/auth/providers", {
      headers: {
        Cookie: `${superCookie}; CF_Authorization=invalid.stale.jwt`,
      },
    });
    expect(res.status).toBe(200);
  });

  it("valid CF JWT + superadmin renders panel without login redirect", async () => {
    const token = await signCfAccessJwt(mock, { sub: "cf-super-sub", email: SUPER_EMAIL });
    const res = await app.request("/admin/auth/providers", {
      headers: { [CF_ACCESS_HEADER]: token },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Identity providers");
  });

  it("CF JWT without session bootstraps admin SPA and /api/admin/* APIs", async () => {
    const token = await signCfAccessJwt(mock, { sub: "cf-super-sub", email: SUPER_EMAIL });
    const headers = { [CF_ACCESS_HEADER]: token };

    const spa = await app.request("/admin", { headers });
    expect(spa.status).toBe(200);
    expect(await spa.text()).toContain("staff-spa-fixture");

    const me = await app.request("/api/admin/me", { headers });
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as { user: { email: string }; session_active: boolean };
    expect(meBody.user.email).toBe(SUPER_EMAIL);
    expect(meBody.session_active).toBe(false);

    const theme = await app.request("/api/admin/theme", { headers });
    expect(theme.status).toBe(200);

    const legacyMe = await app.request("/api/auth/me", { headers });
    expect(legacyMe.status).toBe(401);
  });

  it("valid CF JWT + no role returns 403 message", async () => {
    const token = await signCfAccessJwt(mock, {
      sub: "cf-norole-sub",
      email: NO_ROLE_EMAIL,
    });
    const res = await app.request("/admin/auth/providers", {
      headers: { [CF_ACCESS_HEADER]: token },
    });
    expect(res.status).toBe(403);
    const text = await res.text();
    expect(text).toContain("authenticated via Cloudflare Access");
  });

  it("invalid CF JWT rejects even with valid session", async () => {
    const res = await app.request("/admin/auth/providers", {
      headers: {
        Cookie: superCookie,
        [CF_ACCESS_HEADER]: "not.a.jwt",
      },
    });
    expect(res.status).toBe(403);
  });

  it("rejects CF JWT when email matches existing user without ExternalIdentity (no auto-link)", async () => {
    const orphanId = "cf-orphan-admin";
    const orphanEmail = "cf-orphan-admin@example.com";
    await prisma.roleAssignment.deleteMany({ where: { user_id: orphanId } });
    await prisma.user.deleteMany({ where: { id: orphanId } });
    try {
      await prisma.user.create({
        data: {
          id: orphanId,
          email: orphanEmail,
          password_hash: await hashPassword("orphan-pass"),
        },
      });
      await prisma.roleAssignment.create({
        data: { user_id: orphanId, role: "superadmin", scope_type: "instance", scope_id: null },
      });

      const token = await signCfAccessJwt(mock, { sub: "cf-orphan-sub", email: orphanEmail });
      const res = await app.request("/admin/auth/providers", {
        headers: { [CF_ACCESS_HEADER]: token },
      });
      expect(res.status).toBe(403);
    } finally {
      await prisma.roleAssignment.deleteMany({ where: { user_id: orphanId } });
      await prisma.user.deleteMany({ where: { id: orphanId } });
    }
  });

  it("public /login does not require CF JWT", async () => {
    const res = await app.request("/login");
    expect(res.status).toBe(200);
  });

  it("public /t does not require CF JWT", async () => {
    const res = await app.request("/t/nonexistent-token");
    expect(res.status).not.toBe(401);
  });
});

describe("CF Access config UI", () => {
  it("superadmin can open cf-access settings via session", async () => {
    const res = await app.request("/admin/auth/cf-access", {
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Cloudflare Access");
    expect(html).toContain("<title>Admitto — Cloudflare Access</title>");
    expect(html).toContain("<h1>Cloudflare Access</h1>");
    expect(html).not.toMatch(/<h1>Admitto —/);
  });

  it("test JWKS endpoint via form", async () => {
    const res = await app.request("/admin/auth/cf-access/test", {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ team_domain: mock.teamDomain }).toString(),
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("JWKS connection OK");
  });

  it("rejects enabling CF Access without team domain and AUD", async () => {
    const res = await app.request("/admin/auth/cf-access", {
      method: "POST",
      headers: {
        Cookie: superCookie,
        ...sameOrigin,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        enabled: "1",
        team_domain: "",
        audience: "",
        protected_prefixes: '["/admin","/api/admin"]',
      }).toString(),
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("CF_ACCESS_TEAM_DOMAIN");
    const config = await prisma.systemSettings.findUnique({
      where: { key: SETTING_CF_ACCESS_TEAM_DOMAIN },
    });
    expect(config?.value_json).toContain(mock.teamDomain);
  });
});
