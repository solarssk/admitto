import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { createSession, hashPassword, SESSION_STAGE } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { createApp } from "../../src/app.js";
import { InMemoryRateLimitStore } from "../../src/rate-limit/in-memory.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };

const ORG_SUPPORT_CONTACT = "org-support-contact-test";
const EMAIL_SUPER = "supportcontact-super@example.com";
const EMAIL_ADMIN = "supportcontact-admin@example.com";
const PASSWORD = "supportcontact-pass-123";

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let rateLimitStore: InMemoryRateLimitStore;
let superId: string;
let adminId: string;
let superCookie = "";
let adminCookie = "";
let prevInstanceOrgId: string | undefined;

async function seed(client: PrismaClient) {
  await client.adminAuditLog.deleteMany({ where: { organization_id: ORG_SUPPORT_CONTACT } });
  await client.session.deleteMany({
    where: { user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN] } } },
  });
  await client.userMfaMethod.deleteMany({
    where: { user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN] } } },
  });
  await client.roleAssignment.deleteMany({ where: { scope_id: ORG_SUPPORT_CONTACT } });
  await client.user.deleteMany({ where: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN] } } });
  await client.organization.deleteMany({ where: { id: ORG_SUPPORT_CONTACT } });

  const password_hash = await hashPassword(PASSWORD);

  await client.organization.create({
    data: { id: ORG_SUPPORT_CONTACT, name: "Support Contact Test Org", slug: "support-contact-test" },
  });

  const superUser = await client.user.create({ data: { email: EMAIL_SUPER, password_hash } });
  const adminUser = await client.user.create({ data: { email: EMAIL_ADMIN, password_hash } });
  superId = superUser.id;
  adminId = adminUser.id;

  await client.roleAssignment.createMany({
    data: [
      { user_id: superId, role: "superadmin", scope_type: "instance", scope_id: null },
      { user_id: adminId, role: "admin", scope_type: "organization", scope_id: ORG_SUPPORT_CONTACT },
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
  process.env.INSTANCE_ORG_ID = ORG_SUPPORT_CONTACT;

  prisma = createTestPrismaClient();
  await seed(prisma);

  rateLimitStore = new InMemoryRateLimitStore();
  app = createApp({
    prisma,
    baseUrl: "https://admitto.example.com",
    rateLimitStore,
    skipCheckinBootValidation: true,
    adminDistRoot,
    mailDeliveryDeps: { exportSink: () => {} },
  });

  const superSession = await createSession(prisma, { userId: superId, stage: SESSION_STAGE.FULL });
  const adminSession = await createSession(prisma, { userId: adminId, stage: SESSION_STAGE.FULL });
  superCookie = `admitto_session=${superSession.rawToken}`;
  adminCookie = `admitto_session=${adminSession.rawToken}`;
});

afterEach(async () => {
  await prisma.adminAuditLog.deleteMany({ where: { organization_id: ORG_SUPPORT_CONTACT } });
});

afterAll(async () => {
  if (prevInstanceOrgId === undefined) delete process.env.INSTANCE_ORG_ID;
  else process.env.INSTANCE_ORG_ID = prevInstanceOrgId;
  await prisma?.$disconnect();
});

type SupportContactDto = {
  support_contact_name: string | null;
  support_contact_email: string | null;
};

describe("GET /api/admin/setup/support-contact", () => {
  it("returns both fields as null on a fresh org", async () => {
    const res = await app.request("/api/admin/setup/support-contact", {
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SupportContactDto;
    expect(body).toEqual({ support_contact_name: null, support_contact_email: null });
  });

  it("rejects admin (non-superadmin) with 403", async () => {
    const res = await app.request("/api/admin/setup/support-contact", {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(403);
  });

  it("rejects an unauthenticated request", async () => {
    const res = await app.request("/api/admin/setup/support-contact");
    expect(res.status).toBeGreaterThanOrEqual(401);
  });
});

describe("PATCH /api/admin/setup/support-contact", () => {
  it("saves both fields and echoes them back", async () => {
    const res = await app.request("/api/admin/setup/support-contact", {
      method: "PATCH",
      headers: { Cookie: superCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({
        support_contact_name: "Acme Events",
        support_contact_email: "support@acme.example.com",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SupportContactDto;
    expect(body).toEqual({
      support_contact_name: "Acme Events",
      support_contact_email: "support@acme.example.com",
    });

    const stored = await prisma.organization.findUniqueOrThrow({ where: { id: ORG_SUPPORT_CONTACT } });
    expect(stored.support_contact_name).toBe("Acme Events");
    expect(stored.support_contact_email).toBe("support@acme.example.com");
  });

  it("updates only the provided field, leaving the other untouched", async () => {
    await app.request("/api/admin/setup/support-contact", {
      method: "PATCH",
      headers: { Cookie: superCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ support_contact_name: "Acme Events", support_contact_email: "a@example.com" }),
    });

    const res = await app.request("/api/admin/setup/support-contact", {
      method: "PATCH",
      headers: { Cookie: superCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ support_contact_name: "New Name" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SupportContactDto;
    expect(body.support_contact_name).toBe("New Name");
    expect(body.support_contact_email).toBe("a@example.com");
  });

  it("empty string clears a field to null", async () => {
    await app.request("/api/admin/setup/support-contact", {
      method: "PATCH",
      headers: { Cookie: superCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ support_contact_email: "a@example.com" }),
    });

    const res = await app.request("/api/admin/setup/support-contact", {
      method: "PATCH",
      headers: { Cookie: superCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ support_contact_email: "" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SupportContactDto;
    expect(body.support_contact_email).toBeNull();
  });

  it("empty string clears support_contact_name to null too", async () => {
    await app.request("/api/admin/setup/support-contact", {
      method: "PATCH",
      headers: { Cookie: superCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ support_contact_name: "Acme Events" }),
    });

    const res = await app.request("/api/admin/setup/support-contact", {
      method: "PATCH",
      headers: { Cookie: superCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ support_contact_name: "" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SupportContactDto;
    expect(body.support_contact_name).toBeNull();
  });

  it("an empty patch body is a no-op (200, nothing changed)", async () => {
    await app.request("/api/admin/setup/support-contact", {
      method: "PATCH",
      headers: { Cookie: superCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ support_contact_name: "Acme Events" }),
    });

    const res = await app.request("/api/admin/setup/support-contact", {
      method: "PATCH",
      headers: { Cookie: superCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SupportContactDto;
    expect(body.support_contact_name).toBe("Acme Events");
  });

  it("malformed JSON body returns 400 invalid JSON", async () => {
    const res = await app.request("/api/admin/setup/support-contact", {
      method: "PATCH",
      headers: { Cookie: superCookie, "Content-Type": "application/json", ...sameOrigin },
      body: "{not valid json",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid JSON");
  });

  it("rejects an invalid email with 400 validation_error", async () => {
    const res = await app.request("/api/admin/setup/support-contact", {
      method: "PATCH",
      headers: { Cookie: superCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ support_contact_email: "not-an-email" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("validation_error");
  });

  it("rejects an unknown field (strict schema)", async () => {
    const res = await app.request("/api/admin/setup/support-contact", {
      method: "PATCH",
      headers: { Cookie: superCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ support_contact_phone: "+1 555" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects missing CSRF header", async () => {
    const res = await app.request("/api/admin/setup/support-contact", {
      method: "PATCH",
      headers: { Cookie: superCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ support_contact_name: "Acme Events" }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("rejects admin (non-superadmin) with 403", async () => {
    const res = await app.request("/api/admin/setup/support-contact", {
      method: "PATCH",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ support_contact_name: "Acme Events" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/admin/setup/support-contact — admin audit log", () => {
  it("writes a durable AdminAuditLog entry recording only the changed field names", async () => {
    const res = await app.request("/api/admin/setup/support-contact", {
      method: "PATCH",
      headers: { Cookie: superCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({
        support_contact_name: "Acme Events",
        support_contact_email: "support@acme.example.com",
      }),
    });
    expect(res.status).toBe(200);

    const log = await prisma.adminAuditLog.findFirst({
      where: { organization_id: ORG_SUPPORT_CONTACT, action_type: "support_contact_updated" },
    });
    expect(log).not.toBeNull();
    expect(log?.actor_user_id).toBe(superId);
    const meta = log?.metadata as Record<string, unknown>;
    expect(meta?.fields).toEqual(
      expect.arrayContaining(["support_contact_name", "support_contact_email"]),
    );
    expect(JSON.stringify(meta)).not.toContain("Acme Events");
    expect(JSON.stringify(meta)).not.toContain("support@acme.example.com");
  });

  it("does not write an audit log entry for an empty (no-op) patch", async () => {
    const res = await app.request("/api/admin/setup/support-contact", {
      method: "PATCH",
      headers: { Cookie: superCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);

    const log = await prisma.adminAuditLog.findFirst({
      where: { organization_id: ORG_SUPPORT_CONTACT, action_type: "support_contact_updated" },
    });
    expect(log).toBeNull();
  });
});
