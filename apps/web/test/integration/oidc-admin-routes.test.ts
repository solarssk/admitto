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

const PROVIDER_ID = "web-oidc-admin-provider";
const SUPER_ID = "web-oidc-superadmin";
const OPERATOR_ID = "web-oidc-operator";
const SUPER_EMAIL = "oidc-admin-super@example.com";
const OPERATOR_EMAIL = "oidc-admin-op@example.com";
const sameOrigin = { Origin: "http://localhost" };

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let superCookie: string;

beforeAll(async () => {
  prisma = new PrismaClient();
  await prisma.oidcGroupRoleMapping.deleteMany({ where: { provider_id: PROVIDER_ID } });
  await prisma.identityProvider.deleteMany({ where: { id: PROVIDER_ID } });
  await prisma.userMfaMethod.deleteMany({ where: { user_id: { in: [SUPER_ID, OPERATOR_ID] } } });
  await prisma.roleAssignment.deleteMany({ where: { user_id: { in: [SUPER_ID, OPERATOR_ID] } } });
  await prisma.session.deleteMany({ where: { user_id: { in: [SUPER_ID, OPERATOR_ID] } } });
  await prisma.user.deleteMany({ where: { id: { in: [SUPER_ID, OPERATOR_ID] } } });

  const password_hash = await hashPassword("admin-pass-123");
  await prisma.user.createMany({
    data: [
      { id: SUPER_ID, email: SUPER_EMAIL, password_hash },
      { id: OPERATOR_ID, email: OPERATOR_EMAIL, password_hash },
    ],
  });
  await prisma.roleAssignment.create({
    data: { user_id: SUPER_ID, role: "superadmin", scope_type: "instance", scope_id: null },
  });
  await prisma.roleAssignment.create({
    data: { user_id: OPERATOR_ID, role: "operator", scope_type: "instance", scope_id: null },
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

  await prisma.identityProvider.create({
    data: {
      id: PROVIDER_ID,
      provider_type: "oidc",
      issuer: "https://admin-test.example.com/",
      client_id: "admin-test-client",
      client_secret_enc: encryptClientSecret("original-secret"),
      authorization_endpoint: "https://admin-test.example.com/a",
      token_endpoint: "https://admin-test.example.com/t",
      jwks_uri: "https://admin-test.example.com/j",
      display_name: "Admin Test IdP",
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
  await prisma.userMfaMethod.deleteMany({ where: { user_id: { in: [SUPER_ID, OPERATOR_ID] } } });
  await prisma.roleAssignment.deleteMany({ where: { user_id: { in: [SUPER_ID, OPERATOR_ID] } } });
  await prisma.session.deleteMany({ where: { user_id: { in: [SUPER_ID, OPERATOR_ID] } } });
  await prisma.user.deleteMany({ where: { id: { in: [SUPER_ID, OPERATOR_ID] } } });
  await prisma.$disconnect();
});

describe("oidc admin routes", () => {
  it("operator gets 403 on provider list", async () => {
    const { rawToken } = await createSession(prisma, {
      userId: OPERATOR_ID,
      stage: SESSION_STAGE.FULL,
    });
    const res = await app.request("/admin/auth/providers", {
      headers: { Cookie: `admitto_session=${rawToken}` },
    });
    expect(res.status).toBe(403);
  });

  it("superadmin can list providers", async () => {
    const res = await app.request("/admin/auth/providers", {
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Admin Test IdP");
  });

  it("CSRF blocks POST without Origin", async () => {
    const res = await app.request(`/admin/auth/providers/${PROVIDER_ID}`, {
      method: "POST",
      headers: { Cookie: superCookie, "Content-Type": "application/x-www-form-urlencoded" },
      body: "display_name=x&issuer=y&client_id=z",
    });
    expect(res.status).toBe(403);
  });

  it("empty client_secret POST does not clear stored secret", async () => {
    const before = await prisma.identityProvider.findUniqueOrThrow({ where: { id: PROVIDER_ID } });
    const res = await app.request(`/admin/auth/providers/${PROVIDER_ID}`, {
      method: "POST",
      headers: {
        Cookie: superCookie,
        "Content-Type": "application/x-www-form-urlencoded",
        ...sameOrigin,
      },
      body: new URLSearchParams({
        display_name: "Admin Test IdP",
        issuer: "https://admin-test.example.com/",
        client_id: "admin-test-client",
        client_secret: "",
        authorization_endpoint: "https://admin-test.example.com/a",
        token_endpoint: "https://admin-test.example.com/t",
        jwks_uri: "https://admin-test.example.com/j",
      }).toString(),
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    const after = await prisma.identityProvider.findUniqueOrThrow({ where: { id: PROVIDER_ID } });
    expect(after.client_secret_enc).toBe(before.client_secret_enc);
  });

  it("toggle enables and disables provider without full form save", async () => {
    await prisma.identityProvider.update({
      where: { id: PROVIDER_ID },
      data: { enabled: false },
    });

    const enableRes = await app.request(`/admin/auth/providers/${PROVIDER_ID}/toggle`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin },
      redirect: "manual",
    });
    expect(enableRes.status).toBe(302);
    let row = await prisma.identityProvider.findUniqueOrThrow({ where: { id: PROVIDER_ID } });
    expect(row.enabled).toBe(true);

    const disableRes = await app.request(`/admin/auth/providers/${PROVIDER_ID}/toggle`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin },
      redirect: "manual",
    });
    expect(disableRes.status).toBe(302);
    row = await prisma.identityProvider.findUniqueOrThrow({ where: { id: PROVIDER_ID } });
    expect(row.enabled).toBe(false);
  });

  it("provider list shows role select on edit form", async () => {
    const res = await app.request(`/admin/auth/providers/${PROVIDER_ID}`, {
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('name="mapping_role_');
    expect(html).toContain("<select");
    expect(html).toContain("superadmin");
  });
});
