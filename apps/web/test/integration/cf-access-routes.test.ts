import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import {
  hashPassword,
  createSession,
  SESSION_STAGE,
  SETTING_CF_ACCESS_ENABLED,
  SETTING_CF_ACCESS_TEAM_DOMAIN,
  SETTING_CF_ACCESS_AUD,
  SETTING_CF_ACCESS_SOURCE_PROVIDER_ID,
  clearCfAccessRuntimeConfigCache,
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
const AUTHENTIK_SOURCE_PROVIDER_ID = "cf-authentik-source";
const AUTHENTIK_SUPER_SUBJECT = "authentik-super-user-uuid";
const AUTHENTIK_NO_ROLE_SUBJECT = "authentik-no-role-user-uuid";
const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let mock: MockCfAccess;
let superCookie: string;
let cfAccessProviderId: string;

async function seedCfSettings(): Promise<void> {
  await prisma.systemSettings.upsert({
    where: { key: SETTING_CF_ACCESS_ENABLED },
    create: { key: SETTING_CF_ACCESS_ENABLED, value_json: "true" },
    update: { value_json: "true" },
  });
  await prisma.systemSettings.upsert({
    where: { key: SETTING_CF_ACCESS_SOURCE_PROVIDER_ID },
    create: { key: SETTING_CF_ACCESS_SOURCE_PROVIDER_ID, value_json: JSON.stringify(AUTHENTIK_SOURCE_PROVIDER_ID) },
    update: { value_json: JSON.stringify(AUTHENTIK_SOURCE_PROVIDER_ID) },
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
  prisma = createTestPrismaClient();

  await prisma.externalIdentity.deleteMany({
    where: {
      OR: [
        { provider_id: AUTHENTIK_SOURCE_PROVIDER_ID },
        { provider: { provider_type: "cloudflare_access" } },
      ],
    },
  });
  await prisma.identityProvider.deleteMany({
    where: { id: AUTHENTIK_SOURCE_PROVIDER_ID },
  });
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

  const sourceProvider = await prisma.identityProvider.create({
    data: {
      id: AUTHENTIK_SOURCE_PROVIDER_ID,
      provider_type: "oidc",
      issuer: "https://authentik.test/application/o/admitto/",
      client_id: "admitto-direct-oidc",
      authorization_endpoint: "https://authentik.test/application/o/authorize/",
      token_endpoint: "https://authentik.test/application/o/token/",
      jwks_uri: "https://authentik.test/application/o/jwks/",
      display_name: "Authentik direct",
      enabled: true,
      claim_groups: "admitto_groups",
    },
  });
  await prisma.externalIdentity.createMany({
    data: [
      {
        provider_id: sourceProvider.id,
        subject: AUTHENTIK_SUPER_SUBJECT,
        user_id: SUPER_ID,
        email: SUPER_EMAIL,
      },
      {
        provider_id: sourceProvider.id,
        subject: AUTHENTIK_NO_ROLE_SUBJECT,
        user_id: NO_ROLE_ID,
        email: NO_ROLE_EMAIL,
      },
    ],
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
  cfAccessProviderId = provider.id;
  app = createApp({
    prisma,
    skipCheckinBootValidation: true,
    rateLimitStore: createRateLimitStore(),
    adminDistRoot,
  });
});

afterAll(async () => {
  clearCfAccessJwksCacheForTests();
  // Remove the CF Access settings seeded above. SystemSettings is instance-wide state in the
  // shared admitto_web_test database - identity-api-routes.test.ts's team_domain_required test
  // requires these keys to be absent, and file order is not guaranteed (the sequencer sorts by
  // cached timings), so leaving them behind made that test fail intermittently.
  await prisma.systemSettings.deleteMany({ where: { key: { startsWith: "cf_access_" } } });
  // The provider and identities are also shared test-database state. Leaving the direct OIDC
  // fixture behind makes unrelated account-route tests offer it as a connectable provider.
  await prisma.externalIdentity.deleteMany({
    where: { provider_id: { in: [AUTHENTIK_SOURCE_PROVIDER_ID, cfAccessProviderId] } },
  });
  await prisma.identityProvider.deleteMany({
    where: { id: { in: [AUTHENTIK_SOURCE_PROVIDER_ID, cfAccessProviderId] } },
  });
  await prisma.userMfaMethod.deleteMany({ where: { user_id: { in: [SUPER_ID, NO_ROLE_ID] } } });
  await prisma.roleAssignment.deleteMany({ where: { user_id: { in: [SUPER_ID, NO_ROLE_ID] } } });
  await prisma.session.deleteMany({ where: { user_id: { in: [SUPER_ID, NO_ROLE_ID] } } });
  await prisma.user.deleteMany({ where: { id: { in: [SUPER_ID, NO_ROLE_ID] } } });
  await stopMockCfAccess(mock);
  await prisma.$disconnect();
});

describe("CF Access admin collision point", () => {
  it("redirects /admin to /login when JWT absent and no session (not 401)", async () => {
    const res = await app.request("/admin");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
  });

  it("GET / redirects to /login", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
  });

  it("allows break-glass session without CF JWT", async () => {
    const res = await app.request("/admin", {
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(200);
  });

  it("ignores stale CF_Authorization cookie and allows break-glass session", async () => {
    const res = await app.request("/admin", {
      headers: {
        Cookie: `${superCookie}; CF_Authorization=invalid.stale.jwt`,
      },
    });
    expect(res.status).toBe(200);
  });

  it("returns a JSON login boundary for an uncredentialed protected API request", async () => {
    const res = await app.request("/api/admin/identity/providers");

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "authentication_required" });
  });

  it("allows a break-glass session to use protected APIs", async () => {
    const res = await app.request("/api/admin/identity/providers", {
      headers: { Cookie: superCookie },
    });

    expect(res.status).toBe(200);
  });

  it("rejects a non-superadmin break-glass session with JSON", async () => {
    const { rawToken, session } = await createSession(prisma, {
      userId: NO_ROLE_ID,
      stage: SESSION_STAGE.FULL,
    });
    try {
      const res = await app.request("/api/admin/identity/providers", {
        headers: { Cookie: `admitto_session=${rawToken}` },
      });

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "forbidden" });
    } finally {
      await prisma.session.delete({ where: { id: session.id } });
    }
  });

  it("falls back to a break-glass session when Cloudflare Access is disabled", async () => {
    await prisma.systemSettings.update({
      where: { key: SETTING_CF_ACCESS_ENABLED },
      data: { value_json: "false" },
    });
    clearCfAccessRuntimeConfigCache();
    try {
      const res = await app.request("/api/admin/identity/providers", {
        headers: {
          Cookie: superCookie,
          [CF_ACCESS_HEADER]: "not.a.jwt",
        },
      });

      expect(res.status).toBe(200);
    } finally {
      await prisma.systemSettings.update({
        where: { key: SETTING_CF_ACCESS_ENABLED },
        data: { value_json: "true" },
      });
      clearCfAccessRuntimeConfigCache();
    }
  });

  it("valid CF JWT + superadmin renders SPA shell without login redirect", async () => {
    const token = await signCfAccessJwt(mock, {
      sub: "cf-super-sub",
      email: SUPER_EMAIL,
      custom: { admitto_identity: AUTHENTIK_SUPER_SUBJECT },
    });
    const res = await app.request("/admin", {
      headers: { [CF_ACCESS_HEADER]: token },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("staff-spa-fixture");
  });

  it("allows a Cloudflare Access superadmin to use the superadmin-only identity API", async () => {
    const token = await signCfAccessJwt(mock, {
      sub: "cf-super-sub",
      email: SUPER_EMAIL,
      custom: { admitto_identity: AUTHENTIK_SUPER_SUBJECT },
    });
    const res = await app.request("/api/admin/identity/providers", {
      headers: { [CF_ACCESS_HEADER]: token },
    });

    expect(res.status).toBe(200);
  });

  it("CF JWT without session bootstraps admin SPA and /api/admin/* APIs", async () => {
    const token = await signCfAccessJwt(mock, {
      sub: "cf-super-sub",
      email: SUPER_EMAIL,
      custom: { admitto_identity: AUTHENTIK_SUPER_SUBJECT },
    });
    const headers = { [CF_ACCESS_HEADER]: token };

    const spa = await app.request("/admin", { headers });
    expect(spa.status).toBe(200);
    expect(await spa.text()).toContain("staff-spa-fixture");

    const me = await app.request("/api/admin/me", { headers });
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as { user: { email: string }; session_active: boolean };
    expect(meBody.user.email).toBe(SUPER_EMAIL);
    expect(meBody.session_active).toBe(false);

    const cfIdentity = await prisma.externalIdentity.findUnique({
      where: { provider_id_subject: { provider_id: (await prisma.identityProvider.findFirstOrThrow({ where: { provider_type: "cloudflare_access" } })).id, subject: "cf-super-sub" } },
    });
    expect(cfIdentity?.user_id).toBe(SUPER_ID);

    const theme = await app.request("/api/admin/theme", { headers });
    expect(theme.status).toBe(200);

    const legacyMe = await app.request("/api/auth/me", { headers });
    expect(legacyMe.status).toBe(401);
  });

  it("valid CF JWT + no role returns 403 message", async () => {
    const token = await signCfAccessJwt(mock, {
      sub: "cf-norole-sub",
      email: NO_ROLE_EMAIL,
      custom: { admitto_identity: AUTHENTIK_NO_ROLE_SUBJECT },
    });
    // Probe a requireAdminAccess-gated route: the CF no-role branch returns the
    // CF-specific text body (staffAdminGate on /admin returns a generic Forbidden).
    const res = await app.request("/api/admin/identity/providers", {
      headers: { [CF_ACCESS_HEADER]: token },
    });
    expect(res.status).toBe(403);
    const text = await res.text();
    expect(text).toContain("Cloudflare Access, but this account has no admin access");
  });

  it("reconciles source-provider group grants on every Cloudflare Access sign-in", async () => {
    const group = "cf-managed-superadmins";
    const subject = "cf-group-sync-sub";
    await prisma.oidcGroupRoleMapping.create({
      data: {
        provider_id: AUTHENTIK_SOURCE_PROVIDER_ID,
        group,
        role: "superadmin",
        scope_type: "instance",
        scope_id: "",
      },
    });

    try {
      const grantedToken = await signCfAccessJwt(mock, {
        sub: subject,
        email: NO_ROLE_EMAIL,
        custom: {
          admitto_identity: AUTHENTIK_NO_ROLE_SUBJECT,
          admitto_groups: [group],
        },
      });
      const granted = await app.request("/api/admin/identity/providers", {
        headers: { [CF_ACCESS_HEADER]: grantedToken },
      });
      expect(granted.status).toBe(200);
      expect(
        await prisma.oidcRoleGrant.count({
          where: { provider_id: AUTHENTIK_SOURCE_PROVIDER_ID, user_id: NO_ROLE_ID },
        }),
      ).toBe(1);

      const revokedToken = await signCfAccessJwt(mock, {
        sub: subject,
        email: NO_ROLE_EMAIL,
        custom: {
          admitto_identity: AUTHENTIK_NO_ROLE_SUBJECT,
          admitto_groups: [],
        },
      });
      const revoked = await app.request("/api/admin/identity/providers", {
        headers: { [CF_ACCESS_HEADER]: revokedToken },
      });
      expect(revoked.status).toBe(403);
      expect(
        await prisma.oidcRoleGrant.count({
          where: { provider_id: AUTHENTIK_SOURCE_PROVIDER_ID, user_id: NO_ROLE_ID },
        }),
      ).toBe(0);
      await expect(
        prisma.externalIdentity.findUniqueOrThrow({
          where: {
            provider_id_subject: {
              provider_id: AUTHENTIK_SOURCE_PROVIDER_ID,
              subject: AUTHENTIK_NO_ROLE_SUBJECT,
            },
          },
          select: { groups: true },
        }),
      ).resolves.toEqual({ groups: [] });
    } finally {
      await prisma.oidcGroupRoleMapping.deleteMany({
        where: { provider_id: AUTHENTIK_SOURCE_PROVIDER_ID, group },
      });
      await prisma.roleAssignment.deleteMany({
        where: { user_id: NO_ROLE_ID, role: "superadmin", scope_type: "instance" },
      });
      await prisma.externalIdentity.update({
        where: {
          provider_id_subject: {
            provider_id: AUTHENTIK_SOURCE_PROVIDER_ID,
            subject: AUTHENTIK_NO_ROLE_SUBJECT,
          },
        },
        data: { groups: [] },
      });
    }
  });

  it("fails closed when a mapped source group claim was not copied into the Access JWT", async () => {
    const group = "cf-required-group-claim";
    const subject = "cf-missing-group-claim-sub";
    await prisma.oidcGroupRoleMapping.create({
      data: {
        provider_id: AUTHENTIK_SOURCE_PROVIDER_ID,
        group,
        role: "superadmin",
        scope_type: "instance",
        scope_id: "",
      },
    });

    try {
      const token = await signCfAccessJwt(mock, {
        sub: subject,
        email: NO_ROLE_EMAIL,
        custom: { admitto_identity: AUTHENTIK_NO_ROLE_SUBJECT },
      });
      const res = await app.request("/api/admin/identity/providers", {
        headers: { [CF_ACCESS_HEADER]: token },
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "cf_access_jwt_invalid" });
      expect(
        await prisma.oidcRoleGrant.count({
          where: { provider_id: AUTHENTIK_SOURCE_PROVIDER_ID, user_id: NO_ROLE_ID },
        }),
      ).toBe(0);
    } finally {
      await prisma.oidcGroupRoleMapping.deleteMany({
        where: { provider_id: AUTHENTIK_SOURCE_PROVIDER_ID, group },
      });
    }
  });

  it("invalid CF JWT rejects even with valid session", async () => {
    const res = await app.request("/admin", {
      headers: {
        Cookie: superCookie,
        [CF_ACCESS_HEADER]: "not.a.jwt",
      },
    });
    expect(res.status).toBe(403);
  });

  it("rejects an invalid CF JWT at the superadmin-only API even with a break-glass session", async () => {
    const res = await app.request("/api/admin/identity/providers", {
      headers: {
        Cookie: superCookie,
        [CF_ACCESS_HEADER]: "not.a.jwt",
      },
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "cf_access_jwt_invalid" });
  });

  it("rejects a canonical claim not linked through the selected source even when its email matches a local user", async () => {
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

      const token = await signCfAccessJwt(mock, {
        sub: "cf-orphan-sub",
        email: orphanEmail,
        custom: { admitto_identity: "unlinked-authentik-user-uuid" },
      });
      const staffPage = await app.request("/admin", {
        headers: { [CF_ACCESS_HEADER]: token },
      });
      expect(staffPage.status).toBe(403);

      const res = await app.request("/api/admin/identity/providers", {
        headers: { [CF_ACCESS_HEADER]: token },
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "cf_access_jwt_invalid" });
      expect(
        await prisma.externalIdentity.findFirst({
          where: { provider_id: AUTHENTIK_SOURCE_PROVIDER_ID, subject: "unlinked-authentik-user-uuid" },
        }),
      ).toBeNull();
    } finally {
      await prisma.roleAssignment.deleteMany({ where: { user_id: orphanId } });
      await prisma.user.deleteMany({ where: { id: orphanId } });
    }
  });

  it("rejects a validated token with an empty subject", async () => {
    const token = await signCfAccessJwt(mock, { sub: "", email: SUPER_EMAIL });
    const res = await app.request("/api/admin/identity/providers", {
      headers: { [CF_ACCESS_HEADER]: token },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "cf_access_jwt_invalid" });
  });

  it("rejects a valid JWT without canonical identity on both the SPA and privileged API without creating a link", async () => {
    const token = await signCfAccessJwt(mock, { sub: "cf-missing-identity-sub", email: SUPER_EMAIL });
    const headers = { [CF_ACCESS_HEADER]: token };

    const staffPage = await app.request("/admin", { headers });
    expect(staffPage.status).toBe(403);
    const api = await app.request("/api/admin/identity/providers", { headers });
    expect(api.status).toBe(403);
    expect(await api.json()).toEqual({ error: "cf_access_jwt_invalid" });

    const provider = await prisma.identityProvider.findFirstOrThrow({
      where: { provider_type: "cloudflare_access" },
    });
    expect(
      await prisma.externalIdentity.findUnique({
        where: { provider_id_subject: { provider_id: provider.id, subject: "cf-missing-identity-sub" } },
      }),
    ).toBeNull();
  });

  it("rejects a Cloudflare subject already bound to another local user", async () => {
    const provider = await prisma.identityProvider.findFirstOrThrow({
      where: { provider_type: "cloudflare_access" },
    });
    await prisma.externalIdentity.create({
      data: {
        provider_id: provider.id,
        subject: "cf-collision-sub",
        user_id: NO_ROLE_ID,
        email: NO_ROLE_EMAIL,
      },
    });
    try {
      const token = await signCfAccessJwt(mock, {
        sub: "cf-collision-sub",
        email: SUPER_EMAIL,
        custom: { admitto_identity: AUTHENTIK_SUPER_SUBJECT },
      });
      const res = await app.request("/api/admin/identity/providers", {
        headers: { [CF_ACCESS_HEADER]: token },
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "cf_access_jwt_invalid" });
    } finally {
      await prisma.externalIdentity.delete({
        where: { provider_id_subject: { provider_id: provider.id, subject: "cf-collision-sub" } },
      });
    }
  });

  it("rejects a CF JWT when the configured source provider is disabled", async () => {
    await prisma.identityProvider.update({
      where: { id: AUTHENTIK_SOURCE_PROVIDER_ID },
      data: { enabled: false },
    });
    try {
      const token = await signCfAccessJwt(mock, {
        sub: "cf-source-disabled-sub",
        email: SUPER_EMAIL,
        custom: { admitto_identity: AUTHENTIK_SUPER_SUBJECT },
      });
      const res = await app.request("/api/admin/identity/providers", {
        headers: { [CF_ACCESS_HEADER]: token },
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "cf_access_jwt_invalid" });
    } finally {
      await prisma.identityProvider.update({
        where: { id: AUTHENTIK_SOURCE_PROVIDER_ID },
        data: { enabled: true },
      });
    }
  });

  it("rejects a CF JWT when its linked source account is inactive", async () => {
    await prisma.user.update({ where: { id: NO_ROLE_ID }, data: { is_active: false } });
    try {
      const token = await signCfAccessJwt(mock, {
        sub: "cf-source-user-inactive-sub",
        email: NO_ROLE_EMAIL,
        custom: { admitto_identity: AUTHENTIK_NO_ROLE_SUBJECT },
      });
      const res = await app.request("/api/admin/identity/providers", {
        headers: { [CF_ACCESS_HEADER]: token },
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "cf_access_jwt_invalid" });
    } finally {
      await prisma.user.update({ where: { id: NO_ROLE_ID }, data: { is_active: true } });
    }
  });

  it("rejects CF JWTs while the Cloudflare Access provider is disabled", async () => {
    const provider = await prisma.identityProvider.findFirstOrThrow({
      where: { provider_type: "cloudflare_access" },
    });
    await prisma.identityProvider.update({ where: { id: provider.id }, data: { enabled: false } });

    try {
      const token = await signCfAccessJwt(mock, {
        sub: "cf-super-sub",
        email: SUPER_EMAIL,
        custom: { admitto_identity: AUTHENTIK_SUPER_SUBJECT },
      });
      const staffPage = await app.request("/admin", {
        headers: { [CF_ACCESS_HEADER]: token },
      });
      expect(staffPage.status).toBe(403);

      const res = await app.request("/api/admin/identity/providers", {
        headers: { [CF_ACCESS_HEADER]: token },
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "cf_access_jwt_invalid" });
    } finally {
      await prisma.identityProvider.update({ where: { id: provider.id }, data: { enabled: true } });
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
