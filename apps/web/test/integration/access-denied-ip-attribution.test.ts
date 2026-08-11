import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { createSession, hashPassword, SESSION_STAGE } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";
import { createApp } from "../../src/app.js";
import { InMemoryRateLimitStore } from "../../src/rate-limit/in-memory.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");

const ORG_ATTRIBUTION = "org-access-denied-attribution-test";
const EMAIL_NO_ROLE = "access-denied-no-role@example.com";
const EMAIL_ADMIN_NOT_SUPER = "access-denied-admin-not-super@example.com";
const PASSWORD = "access-denied-attribution-pass-123";

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let noRoleId: string;
let adminNotSuperId: string;

async function seed(client: PrismaClient) {
  await client.session.deleteMany({
    where: { user: { email: { in: [EMAIL_NO_ROLE, EMAIL_ADMIN_NOT_SUPER] } } },
  });
  await client.userMfaMethod.deleteMany({
    where: { user: { email: { in: [EMAIL_NO_ROLE, EMAIL_ADMIN_NOT_SUPER] } } },
  });
  await client.roleAssignment.deleteMany({
    where: { user: { email: { in: [EMAIL_NO_ROLE, EMAIL_ADMIN_NOT_SUPER] } } },
  });
  await client.user.deleteMany({ where: { email: { in: [EMAIL_NO_ROLE, EMAIL_ADMIN_NOT_SUPER] } } });
  await client.organization.deleteMany({ where: { id: ORG_ATTRIBUTION } });

  await client.organization.create({
    data: { id: ORG_ATTRIBUTION, name: "Access Denied Attribution Test Org", slug: "access-denied-attribution-test" },
  });

  const password_hash = await hashPassword(PASSWORD);
  const noRoleUser = await client.user.create({ data: { email: EMAIL_NO_ROLE, password_hash } });
  const adminNotSuperUser = await client.user.create({ data: { email: EMAIL_ADMIN_NOT_SUPER, password_hash } });
  noRoleId = noRoleUser.id;
  adminNotSuperId = adminNotSuperUser.id;

  await client.roleAssignment.create({
    data: { user_id: adminNotSuperId, role: "admin", scope_type: "organization", scope_id: ORG_ATTRIBUTION },
  });
  // "admin" is in the default MFA_REQUIRED_ROLES - validateSession rejects a FULL-stage session
  // for that role without a confirmed TOTP method (assertFullSessionMfaPolicy), independent of
  // the admin-access-middleware gate this test targets. Enroll one so the session under test
  // reaches that gate at all.
  await client.userMfaMethod.create({
    data: {
      user_id: adminNotSuperId,
      type: "totp",
      secret_enc: encryptTotpSecret(generateTotpSecret()),
      confirmed_at: new Date(),
    },
  });
}

beforeAll(async () => {
  prisma = createTestPrismaClient();
  await seed(prisma);

  app = createApp({
    prisma,
    baseUrl: "https://admitto.example.com",
    rateLimitStore: new InMemoryRateLimitStore(),
    skipCheckinBootValidation: true,
    adminDistRoot,
    mailDeliveryDeps: { exportSink: () => {} },
    logHttpRequests: true,
  });
});

beforeEach(() => {
  resetSystemLogBufferForTest();
});

afterAll(async () => {
  await prisma?.$disconnect();
});

/** A denied/redirected admin request is still a known, verified staff identity - the gates must
 * attach `auth` to the request context before returning 403 (not only on the success path), so
 * request-log's IP attribution (apps/web/src/request-log.ts) still fires for exactly the requests
 * most useful for investigating unauthorized access attempts. Covers both shared gates: staff-
 * admin-gate.ts's forbiddenNoAdminAccess and admin-access-middleware.ts's sessionSuperadminGate. */
describe("access-denied admin requests keep IP attribution", () => {
  it("staffAdminGate: 403 for a session with no admin/operator role still logs the request's IP", async () => {
    const session = await createSession(prisma, { userId: noRoleId, stage: SESSION_STAGE.FULL });
    const res = await app.request("/api/admin/events", {
      headers: { Cookie: `admitto_session=${session.rawToken}` },
    });
    expect(res.status).toBe(403);

    const entry = querySystemLogs({ source: "api" }).find(
      (e) => e.message === "http_request" && e.fields?.["path"] === "/api/admin/events",
    );
    expect(entry).toBeTruthy();
    expect(typeof entry?.fields?.["ip"]).toBe("string");

    await prisma.session.delete({ where: { id: session.session.id } });
  });

  it("admin-access-middleware: 403 for a non-superadmin on a superadmin-only route still logs the request's IP", async () => {
    const session = await createSession(prisma, { userId: adminNotSuperId, stage: SESSION_STAGE.FULL });
    const res = await app.request("/api/admin/identity/providers", {
      headers: { Cookie: `admitto_session=${session.rawToken}` },
    });
    expect(res.status).toBe(403);

    const entry = querySystemLogs({ source: "api" }).find(
      (e) => e.message === "http_request" && e.fields?.["path"] === "/api/admin/identity/providers",
    );
    expect(entry).toBeTruthy();
    expect(typeof entry?.fields?.["ip"]).toBe("string");

    await prisma.session.delete({ where: { id: session.session.id } });
  });
});
