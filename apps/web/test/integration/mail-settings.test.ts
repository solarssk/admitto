import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createSession, hashPassword, SESSION_STAGE } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import type { ExportPayload } from "@admitto/mailer";
import { createApp } from "../../src/app.js";
import { createRateLimitStore } from "../../src/rate-limit/index.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };

const ORG_MAIL = "org-mail-settings-test";
const EMAIL_SUPER = "mail-settings-super@example.com";
const EMAIL_ADMIN = "mail-settings-admin@example.com";
const PASSWORD = "mail-settings-pass-123";

const exported: ExportPayload[] = [];

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
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

  prisma = new PrismaClient();
  await seed(prisma);

  app = createApp({
    prisma,
    baseUrl: "https://tickets.example.com",
    rateLimitStore: createRateLimitStore(),
    skipCheckinBootValidation: true,
    adminDistRoot,
    mailDeliveryDeps: {
      exportSink: (payload) => {
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
  fields: Record<string, { value?: unknown; set?: boolean; masked?: string | null; source: string }>;
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
        fromAddress: "put@example.com",
      }),
    });
    expect(res.status).toBe(200);
    const row = await prisma.mailSettings.findUnique({
      where: { scope_type_scope_id: { scope_type: "organization", scope_id: ORG_MAIL } },
    });
    expect(row?.host).toBe("smtp.put.example.com");
    expect(row?.from_address).toBe("put@example.com");
  });

  it("leaves secret unchanged when omitted", async () => {
    await prisma.mailSettings.create({
      data: {
        scope_type: "organization",
        scope_id: ORG_MAIL,
        provider: "smtp",
        from_address: "a@example.com",
        smtp_password_enc:
          '{"ciphertext":"abc","iv":"def","authTag":"ghi","keyVersion":1}',
      },
    });
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

  it("rotates secret when new value provided", async () => {
    const res = await app.request("/api/admin/mail-settings", {
      method: "PUT",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "smtp",
        fromAddress: "rotate@example.com",
        host: "smtp.rotate.example.com",
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

  it("clears secret when empty string sent", async () => {
    await prisma.mailSettings.create({
      data: {
        scope_type: "organization",
        scope_id: ORG_MAIL,
        provider: "smtp",
        from_address: "clear@example.com",
        smtp_password_enc: "enc-value",
      },
    });

    const res = await app.request("/api/admin/mail-settings", {
      method: "PUT",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ smtpPassword: "" }),
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
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("sent");
    expect(exported.length).toBe(1);
    expect(await prisma.emailDelivery.count()).toBe(before);

    const log = await prisma.adminAuditLog.findFirst({
      where: { organization_id: ORG_MAIL, action_type: "mail_transport_tested" },
      orderBy: { created_at: "desc" },
    });
    expect(log).not.toBeNull();
    const meta = log!.metadata as { to?: string; result?: string };
    expect(meta.to).toBe("tester@example.com");
    expect(meta.result).toBe("sent");
  });

  it("returns friendly error when transport not configured", async () => {
    const res = await app.request("/api/admin/mail-settings/test", {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ to: "tester@example.com" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; error?: string };
    expect(body.status).toBe("failed");
    expect(body.error).toBe("mail transport not configured");
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
});
