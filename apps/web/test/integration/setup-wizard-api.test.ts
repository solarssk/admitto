import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  createSession,
  hashPassword,
  SESSION_STAGE,
  SETTING_SETUP_COMPLETE,
  SETTING_INSTANCE_URL,
  setSetting,
} from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { createApp } from "../../src/app.js";
import { createRateLimitStore } from "../../src/rate-limit/index.js";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";
import * as migrationsCheck from "../../src/ops/migrations-check.js";
import { WEB_TEST_DATABASE_URL } from "../testEnv.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const EMAIL_SUPER = "setup-wizard-super@example.com";
const EMAIL_ADMIN = "setup-wizard-admin@example.com";
const PASSWORD = "wizard-pass-12345";

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let superId: string;
let superCookie: string;
let adminCookie: string;
let migrationsOkSpy: ReturnType<typeof vi.spyOn> | undefined;

const sameOrigin = { Origin: "http://localhost" };

function createChecksAppWithoutInjectedBaseUrl(): ReturnType<typeof createApp> {
  const prevNode = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  try {
    return createApp({
      prisma,
      checkinToken: null,
      allowCheckinBearer: false,
      rateLimitStore: createRateLimitStore(),
      skipCheckinBootValidation: true,
      adminDistRoot,
    });
  } finally {
    process.env.NODE_ENV = prevNode;
  }
}

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
  process.env.DATABASE_URL = WEB_TEST_DATABASE_URL;
  prisma = new PrismaClient({
    datasources: { db: { url: WEB_TEST_DATABASE_URL } },
  });
  // Disk-vs-DB migration parity is covered in test/ops/migrations-check.test.ts; Vitest fork
  // workers can inherit CI job DATABASE_URL (main DB) and report a false pending state here.
  migrationsOkSpy = vi.spyOn(migrationsCheck, "checkMigrationsStatus").mockResolvedValue("ok");
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
  migrationsOkSpy?.mockRestore();
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
    expect(body.checks.database?.ok, body.checks.database?.detail).toBe(true);
    expect(body.checks.database?.detail).toContain("migrations");
    expect(body.checks.migrations).toBeUndefined();
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

  it("returns warn on base_url when unset in test environment", async () => {
    const checksApp = createChecksAppWithoutInjectedBaseUrl();
    const prev = process.env.BASE_URL;
    delete process.env.BASE_URL;
    await prisma.systemSettings.deleteMany({ where: { key: SETTING_INSTANCE_URL } });
    try {
      const res = await checksApp.request("/api/admin/setup/checks", {
        headers: { Cookie: superCookie },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        checks: { base_url: { ok: boolean; warn?: boolean; detail: string } };
      };
      expect(body.checks.base_url.ok).toBe(true);
      expect(body.checks.base_url.warn).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.BASE_URL;
      else process.env.BASE_URL = prev;
      await prisma.systemSettings.deleteMany({ where: { key: SETTING_INSTANCE_URL } });
    }
  });

  it("returns ok on base_url when instance_url is set in DB", async () => {
    const checksApp = createChecksAppWithoutInjectedBaseUrl();
    const prev = process.env.BASE_URL;
    delete process.env.BASE_URL;
    await setSetting(prisma, SETTING_INSTANCE_URL, "https://wizard-db.example.com");
    try {
      const res = await checksApp.request("/api/admin/setup/checks", {
        headers: { Cookie: superCookie },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        checks: { base_url: { ok: boolean; warn?: boolean; detail: string } };
      };
      expect(body.checks.base_url.ok).toBe(true);
      expect(body.checks.base_url.warn).toBeUndefined();
      expect(body.checks.base_url.detail).toContain("wizard-db.example.com");
    } finally {
      if (prev === undefined) delete process.env.BASE_URL;
      else process.env.BASE_URL = prev;
      await prisma.systemSettings.deleteMany({ where: { key: SETTING_INSTANCE_URL } });
    }
  });

  it("returns not ok in production when only DB instance_url is set", async () => {
    const checksApp = createChecksAppWithoutInjectedBaseUrl();
    const prevNode = process.env.NODE_ENV;
    const prevBase = process.env.BASE_URL;
    delete process.env.BASE_URL;
    process.env.NODE_ENV = "production";
    await setSetting(prisma, SETTING_INSTANCE_URL, "https://wizard-db.example.com");
    try {
      const res = await checksApp.request("/api/admin/setup/checks", {
        headers: { Cookie: superCookie },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        checks: { base_url: { ok: boolean; warn?: boolean; detail: string } };
      };
      expect(body.checks.base_url.ok).toBe(false);
      expect(body.checks.base_url.warn).toBeUndefined();
      expect(body.checks.base_url.detail).toContain("BASE_URL");
    } finally {
      process.env.NODE_ENV = prevNode;
      if (prevBase === undefined) delete process.env.BASE_URL;
      else process.env.BASE_URL = prevBase;
      await prisma.systemSettings.deleteMany({ where: { key: SETTING_INSTANCE_URL } });
    }
  });

  it("returns ok on loopback http BASE_URL in production (local docker smoke)", async () => {
    const checksApp = createChecksAppWithoutInjectedBaseUrl();
    const prevNode = process.env.NODE_ENV;
    const prevBase = process.env.BASE_URL;
    await prisma.systemSettings.deleteMany({ where: { key: SETTING_INSTANCE_URL } });
    process.env.NODE_ENV = "production";
    process.env.BASE_URL = "http://127.0.0.1:8080";
    try {
      const res = await checksApp.request("/api/admin/setup/checks", {
        headers: { Cookie: superCookie },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        checks: { base_url: { ok: boolean; detail: string } };
      };
      expect(body.checks.base_url.ok).toBe(true);
      expect(body.checks.base_url.detail).toBe("http://127.0.0.1:8080");
    } finally {
      process.env.NODE_ENV = prevNode;
      if (prevBase === undefined) delete process.env.BASE_URL;
      else process.env.BASE_URL = prevBase;
    }
  });

  it("returns not ok on non-loopback http BASE_URL in production", async () => {
    const checksApp = createChecksAppWithoutInjectedBaseUrl();
    const prevNode = process.env.NODE_ENV;
    const prevBase = process.env.BASE_URL;
    await prisma.systemSettings.deleteMany({ where: { key: SETTING_INSTANCE_URL } });
    process.env.NODE_ENV = "production";
    process.env.BASE_URL = "http://tickets.example.com";
    try {
      const res = await checksApp.request("/api/admin/setup/checks", {
        headers: { Cookie: superCookie },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        checks: { base_url: { ok: boolean; detail: string } };
      };
      expect(body.checks.base_url.ok).toBe(false);
      expect(body.checks.base_url.detail).toContain("https");
    } finally {
      process.env.NODE_ENV = prevNode;
      if (prevBase === undefined) delete process.env.BASE_URL;
      else process.env.BASE_URL = prevBase;
    }
  });

  it("returns ok on base_url from injected createApp baseUrl when env and DB unset", async () => {
    const prev = process.env.BASE_URL;
    delete process.env.BASE_URL;
    await prisma.systemSettings.deleteMany({ where: { key: SETTING_INSTANCE_URL } });
    try {
      const res = await app.request("/api/admin/setup/checks", {
        headers: { Cookie: superCookie },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        checks: { base_url: { ok: boolean; warn?: boolean; detail: string } };
      };
      expect(body.checks.base_url.ok).toBe(true);
      expect(body.checks.base_url.warn).toBeUndefined();
      expect(body.checks.base_url.detail).toContain("tickets.example.com");
    } finally {
      if (prev === undefined) delete process.env.BASE_URL;
      else process.env.BASE_URL = prev;
      await prisma.systemSettings.deleteMany({ where: { key: SETTING_INSTANCE_URL } });
    }
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

  it("includes setup_complete on /api/auth/me for superadmin (operator SPA path)", async () => {
    await setSetting(prisma, SETTING_SETUP_COMPLETE, false);
    const res = await app.request("/api/auth/me", { headers: { Cookie: superCookie } });
    expect(res.status).toBe(200);
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
    resetSystemLogBufferForTest();
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

    const [entry] = querySystemLogs({ source: "admin", search: "org_branding_updated" });
    expect(entry).toMatchObject({
      level: "info",
      source: "admin",
      message: "org_branding_updated",
      fields: { fields: ["org_name"], actorUserId: superId, actorEmail: EMAIL_SUPER },
    });
    expect(JSON.stringify(entry)).not.toContain("Wizard Org");
  });

  it("PATCH updates the logo without changing the organization name", async () => {
    resetSystemLogBufferForTest();
    const res = await app.request("/api/admin/setup/org-branding", {
      method: "PATCH",
      headers: {
        Cookie: superCookie,
        "Content-Type": "application/json",
        ...sameOrigin,
      },
      body: JSON.stringify({ logo_url: "https://cdn.example.com/wizard-logo.png" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { org_name: string | null; logo_url: string | null };
    expect(body).toMatchObject({
      org_name: "Wizard Org",
      logo_url: "https://cdn.example.com/wizard-logo.png",
    });
    const [entry] = querySystemLogs({ source: "admin", search: "org_branding_updated" });
    expect(entry).toMatchObject({
      fields: { fields: ["logo_url"], actorUserId: superId, actorEmail: EMAIL_SUPER },
    });
  });

  it("rolls back the organization name when a companion logo URL is invalid", async () => {
    resetSystemLogBufferForTest();
    const before = await prisma.organization.findUniqueOrThrow({
      where: { id: "org_default" },
      select: { name: true, logo_url: true },
    });

    const res = await app.request("/api/admin/setup/org-branding", {
      method: "PATCH",
      headers: {
        Cookie: superCookie,
        "Content-Type": "application/json",
        ...sameOrigin,
      },
      body: JSON.stringify({
        org_name: "Partially saved name",
        logo_url: "not-a-valid-logo-url",
      }),
    });

    expect(res.status).toBe(400);
    await expect(
      prisma.organization.findUniqueOrThrow({
        where: { id: "org_default" },
        select: { name: true, logo_url: true },
      }),
    ).resolves.toEqual(before);
    expect(querySystemLogs({ source: "admin", search: "org_branding_updated" })).toEqual([]);
  });

  it("rejects a blank organization name without changing branding", async () => {
    resetSystemLogBufferForTest();
    const before = await prisma.organization.findUniqueOrThrow({
      where: { id: "org_default" },
      select: { name: true, logo_url: true },
    });

    const res = await app.request("/api/admin/setup/org-branding", {
      method: "PATCH",
      headers: {
        Cookie: superCookie,
        "Content-Type": "application/json",
        ...sameOrigin,
      },
      body: JSON.stringify({ org_name: "   " }),
    });

    expect(res.status).toBe(400);
    await expect(
      prisma.organization.findUniqueOrThrow({
        where: { id: "org_default" },
        select: { name: true, logo_url: true },
      }),
    ).resolves.toEqual(before);
    expect(querySystemLogs({ source: "admin", search: "org_branding_updated" })).toEqual([]);
  });

  it("does not emit a branding update when its transaction fails", async () => {
    resetSystemLogBufferForTest();
    const before = await prisma.organization.findUniqueOrThrow({
      where: { id: "org_default" },
      select: { name: true, logo_url: true },
    });
    const transactionSpy = vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(
      new Error("database failure for setup-wizard-super@example.com"),
    );

    try {
      const res = await app.request("/api/admin/setup/org-branding", {
        method: "PATCH",
        headers: {
          Cookie: superCookie,
          "Content-Type": "application/json",
          ...sameOrigin,
        },
        body: JSON.stringify({ org_name: "Uncommitted org name" }),
      });

      expect(res.status).toBe(500);
      await expect(
        prisma.organization.findUniqueOrThrow({
          where: { id: "org_default" },
          select: { name: true, logo_url: true },
        }),
      ).resolves.toEqual(before);
      expect(querySystemLogs({ source: "admin", search: "org_branding_updated" })).toEqual([]);
      expect(JSON.stringify(querySystemLogs())).not.toContain("database failure");
      expect(JSON.stringify(querySystemLogs())).not.toContain("setup-wizard-super@example.com");
    } finally {
      transactionSpy.mockRestore();
    }
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

  it("returns 409 when system checks are not ready", async () => {
    const spy = vi.spyOn(migrationsCheck, "checkMigrationsStatus").mockResolvedValue("pending");
    try {
      await setSetting(prisma, SETTING_SETUP_COMPLETE, false);
      const res = await app.request("/api/admin/setup/complete", {
        method: "POST",
        headers: { Cookie: superCookie, ...sameOrigin },
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string; checks: { database: { ok: boolean } } };
      expect(body.error).toBe("setup_not_ready");
      expect(body.checks.database.ok).toBe(false);
    } finally {
      spy.mockRestore();
      await prisma.systemSettings.deleteMany({ where: { key: SETTING_SETUP_COMPLETE } });
    }
  });
});
