import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Prisma, PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
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
  prisma = createTestPrismaClient(WEB_TEST_DATABASE_URL);
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
    const body = (await res.json()) as {
      org_name: string | null;
      logo_url: string | null;
      logo_original_url: string | null;
      logo_crop: unknown;
    };
    expect(body).toHaveProperty("org_name");
    expect(body).toHaveProperty("logo_url");
    expect(body).toHaveProperty("logo_original_url");
    expect(body).toHaveProperty("logo_crop");
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

  it("PATCH stores logo_original_url and logo_crop for an uploaded logo", async () => {
    const crop = { unit: "%", x: 8, y: 6, width: 70, height: 60, zoom: 1.25 };
    const res = await app.request("/api/admin/setup/org-branding", {
      method: "PATCH",
      headers: {
        Cookie: superCookie,
        "Content-Type": "application/json",
        ...sameOrigin,
      },
      body: JSON.stringify({
        logo_url: "/uploads/default/a1b2c3d4-e5f6-7890-abcd-ef1234567890.png",
        logo_original_url: "/uploads/default/b2c3d4e5-f6a7-8901-bcde-f12345678901.png",
        logo_crop: crop,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      logo_url: string | null;
      logo_original_url: string | null;
      logo_crop: typeof crop | null;
    };
    expect(body.logo_url).toBe("/uploads/default/a1b2c3d4-e5f6-7890-abcd-ef1234567890.png");
    expect(body.logo_original_url).toBe(
      "/uploads/default/b2c3d4e5-f6a7-8901-bcde-f12345678901.png",
    );
    expect(body.logo_crop).toEqual(crop);
  });

  it("deletes a replaced organisation logo upload on PATCH", async () => {
    const { mkdtempSync, rmSync, existsSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { saveBrandingUpload } = await import("../../src/admin/branding-upload.js");

    const uploadDir = mkdtempSync(join(tmpdir(), "admitto-org-logo-cleanup-"));
    const prevUploadDir = process.env.UPLOAD_DIR;
    process.env.UPLOAD_DIR = uploadDir;
    const pngBytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    try {
      const png = new File([pngBytes], "logo.png", { type: "image/png" });
      const first = await saveBrandingUpload(png, "default");
      const second = await saveBrandingUpload(png, "default");
      const firstAbs = join(uploadDir, first.url.slice("/uploads/".length));
      expect(existsSync(firstAbs)).toBe(true);

      const put1 = await app.request("/api/admin/setup/org-branding", {
        method: "PATCH",
        headers: {
          Cookie: superCookie,
          "Content-Type": "application/json",
          ...sameOrigin,
        },
        body: JSON.stringify({
          logo_url: first.url,
          logo_original_url: first.url,
          logo_crop: null,
        }),
      });
      expect(put1.status).toBe(200);

      const put2 = await app.request("/api/admin/setup/org-branding", {
        method: "PATCH",
        headers: {
          Cookie: superCookie,
          "Content-Type": "application/json",
          ...sameOrigin,
        },
        body: JSON.stringify({
          logo_url: second.url,
          logo_original_url: second.url,
          logo_crop: null,
        }),
      });
      expect(put2.status).toBe(200);
      expect(existsSync(firstAbs)).toBe(false);
    } finally {
      if (prevUploadDir === undefined) delete process.env.UPLOAD_DIR;
      else process.env.UPLOAD_DIR = prevUploadDir;
      rmSync(uploadDir, { recursive: true, force: true });
      await prisma.organization.update({
        where: { id: "org_default" },
        data: { logo_url: null, logo_original_url: null, logo_crop: Prisma.JsonNull },
      });
    }
  });

  it("keeps a replaced org logo file when an event still references it", async () => {
    const { mkdtempSync, rmSync, existsSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { saveBrandingUpload } = await import("../../src/admin/branding-upload.js");

    const uploadDir = mkdtempSync(join(tmpdir(), "admitto-org-logo-shared-"));
    const prevUploadDir = process.env.UPLOAD_DIR;
    process.env.UPLOAD_DIR = uploadDir;
    const pngBytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const eventId = "evt-org-logo-share";
    try {
      const png = new File([pngBytes], "logo.png", { type: "image/png" });
      const first = await saveBrandingUpload(png, "default");
      const second = await saveBrandingUpload(png, "default");
      const firstAbs = join(uploadDir, first.url.slice("/uploads/".length));

      await app.request("/api/admin/setup/org-branding", {
        method: "PATCH",
        headers: { Cookie: superCookie, "Content-Type": "application/json", ...sameOrigin },
        body: JSON.stringify({ logo_url: first.url, logo_original_url: null, logo_crop: null }),
      });

      await prisma.event.create({
        data: {
          id: eventId,
          title: "Shares org logo",
          slug: "shares-org-logo",
          date: new Date("2026-11-01T12:00:00.000Z"),
          organization_id: "org_default",
          logo_url: first.url,
        },
      });

      const put2 = await app.request("/api/admin/setup/org-branding", {
        method: "PATCH",
        headers: { Cookie: superCookie, "Content-Type": "application/json", ...sameOrigin },
        body: JSON.stringify({ logo_url: second.url, logo_original_url: null, logo_crop: null }),
      });
      expect(put2.status).toBe(200);
      // Cross-scope reference: event still points at first.url, so GC must not unlink it.
      expect(existsSync(firstAbs)).toBe(true);
    } finally {
      if (prevUploadDir === undefined) delete process.env.UPLOAD_DIR;
      else process.env.UPLOAD_DIR = prevUploadDir;
      rmSync(uploadDir, { recursive: true, force: true });
      await prisma.event.deleteMany({ where: { id: eventId } });
      await prisma.organization.update({
        where: { id: "org_default" },
        data: { logo_url: null, logo_original_url: null, logo_crop: Prisma.JsonNull },
      });
    }
  });

  it("PATCH rejects a malformed logo_crop body", async () => {
    const res = await app.request("/api/admin/setup/org-branding", {
      method: "PATCH",
      headers: {
        Cookie: superCookie,
        "Content-Type": "application/json",
        ...sameOrigin,
      },
      body: JSON.stringify({ logo_crop: { unit: "%", x: 0 } }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid body");
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

  it("rejects malformed JSON with 400 invalid JSON", async () => {
    const res = await app.request("/api/admin/setup/org-branding", {
      method: "PATCH",
      headers: {
        Cookie: superCookie,
        "Content-Type": "application/json",
        ...sameOrigin,
      },
      body: "{not-json",
    });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "invalid JSON" });
  });

  it("rejects org_name null and wrong-typed logo fields", async () => {
    const nullName = await app.request("/api/admin/setup/org-branding", {
      method: "PATCH",
      headers: {
        Cookie: superCookie,
        "Content-Type": "application/json",
        ...sameOrigin,
      },
      body: JSON.stringify({ org_name: null }),
    });
    expect(nullName.status).toBe(400);
    await expect(nullName.json()).resolves.toEqual({ error: "org_name required" });

    const badLogo = await app.request("/api/admin/setup/org-branding", {
      method: "PATCH",
      headers: {
        Cookie: superCookie,
        "Content-Type": "application/json",
        ...sameOrigin,
      },
      body: JSON.stringify({ logo_url: 1 }),
    });
    expect(badLogo.status).toBe(400);
    await expect(badLogo.json()).resolves.toEqual({ error: "invalid body" });
  });
});

describe("GET/POST /api/admin/health", () => {
  // Live probes can hit external endpoints (OIDC discovery, Nominatim, …); 5s flakes under CI load.
  it(
    "returns the passive report and runs live checks for superadmin",
    async () => {
      const getRes = await app.request("/api/admin/health", {
        headers: { Cookie: superCookie },
      });
      expect(getRes.status).toBe(200);
      const getBody = (await getRes.json()) as { groups: unknown[]; overall: string };
      expect(getBody.groups).toHaveLength(2);
      expect(getBody.overall).toBeTruthy();

      const liveRes = await app.request("/api/admin/health/live", {
        method: "POST",
        headers: { Cookie: superCookie, ...sameOrigin },
      });
      expect(liveRes.status).toBe(200);
      const liveBody = (await liveRes.json()) as { groups: unknown[] };
      expect(liveBody.groups).toHaveLength(2);
    },
    20_000,
  );
  it("returns 403 for non-superadmin on both routes", async () => {
    expect(
      (
        await app.request("/api/admin/health", {
          headers: { Cookie: adminCookie },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request("/api/admin/health/live", {
          method: "POST",
          headers: { Cookie: adminCookie, ...sameOrigin },
        })
      ).status,
    ).toBe(403);
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
    expect(
      await prisma.adminAuditLog.findFirst({
        where: { action_type: "instance_setup_completed", actor_user_id: superId },
        orderBy: { created_at: "desc" },
      }),
    ).not.toBeNull();
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
