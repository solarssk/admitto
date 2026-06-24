import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  createSession,
  hashPassword,
  SESSION_STAGE,
  SETTING_SETUP_COMPLETE,
  setSetting,
} from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { createApp } from "../../src/app.js";
import { createRateLimitStore } from "../../src/rate-limit/index.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const EMAIL_SUPER = "setup-wizard-super@example.com";
const EMAIL_ADMIN = "setup-wizard-admin@example.com";
const PASSWORD = "wizard-pass-12345";

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let superId: string;
let superCookie: string;
let adminCookie: string;

const sameOrigin = { Origin: "http://localhost" };

async function seed(client: PrismaClient) {
  await client.roleAssignment.deleteMany({
    where: { user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN] } } },
  });
  await client.session.deleteMany({
    where: { user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN] } } },
  });
  await client.userMfaMethod.deleteMany({
    where: { user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN] } } },
  });
  await client.user.deleteMany({ where: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN] } } });
  await client.systemSettings.deleteMany({ where: { key: SETTING_SETUP_COMPLETE } });

  const password_hash = await hashPassword(PASSWORD);
  const superUser = await client.user.create({ data: { email: EMAIL_SUPER, password_hash } });
  const adminUser = await client.user.create({
    data: { email: EMAIL_ADMIN, password_hash, display_name: "Org Admin" },
  });
  superId = superUser.id;

  await client.roleAssignment.create({
    data: {
      user_id: superId,
      role: "superadmin",
      scope_type: "instance",
      scope_id: null,
    },
  });
  await client.roleAssignment.create({
    data: {
      user_id: adminUser.id,
      role: "admin",
      scope_type: "organization",
      scope_id: "org_default",
    },
  });

  for (const userId of [superId, adminUser.id]) {
    await client.userMfaMethod.create({
      data: {
        user_id: userId,
        type: "totp",
        secret_enc: encryptTotpSecret(generateTotpSecret()),
        confirmed_at: new Date(),
      },
    });
  }

  const superSession = await createSession(client, { userId: superId, stage: SESSION_STAGE.FULL });
  const adminSession = await createSession(client, {
    userId: adminUser.id,
    stage: SESSION_STAGE.FULL,
  });
  superCookie = `admitto_session=${superSession.rawToken}`;
  adminCookie = `admitto_session=${adminSession.rawToken}`;
}

beforeAll(async () => {
  prisma = new PrismaClient();
  await seed(prisma);
  app = createApp({
    prisma,
    checkinToken: null,
    allowCheckinBearer: false,
    baseUrl: "https://tickets.example.com",
    rateLimitStore: createRateLimitStore(),
    skipCheckinBootValidation: true,
    adminDistRoot,
  });
});

afterAll(async () => {
  await prisma.roleAssignment.deleteMany({
    where: { user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN] } } },
  });
  await prisma.session.deleteMany({
    where: { user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN] } } },
  });
  await prisma.userMfaMethod.deleteMany({
    where: { user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN] } } },
  });
  await prisma.user.deleteMany({ where: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN] } } });
  await prisma.systemSettings.deleteMany({ where: { key: SETTING_SETUP_COMPLETE } });
  await prisma?.$disconnect();
});

describe("GET /api/admin/setup/checks", () => {
  it("returns checks for superadmin", async () => {
    const res = await app.request("/api/admin/setup/checks", {
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { checks: Record<string, { ok: boolean; detail: string }> };
    expect(body.checks.database?.ok).toBe(true);
    expect(body.checks.migrations).toBeDefined();
    expect(body.checks.redis).toBeDefined();
    expect(body.checks.encryption).toBeDefined();
    expect(body.checks.base_url).toBeDefined();
  });

  it("returns 403 for non-superadmin", async () => {
    const res = await app.request("/api/admin/setup/checks", {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(403);
  });
});

describe("GET /api/admin/me setup_complete", () => {
  it("defaults to true when setting missing (upgrade-safe)", async () => {
    await prisma.systemSettings.deleteMany({ where: { key: SETTING_SETUP_COMPLETE } });
    const res = await app.request("/api/admin/me", { headers: { Cookie: superCookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { setup_complete: boolean };
    expect(body.setup_complete).toBe(true);
  });

  it("returns false when explicitly marked incomplete", async () => {
    await setSetting(prisma, SETTING_SETUP_COMPLETE, false);
    const res = await app.request("/api/admin/me", { headers: { Cookie: superCookie } });
    const body = (await res.json()) as { setup_complete: boolean };
    expect(body.setup_complete).toBe(false);
    await prisma.systemSettings.deleteMany({ where: { key: SETTING_SETUP_COMPLETE } });
  });
});

describe("setup org-branding", () => {
  it("GET returns org name and logo", async () => {
    const res = await app.request("/api/admin/setup/org-branding", {
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { org_name: string | null; logo_url: string | null };
    expect(body).toHaveProperty("org_name");
    expect(body).toHaveProperty("logo_url");
  });

  it("PATCH updates org name", async () => {
    const res = await app.request("/api/admin/setup/org-branding", {
      method: "PATCH",
      headers: {
        Cookie: superCookie,
        "Content-Type": "application/json",
        ...sameOrigin,
      },
      body: JSON.stringify({ org_name: "Wizard Org" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { org_name: string };
    expect(body.org_name).toBe("Wizard Org");
  });

  it("returns 403 for non-superadmin PATCH", async () => {
    const res = await app.request("/api/admin/setup/org-branding", {
      method: "PATCH",
      headers: {
        Cookie: adminCookie,
        "Content-Type": "application/json",
        ...sameOrigin,
      },
      body: JSON.stringify({ org_name: "Nope" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/admin/setup/complete", () => {
  it("marks setup complete for superadmin", async () => {
    await setSetting(prisma, SETTING_SETUP_COMPLETE, false);
    const res = await app.request("/api/admin/setup/complete", {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { setup_complete: boolean };
    expect(body.setup_complete).toBe(true);

    const meRes = await app.request("/api/admin/me", { headers: { Cookie: superCookie } });
    const me = (await meRes.json()) as { setup_complete: boolean };
    expect(me.setup_complete).toBe(true);
    await prisma.systemSettings.deleteMany({ where: { key: SETTING_SETUP_COMPLETE } });
  });

  it("returns 403 for non-superadmin", async () => {
    const res = await app.request("/api/admin/setup/complete", {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin },
    });
    expect(res.status).toBe(403);
  });
});
