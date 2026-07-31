import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { createSession, hashPassword, SESSION_STAGE } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { emitSystemLog, resetSystemLogBufferForTest } from "@admitto/shared/system-log";
import { createApp } from "../../src/app.js";
import { InMemoryRateLimitStore } from "../../src/rate-limit/in-memory.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");

const EMAIL_SUPER = "system-log-super@example.com";
const EMAIL_ADMIN = "system-log-admin@example.com";
const PASSWORD = "system-log-pass-123";

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let rateLimitStore: InMemoryRateLimitStore;

let superId: string;
let adminId: string;
let superCookie = "";

/** Seed a superadmin and a non-superadmin admin, no org/event/audit-log fixtures needed - the
 * system-log buffer this route reads is in-memory, not backed by any table. */
async function seed(client: PrismaClient) {
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

  const password_hash = await hashPassword(PASSWORD);
  const superUser = await client.user.create({ data: { email: EMAIL_SUPER, password_hash } });
  const adminUser = await client.user.create({ data: { email: EMAIL_ADMIN, password_hash } });
  superId = superUser.id;
  adminId = adminUser.id;

  await client.roleAssignment.create({
    data: { user_id: superId, role: "superadmin", scope_type: "instance", scope_id: null },
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
    // Explicit, not relying on the env-var default, so the dual-sink test below is
    // deterministic regardless of how LOG_HTTP_REQUESTS happens to be set in this environment.
    logHttpRequests: true,
  });

  const superSession = await createSession(prisma, {
    userId: superId,
    stage: SESSION_STAGE.FULL,
    ip: "127.0.0.1",
  });
  superCookie = `admitto_session=${superSession.rawToken}`;
});

afterEach(() => {
  resetSystemLogBufferForTest();
});

afterAll(async () => {
  await prisma?.$disconnect();
});

describe("GET /api/admin/system-logs", () => {
  it("returns 401 without auth", async () => {
    const res = await app.request("/api/admin/system-logs");
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-superadmin admin", async () => {
    const adminSession = await createSession(prisma, {
      userId: adminId,
      stage: SESSION_STAGE.FULL,
    });
    const res = await app.request("/api/admin/system-logs", {
      headers: { Cookie: `admitto_session=${adminSession.rawToken}` },
    });
    expect(res.status).toBe(403);
    await prisma.session.delete({ where: { id: adminSession.session.id } });
  });

  it("returns an empty list and cursor 0 when nothing has been logged yet", async () => {
    const res = await app.request("/api/admin/system-logs", { headers: { Cookie: superCookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: unknown[]; cursor: number };
    expect(body.entries).toEqual([]);
    expect(body.cursor).toBe(0);
  });

  it("returns pushed entries in order with an advancing cursor", async () => {
    emitSystemLog("mail", "info", "mail_sent", { provider: "smtp" });
    emitSystemLog("db", "warn", "slow_query", { duration_ms: 250 });

    const res = await app.request("/api/admin/system-logs", { headers: { Cookie: superCookie } });
    const body = (await res.json()) as {
      entries: { id: number; message: string; source: string; level: string }[];
      cursor: number;
    };
    expect(body.entries.map((e) => e.message)).toEqual(["mail_sent", "slow_query"]);
    expect(body.cursor).toBe(body.entries[1]!.id);
  });

  it("filters by since, returning only entries newer than the given cursor", async () => {
    // Note: hitting /api/admin/system-logs itself also produces an "http_request" entry via
    // the same dual-sink middleware (recorded after the response body is built, so it never
    // appears in that same call's own response) - assert by path rather than a raw count so
    // this incidental self-logging can't make the test flaky.
    emitSystemLog("api", "info", "http_request", { path: "/api/admin/me" });
    const firstRes = await app.request("/api/admin/system-logs", { headers: { Cookie: superCookie } });
    const firstBody = (await firstRes.json()) as { cursor: number };

    emitSystemLog("api", "info", "http_request", { path: "/api/admin/events" });

    const res = await app.request(`/api/admin/system-logs?since=${firstBody.cursor}`, {
      headers: { Cookie: superCookie },
    });
    const body = (await res.json()) as { entries: { fields?: Record<string, unknown> }[] };
    expect(body.entries.some((e) => e.fields?.path === "/api/admin/events")).toBe(true);
    expect(body.entries.some((e) => e.fields?.path === "/api/admin/me")).toBe(false);
  });

  it("filters by level and source, individually and combined", async () => {
    emitSystemLog("cache", "warn", "redis unavailable");
    emitSystemLog("cache", "error", "redis unavailable");
    emitSystemLog("db", "warn", "slow query");

    const byLevel = await app.request("/api/admin/system-logs?level=warn", {
      headers: { Cookie: superCookie },
    });
    const byLevelBody = (await byLevel.json()) as { entries: { source: string }[] };
    expect(byLevelBody.entries.map((e) => e.source).sort()).toEqual(["cache", "db"]);

    const bySource = await app.request("/api/admin/system-logs?source=cache", {
      headers: { Cookie: superCookie },
    });
    const bySourceBody = (await bySource.json()) as { entries: { level: string }[] };
    expect(bySourceBody.entries.map((e) => e.level).sort()).toEqual(["error", "warn"]);

    const combined = await app.request("/api/admin/system-logs?level=warn&source=cache", {
      headers: { Cookie: superCookie },
    });
    const combinedBody = (await combined.json()) as { entries: unknown[] };
    expect(combinedBody.entries).toHaveLength(1);
  });

  it("filters by a case-insensitive search substring", async () => {
    emitSystemLog("mail", "info", "SMTP connected to smtp.example.com:587");
    emitSystemLog("mail", "info", "mail sent");

    const res = await app.request("/api/admin/system-logs?search=smtp", {
      headers: { Cookie: superCookie },
    });
    const body = (await res.json()) as { entries: { message: string }[] };
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]?.message).toMatch(/SMTP connected/);
  });

  it("ignores unrecognized level/source values instead of erroring", async () => {
    emitSystemLog("api", "info", "http_request");

    const res = await app.request("/api/admin/system-logs?level=bogus&source=bogus", {
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: unknown[] };
    expect(body.entries).toHaveLength(1);
  });

  it("proves the dual-sink promise: a real HTTP request through the app produces a queryable api entry", async () => {
    await app.request("/api/admin/me", { headers: { Cookie: superCookie } });

    const res = await app.request("/api/admin/system-logs?source=api", {
      headers: { Cookie: superCookie },
    });
    const body = (await res.json()) as { entries: { message: string; fields?: Record<string, unknown> }[] };
    const httpRequestEntry = body.entries.find((e) => e.message === "http_request");
    expect(httpRequestEntry).toBeTruthy();
    expect(httpRequestEntry?.fields?.path).toBe("/api/admin/me");
  });
});
