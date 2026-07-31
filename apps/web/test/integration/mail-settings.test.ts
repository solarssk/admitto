import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import {
  createSession,
  hashPassword,
  SESSION_STAGE,
  SETTING_SETUP_COMPLETE,
  setSetting,
} from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import type { ExportPayload } from "@admitto/mailer";
import * as tickets from "@admitto/tickets";
import { createApp } from "../../src/app.js";
import { InMemoryRateLimitStore } from "../../src/rate-limit/in-memory.js";
import { setMailSettings } from "@admitto/mailer-config";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };

const ORG_MAIL = "org-mail-settings-test";
const EMAIL_SUPER = "mail-settings-super@example.com";
const EMAIL_ADMIN = "mail-settings-admin@example.com";
const PASSWORD = "mail-settings-pass-123";

const exported: ExportPayload[] = [];
let failExport = false;

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let rateLimitStore: InMemoryRateLimitStore;
let superId: string;
let adminId: string;
let superCookie = "";
let adminCookie = "";
let prevInstanceOrgId: string | undefined;
let prevNodeEnv: string | undefined;

async function seed(client: PrismaClient) {
  await client.adminAuditLog.deleteMany({ where: { organization_id: ORG_MAIL } });
  await client.mailSettings.deleteMany({ where: { scope_id: ORG_MAIL } });
  await client.roleAssignment.deleteMany({
    where: { OR: [{ scope_id: ORG_MAIL }] },
  });
  await client.session.deleteMany({
    where: { user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN] } } },
  });
  await client.userMfaMethod.deleteMany({
    where: { user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN] } } },
  });
  await client.user.deleteMany({ where: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN] } } });
  await client.organization.deleteMany({ where: { id: ORG_MAIL } });

  const password_hash = await hashPassword(PASSWORD);

  await client.organization.create({
    data: { id: ORG_MAIL, name: "Mail Settings Org", slug: "mail-settings-test" },
  });

  const superUser = await client.user.create({ data: { email: EMAIL_SUPER, password_hash } });
  const adminUser = await client.user.create({ data: { email: EMAIL_ADMIN, password_hash } });
  superId = superUser.id;
  adminId = adminUser.id;

  await client.roleAssignment.createMany({
    data: [
      { user_id: superId, role: "superadmin", scope_type: "instance", scope_id: null },
      { user_id: adminId, role: "admin", scope_type: "organization", scope_id: ORG_MAIL },
    ],
  });

  for (const userId of [superId, adminId]) {
    await client.userMfaMethod.create({
      data: {
        user_id: userId,
        type: "totp",
        secret_enc: encryptTotpSecret(generateTotpSecret()),
        confirmed_at: new Date(),
      },
    });
  }
}

beforeAll(async () => {
  prevInstanceOrgId = process.env.INSTANCE_ORG_ID;
  prevNodeEnv = process.env.NODE_ENV;
  process.env.INSTANCE_ORG_ID = ORG_MAIL;

  prisma = createTestPrismaClient();
  await seed(prisma);

  rateLimitStore = new InMemoryRateLimitStore();
  app = createApp({
    prisma,
    baseUrl: "https://tickets.example.com",
    rateLimitStore,
    skipCheckinBootValidation: true,
    adminDistRoot,
    mailDeliveryDeps: {
      exportSink: (payload) => {
        if (failExport) throw new Error("export sink failed");
        exported.push(payload);
      },
    },
  });

  const superSession = await createSession(prisma, { userId: superId, stage: SESSION_STAGE.FULL });
  const adminSession = await createSession(prisma, { userId: adminId, stage: SESSION_STAGE.FULL });
  superCookie = `admitto_session=${superSession.rawToken}`;
  adminCookie = `admitto_session=${adminSession.rawToken}`;
});

afterEach(async () => {
  await prisma.adminAuditLog.deleteMany({ where: { organization_id: ORG_MAIL } });
  await prisma.mailSettings.deleteMany({ where: { scope_id: ORG_MAIL } });
  exported.length = 0;
  failExport = false;
  resetSystemLogBufferForTest();
  if (prevNodeEnv !== undefined) process.env.NODE_ENV = prevNodeEnv;
  else delete process.env.NODE_ENV;
});

afterAll(async () => {
  if (prevInstanceOrgId !== undefined) process.env.INSTANCE_ORG_ID = prevInstanceOrgId;
  else delete process.env.INSTANCE_ORG_ID;
  await prisma?.$disconnect();
});

type MailSettingsApi = {
  organizationId: string;
  isProduction: boolean;
  fields: Record<
    string,
    { value?: unknown; set?: boolean; masked?: string | null; source: string; locked?: boolean }
  >;
};

describe("GET /api/admin/mail-settings", () => {
  it("returns masked secrets and source per field for superadmin", async () => {
    await prisma.mailSettings.create({
      data: {
        scope_type: "organization",
        scope_id: ORG_MAIL,
        provider: "smtp",
        host: "smtp.example.com",
        from_address: "events@example.com",
        smtp_password_enc: "not-real-enc",
      },
    });

    const res = await app.request("/api/admin/mail-settings", {
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as MailSettingsApi;
    expect(body.organizationId).toBe(ORG_MAIL);
    expect(body.fields.smtpPassword?.set).toBe(true);
    expect(body.fields.smtpPassword?.masked).toBe("••••");
    expect(body.fields.host?.source).toBe("db");
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("not-real-enc");
    expect(raw).not.toMatch(/[A-Za-z0-9+/]{40,}={0,2}/);
  });

  it("rejects org admin", async () => {
    const res = await app.request("/api/admin/mail-settings", {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(403);
  });

  it("marks env-sourced SMTP fields as locked", async () => {
    const saved = {
      EMAIL_PROVIDER: process.env.EMAIL_PROVIDER,
      SMTP_HOST: process.env.SMTP_HOST,
      SMTP_PORT: process.env.SMTP_PORT,
      SMTP_USER: process.env.SMTP_USER,
      SMTP_PASSWORD: process.env.SMTP_PASSWORD,
      MAIL_FROM_ADDRESS: process.env.MAIL_FROM_ADDRESS,
    };
    process.env.EMAIL_PROVIDER = "smtp";
    process.env.SMTP_HOST = "smtp.all-env.example.com";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_USER = "env-user@example.com";
    process.env.SMTP_PASSWORD = "env-secret";
    process.env.MAIL_FROM_ADDRESS = "from-env@example.com";
    try {
      const res = await app.request("/api/admin/mail-settings", {
        headers: { Cookie: superCookie },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as MailSettingsApi;
      expect(body.fields.provider?.locked).toBe(true);
      expect(body.fields.host?.locked).toBe(true);
      expect(body.fields.port?.locked).toBe(true);
      expect(body.fields.user?.locked).toBe(true);
      expect(body.fields.smtpPassword?.locked).toBe(true);
      expect(body.fields.fromAddress?.locked).toBe(true);
      expect(body.fields.host?.source).toBe("env");
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("does not lock host/fromAddress left at the shipped deploy/.env.example defaults (#264)", async () => {
    const saved = {
      EMAIL_PROVIDER: process.env.EMAIL_PROVIDER,
      SMTP_HOST: process.env.SMTP_HOST,
      MAIL_FROM_ADDRESS: process.env.MAIL_FROM_ADDRESS,
    };
    process.env.EMAIL_PROVIDER = "smtp";
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.MAIL_FROM_ADDRESS = "events@example.com";
    try {
      const res = await app.request("/api/admin/mail-settings", {
        headers: { Cookie: superCookie },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as MailSettingsApi;
      // provider="smtp" is a real, deliberate choice many deployments make — still locks.
      expect(body.fields.provider?.locked).toBe(true);
      // host/fromAddress at the unedited example.com placeholder must not lock.
      expect(body.fields.host?.locked).toBe(false);
      expect(body.fields.fromAddress?.locked).toBe(false);
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("unlocks env-sourced fields during first-run wizard (setup_complete=false)", async () => {
    const saved = {
      EMAIL_PROVIDER: process.env.EMAIL_PROVIDER,
      SMTP_HOST: process.env.SMTP_HOST,
    };
    process.env.EMAIL_PROVIDER = "smtp";
    process.env.SMTP_HOST = "smtp.all-env.example.com";
    await setSetting(prisma, SETTING_SETUP_COMPLETE, false);
    try {
      const res = await app.request("/api/admin/mail-settings", {
        headers: { Cookie: superCookie },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as MailSettingsApi;
      expect(body.fields.provider?.locked).toBe(false);
      expect(body.fields.host?.locked).toBe(false);
      expect(body.fields.provider?.value).toBeNull();
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await prisma.systemSettings.deleteMany({ where: { key: SETTING_SETUP_COMPLETE } });
    }
  });
});

describe("PUT /api/admin/mail-settings", () => {
  it("persists plain fields", async () => {
    const res = await app.request("/api/admin/mail-settings", {
      method: "PUT",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "smtp",
        host: "smtp.put.example.com",
        port: 587,
        user: "put@example.com",
        fromAddress: "put@example.com",
        smtpPassword: "put-secret",
      }),
    });
    expect(res.status).toBe(200);
    const row = await prisma.mailSettings.findUnique({
      where: { scope_type_scope_id: { scope_type: "organization", scope_id: ORG_MAIL } },
    });
    expect(row?.host).toBe("smtp.put.example.com");
    expect(row?.from_address).toBe("put@example.com");
  });

  it("rejects incomplete SMTP activation", async () => {
    const res = await app.request("/api/admin/mail-settings", {
      method: "PUT",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "smtp",
        host: "smtp.incomplete.example.com",
        port: 587,
        fromAddress: "incomplete@example.com",
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string; detail?: string };
    expect(body.error).toBe("incomplete_transport");
    expect(body.detail).toMatch(/user/i);
  });

  it("rejects whitespace-only SMTP host", async () => {
    const res = await app.request("/api/admin/mail-settings", {
      method: "PUT",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ host: "   " }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("validation_failed");
  });

  it("trims SMTP host before persistence", async () => {
    const res = await app.request("/api/admin/mail-settings", {
      method: "PUT",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "smtp",
        host: "  smtp.trim.example.com  ",
        port: 587,
        user: "  trim@example.com  ",
        fromAddress: "trim@example.com",
        smtpPassword: "trim-secret",
      }),
    });
    expect(res.status).toBe(200);
    const row = await prisma.mailSettings.findUnique({
      where: { scope_type_scope_id: { scope_type: "organization", scope_id: ORG_MAIL } },
    });
    expect(row?.host).toBe("smtp.trim.example.com");
    expect(row?.user).toBe("trim@example.com");
  });

  it("leaves secret unchanged when omitted", async () => {
    await setMailSettings(
      { scopeType: "organization", scopeId: ORG_MAIL },
      {
        provider: "smtp",
        host: "smtp.before.example.com",
        port: 587,
        user: "a@example.com",
        fromAddress: "a@example.com",
        smtpPassword: "keep-secret",
      },
      prisma,
    );
    const before = await prisma.mailSettings.findUnique({
      where: { scope_type_scope_id: { scope_type: "organization", scope_id: ORG_MAIL } },
    });

    const res = await app.request("/api/admin/mail-settings", {
      method: "PUT",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ host: "smtp.still.example.com" }),
    });
    expect(res.status).toBe(200);
    const after = await prisma.mailSettings.findUnique({
      where: { scope_type_scope_id: { scope_type: "organization", scope_id: ORG_MAIL } },
    });
    expect(after?.smtp_password_enc).toBe(before?.smtp_password_enc);
  });

  it("clears stored SMTP numeric override when null is sent", async () => {
    await setMailSettings(
      { scopeType: "organization", scopeId: ORG_MAIL },
      {
        provider: "smtp",
        host: "smtp.numeric.example.com",
        port: 587,
        user: "numeric@example.com",
        fromAddress: "numeric@example.com",
        smtpPassword: "numeric-secret",
        maxConnections: 9,
      },
      prisma,
    );

    const res = await app.request("/api/admin/mail-settings", {
      method: "PUT",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ maxConnections: null }),
    });
    expect(res.status).toBe(200);

    const row = await prisma.mailSettings.findUnique({
      where: { scope_type_scope_id: { scope_type: "organization", scope_id: ORG_MAIL } },
    });
    expect(row?.max_connections).toBeNull();
  });

  it("rotates secret when new value provided", async () => {
    const res = await app.request("/api/admin/mail-settings", {
      method: "PUT",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "smtp",
        host: "smtp.rotate.example.com",
        port: 587,
        user: "rotate@example.com",
        fromAddress: "rotate@example.com",
        smtpPassword: "new-rotate-secret",
      }),
    });
    expect(res.status).toBe(200);
    const row = await prisma.mailSettings.findUnique({
      where: { scope_type_scope_id: { scope_type: "organization", scope_id: ORG_MAIL } },
    });
    expect(row?.smtp_password_enc).toBeTruthy();
    expect(row?.smtp_password_enc).not.toBe("new-rotate-secret");
  });

  it("rejects clearing the only password on an active SMTP transport", async () => {
    // Clearing the sole credential would leave an active transport unable to
    // authenticate — this must fail validation instead of silently disabling mail.
    await setMailSettings(
      { scopeType: "organization", scopeId: ORG_MAIL },
      {
        provider: "smtp",
        host: "smtp.clear.example.com",
        port: 587,
        user: "clear@example.com",
        fromAddress: "clear@example.com",
        smtpPassword: "clear-me",
      },
      prisma,
    );

    const res = await app.request("/api/admin/mail-settings", {
      method: "PUT",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ smtpPassword: "" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("incomplete_transport");
    const row = await prisma.mailSettings.findUnique({
      where: { scope_type_scope_id: { scope_type: "organization", scope_id: ORG_MAIL } },
    });
    expect(row?.smtp_password_enc).toBeTruthy();
  });

  it("clears secret when switching away from the provider that needs it", async () => {
    await setMailSettings(
      { scopeType: "organization", scopeId: ORG_MAIL },
      {
        provider: "smtp",
        host: "smtp.clear.example.com",
        port: 587,
        user: "clear@example.com",
        fromAddress: "clear@example.com",
        smtpPassword: "clear-me",
      },
      prisma,
    );

    const res = await app.request("/api/admin/mail-settings", {
      method: "PUT",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "", smtpPassword: "" }),
    });
    expect(res.status).toBe(200);
    const row = await prisma.mailSettings.findUnique({
      where: { scope_type_scope_id: { scope_type: "organization", scope_id: ORG_MAIL } },
    });
    expect(row?.smtp_password_enc).toBeNull();
  });

  it("rejects null secret in JSON", async () => {
    const res = await app.request("/api/admin/mail-settings", {
      method: "PUT",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ smtpPassword: null }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects env-locked field", async () => {
    const prev = process.env.SMTP_HOST;
    process.env.SMTP_HOST = "smtp.env-locked.example.com";
    try {
      const res = await app.request("/api/admin/mail-settings", {
        method: "PUT",
        headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ host: "smtp.override.example.com" }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toBe("managed by environment");
    } finally {
      if (prev === undefined) delete process.env.SMTP_HOST;
      else process.env.SMTP_HOST = prev;
    }
  });

  it("allows save when env locks provider but body omits locked keys", async () => {
    const saved = {
      EMAIL_PROVIDER: process.env.EMAIL_PROVIDER,
      SMTP_USER: process.env.SMTP_USER,
      SMTP_PASSWORD: process.env.SMTP_PASSWORD,
    };
    process.env.EMAIL_PROVIDER = "smtp";
    process.env.SMTP_USER = "env-user@example.com";
    process.env.SMTP_PASSWORD = "env-pass";
    try {
      const res = await app.request("/api/admin/mail-settings", {
        method: "PUT",
        headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({
          fromAddress: "env-lock-save@example.com",
          host: "smtp.db-only.example.com",
          port: 587,
        }),
      });
      expect(res.status).toBe(200);
      const row = await prisma.mailSettings.findUnique({
        where: { scope_type_scope_id: { scope_type: "organization", scope_id: ORG_MAIL } },
      });
      expect(row?.from_address).toBe("env-lock-save@example.com");
      expect(row?.host).toBe("smtp.db-only.example.com");
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("clears stored provider when provider is sent as empty string", async () => {
    await prisma.mailSettings.create({
      data: {
        scope_type: "organization",
        scope_id: ORG_MAIL,
        provider: "smtp",
        host: "smtp.clear.example.com",
        from_address: "clear@example.com",
      },
    });

    const res = await app.request("/api/admin/mail-settings", {
      method: "PUT",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "" }),
    });
    expect(res.status).toBe(200);

    const row = await prisma.mailSettings.findUnique({
      where: { scope_type_scope_id: { scope_type: "organization", scope_id: ORG_MAIL } },
    });
    expect(row?.provider).toBeNull();
    expect(row?.host).toBe("smtp.clear.example.com");
  });

  it("rejects export_only in production", async () => {
    process.env.NODE_ENV = "production";
    const res = await app.request("/api/admin/mail-settings", {
      method: "PUT",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "export_only", fromAddress: "dev@example.com" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects org admin with valid CSRF", async () => {
    const res = await app.request("/api/admin/mail-settings", {
      method: "PUT",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "smtp", fromAddress: "x@example.com" }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects missing CSRF origin", async () => {
    const res = await app.request("/api/admin/mail-settings", {
      method: "PUT",
      headers: { Cookie: superCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "smtp", fromAddress: "x@example.com" }),
    });
    expect(res.status).toBe(403);
  });

  it("writes audit metadata without secret values", async () => {
    const res = await app.request("/api/admin/mail-settings", {
      method: "PUT",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "smtp",
        host: "smtp.audit.example.com",
        port: 587,
        user: "audit@example.com",
        fromAddress: "audit@example.com",
        smtpPassword: "audit-secret-value",
      }),
    });
    expect(res.status).toBe(200);

    const log = await prisma.adminAuditLog.findFirst({
      where: { organization_id: ORG_MAIL, action_type: "mail_settings_updated" },
      orderBy: { created_at: "desc" },
    });
    expect(log).not.toBeNull();
    const meta = log!.metadata as {
      provider?: string;
      fields_changed?: string[];
      secrets_rotated?: string[];
      secrets_cleared?: string[];
    };
    expect(meta.secrets_rotated).toContain("smtpPassword");
    expect(JSON.stringify(meta)).not.toContain("audit-secret-value");
  });
});

describe("POST /api/admin/mail-settings/test", () => {
  it("sends via export_only without EmailDelivery row", async () => {
    await prisma.mailSettings.create({
      data: {
        scope_type: "organization",
        scope_id: ORG_MAIL,
        provider: "export_only",
        from_address: "transport@example.com",
      },
    });

    const before = await prisma.emailDelivery.count();
    const res = await app.request("/api/admin/mail-settings/test", {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ to: "tester@example.com" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; provider?: string };
    expect(body.status).toBe("sent");
    expect(body.provider).toBe("export_only");
    expect(exported).toHaveLength(1);
    expect(await prisma.emailDelivery.count()).toBe(before);

    const log = await prisma.adminAuditLog.findFirst({
      where: { organization_id: ORG_MAIL, action_type: "mail_transport_tested" },
      orderBy: { created_at: "desc" },
    });
    expect(log).not.toBeNull();
    const meta = log!.metadata as { result?: string };
    expect(meta.result).toBe("sent");
    expect(JSON.stringify(meta)).not.toContain("tester@example.com");
  });

  it("returns friendly error when transport not configured", async () => {
    const res = await app.request("/api/admin/mail-settings/test", {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ to: "tester@example.com" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; error?: string; provider?: string };
    expect(body.status).toBe("failed");
    expect(body.error).toBe("mail transport not configured");
    // Provider is unknown here — resolution fails before a mailer is created.
    expect(body.provider).toBeUndefined();

    const logs = querySystemLogs({ source: "mail" });
    expect(
      logs.some((entry) => entry.message === "mail_test_failed" && entry.fields?.error === body.error),
    ).toBe(true);
  });

  it("includes provider on failure once the transport is resolved", async () => {
    await prisma.mailSettings.create({
      data: {
        scope_type: "organization",
        scope_id: ORG_MAIL,
        provider: "export_only",
        from_address: "transport@example.com",
      },
    });
    failExport = true;

    const res = await app.request("/api/admin/mail-settings/test", {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ to: "tester@example.com" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; error?: string; provider?: string };
    expect(body.status).toBe("failed");
    expect(body.provider).toBe("export_only");

    const logs = querySystemLogs({ source: "mail" });
    expect(
      logs.some((entry) => entry.message === "mail_test_failed" && entry.fields?.provider === "export_only"),
    ).toBe(true);
  });

  it("rejects invalid email", async () => {
    const res = await app.request("/api/admin/mail-settings/test", {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ to: "not-an-email" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects org admin with valid CSRF", async () => {
    const res = await app.request("/api/admin/mail-settings/test", {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ to: "tester@example.com" }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects missing CSRF origin", async () => {
    const res = await app.request("/api/admin/mail-settings/test", {
      method: "POST",
      headers: { Cookie: superCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ to: "tester@example.com" }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 429 after 5 test sends per minute", async () => {
    await prisma.mailSettings.create({
      data: {
        scope_type: "organization",
        scope_id: ORG_MAIL,
        provider: "export_only",
        from_address: "transport@example.com",
      },
    });
    rateLimitStore.reset();

    for (let i = 0; i < 5; i++) {
      const res = await app.request("/api/admin/mail-settings/test", {
        method: "POST",
        headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ to: "tester@example.com" }),
      });
      expect(res.status).toBe(200);
    }

    const limited = await app.request("/api/admin/mail-settings/test", {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ to: "tester@example.com" }),
    });
    expect(limited.status).toBe(429);
    const body = (await limited.json()) as { error?: string };
    expect(body.error).toBe("too many requests");

    const securityLogs = querySystemLogs({ source: "security" });
    expect(securityLogs.some((entry) => entry.message === "auth.rate_limit.exceeded")).toBe(true);
  });
});

describe("admin audit atomicity (BE-001)", () => {
  it("rolls back mail settings when audit log write fails", async () => {
    const spy = vi
      .spyOn(tickets, "writeAdminAuditLog")
      .mockRejectedValueOnce(new Error("audit failed"));

    const res = await app.request("/api/admin/mail-settings", {
      method: "PUT",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "smtp",
        host: "smtp.audit-rollback.example.com",
        port: 587,
        user: "audit@example.com",
        fromAddress: "audit@example.com",
        smtpPassword: "audit-rollback-secret",
      }),
    });
    expect(res.status).toBe(500);

    const row = await prisma.mailSettings.findUnique({
      where: { scope_type_scope_id: { scope_type: "organization", scope_id: ORG_MAIL } },
    });
    expect(row?.host).not.toBe("smtp.audit-rollback.example.com");

    spy.mockRestore();
  });
});
