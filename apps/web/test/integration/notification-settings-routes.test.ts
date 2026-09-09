import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { createSession, hashPassword, SESSION_STAGE } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { createApp } from "../../src/app.js";
import { InMemoryRateLimitStore } from "../../src/rate-limit/in-memory.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };

const ORG_ID = "org-notification-settings-routes-test";
const EMAIL_SUPER = "notification-settings-super@example.com";
const EMAIL_ADMIN = "notification-settings-admin@example.com";
const PASSWORD = "notification-settings-test-pass-123";

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let rateLimitStore: InMemoryRateLimitStore;
let superId: string;
let adminId: string;
let superCookie = "";
let prevInstanceOrgId: string | undefined;

/** A real Organization row is required - resolveInstanceOrganizationId (via INSTANCE_ORG_ID set
 * below) resolves every route in this file to it, matching security-audit-routes.test.ts's own
 * setup. */
async function seed(client: PrismaClient) {
  await client.notification.deleteMany({ where: { organization_id: ORG_ID } });
  await client.notificationSettings.deleteMany({
    where: { scope_type: "organization", scope_id: ORG_ID },
  });
  await client.session.deleteMany({
    where: { user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN] } } },
  });
  await client.userMfaMethod.deleteMany({
    where: { user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN] } } },
  });
  await client.roleAssignment.deleteMany({
    where: { user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN] } } },
  });
  await client.user.deleteMany({ where: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN] } } });
  await client.organization.deleteMany({ where: { id: ORG_ID } });

  await client.organization.create({
    data: { id: ORG_ID, name: "Notification Settings Routes Test Org", slug: "notification-settings-routes-test" },
  });

  const password_hash = await hashPassword(PASSWORD);
  const superUser = await client.user.create({ data: { email: EMAIL_SUPER, password_hash } });
  const adminUser = await client.user.create({ data: { email: EMAIL_ADMIN, password_hash } });
  superId = superUser.id;
  adminId = adminUser.id;

  await client.roleAssignment.createMany({
    data: [
      { user_id: superId, role: "superadmin", scope_type: "instance", scope_id: null },
      { user_id: adminId, role: "admin", scope_type: "organization", scope_id: ORG_ID },
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
  process.env.INSTANCE_ORG_ID = ORG_ID;

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
  superCookie = `admitto_session=${superSession.rawToken}`;
});

afterAll(async () => {
  if (prevInstanceOrgId !== undefined) process.env.INSTANCE_ORG_ID = prevInstanceOrgId;
  else delete process.env.INSTANCE_ORG_ID;
  await prisma?.$disconnect();
});

beforeEach(() => {
  rateLimitStore.reset();
});

describe("GET /api/admin/notification-settings", () => {
  it("returns 401 without auth", async () => {
    const res = await app.request("/api/admin/notification-settings");
    expect(res.status).toBe(401);
  });

  it("returns 403 for a non-superadmin admin", async () => {
    const adminSession = await createSession(prisma, { userId: adminId, stage: SESSION_STAGE.FULL });
    const res = await app.request("/api/admin/notification-settings", {
      headers: { Cookie: `admitto_session=${adminSession.rawToken}` },
    });
    expect(res.status).toBe(403);
    await prisma.session.delete({ where: { id: adminSession.session.id } });
  });

  it("returns the default (unconfigured) settings for a superadmin", async () => {
    const res = await app.request("/api/admin/notification-settings", {
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      webhook: { set: boolean; kind: string };
      extra_email_recipients: unknown[];
      disabled_channels: Record<string, unknown>;
      notification_types: unknown[];
    };
    expect(body.webhook).toEqual({ set: false, kind: "generic" });
    expect(body.extra_email_recipients).toEqual([]);
    expect(body.disabled_channels).toEqual({});
    expect(Array.isArray(body.notification_types)).toBe(true);
  });
});

describe("PUT /api/admin/notification-settings", () => {
  it("persists the webhook kind, extra recipient, and per-type disabled channels", async () => {
    const putRes = await app.request("/api/admin/notification-settings", {
      method: "PUT",
      headers: { Cookie: superCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({
        webhookKind: "slack",
        extraEmailRecipients: [{ email: "ops@example.com", description: "Ops team" }],
        disabledChannels: { "auth.login.repeated_failures": ["webhook"] },
      }),
    });
    expect(putRes.status).toBe(200);
    const putBody = (await putRes.json()) as {
      webhook: { kind: string };
      extra_email_recipients: Array<{ email: string; description: string }>;
      disabled_channels: Record<string, string[]>;
    };
    expect(putBody.webhook.kind).toBe("slack");
    expect(putBody.extra_email_recipients).toHaveLength(1);
    expect(putBody.extra_email_recipients[0]).toMatchObject({ email: "ops@example.com", description: "Ops team" });
    expect(putBody.disabled_channels).toEqual({ "auth.login.repeated_failures": ["webhook"] });

    const getRes = await app.request("/api/admin/notification-settings", {
      headers: { Cookie: superCookie },
    });
    const getBody = (await getRes.json()) as { disabled_channels: Record<string, string[]> };
    expect(getBody.disabled_channels).toEqual({ "auth.login.repeated_failures": ["webhook"] });
  });
});

describe("POST /api/admin/notification-settings/test", () => {
  it("tests the shared webhook + this admin's own in-app channel when no testEmail is given", async () => {
    const res = await app.request("/api/admin/notification-settings/test", {
      method: "POST",
      headers: { Cookie: superCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      webhook: { ok: boolean; error?: string };
      email: { ok: boolean; skipped?: boolean };
      in_app: { ok: boolean };
    };
    // No webhook URL configured for this org - the route reports that as a channel failure
    // (ok:false, "Not configured."), not a 500 - see handlePostNotificationSettingsTest's toResult.
    expect(body.webhook).toEqual({ ok: false, error: "Not configured." });
    expect(body.email).toEqual({ ok: true, skipped: true });
    expect(body.in_app).toEqual({ ok: true });

    const notification = await prisma.notification.findFirst({
      where: { organization_id: ORG_ID, user_id: superId },
    });
    expect(notification).not.toBeNull();
  });

  it("rejects a testEmail send once the shared instance-wide recipient budget is exhausted (real HTTP round-trip)", async () => {
    const testEmail = "recipient-budget-test@example.com";
    const sendOnce = () =>
      app.request("/api/admin/notification-settings/test", {
        method: "POST",
        headers: { Cookie: superCookie, "Content-Type": "application/json", ...sameOrigin },
        body: JSON.stringify({ testEmail }),
      });
    // Same 5/hour budget every mail test-send route in the app shares - real key derivation
    // (HMAC over the recipient address) can only be exercised through a real request.
    for (let i = 0; i < 5; i++) {
      const res = await sendOnce();
      expect(res.status).toBe(200);
    }
    const limited = await sendOnce();
    expect(limited.status).toBe(429);
  });
});
