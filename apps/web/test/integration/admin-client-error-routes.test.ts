import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { createSession, hashPassword, SESSION_STAGE } from "@admitto/auth";
import { createApp } from "../../src/app.js";
import { InMemoryRateLimitStore } from "../../src/rate-limit/in-memory.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };

const EMAIL_ADMIN = "client-error-admin@example.com";
const PASSWORD = "client-error-test-pass-123";

const VALID_PAYLOAD = {
  source: "csp-violation",
  name: "Error",
  message: "connect-src blocked https://admitto.example.com/api/admin/client-errors",
  path: "/admin",
};

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let rateLimitStore: InMemoryRateLimitStore;
let adminId: string;
let adminCookie = "";

async function seed(client: PrismaClient) {
  await client.session.deleteMany({ where: { user: { email: EMAIL_ADMIN } } });
  await client.user.deleteMany({ where: { email: EMAIL_ADMIN } });

  const password_hash = await hashPassword(PASSWORD);
  const adminUser = await client.user.create({ data: { email: EMAIL_ADMIN, password_hash } });
  return { adminId: adminUser.id };
}

function postClientError(cookie: string | null, body: unknown) {
  return app.request("/api/admin/client-errors", {
    method: "POST",
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      "Content-Type": "application/json",
      ...sameOrigin,
    },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  prisma = createTestPrismaClient();
  const { adminId: seededAdminId } = await seed(prisma);
  adminId = seededAdminId;

  rateLimitStore = new InMemoryRateLimitStore();
  app = createApp({
    prisma,
    baseUrl: "https://tickets.example.com",
    rateLimitStore,
    skipCheckinBootValidation: true,
    adminDistRoot,
  });

  const session = await createSession(prisma, { userId: adminId, stage: SESSION_STAGE.FULL });
  adminCookie = `admitto_session=${session.rawToken}`;
});

afterAll(async () => {
  await prisma?.$disconnect();
});

beforeEach(() => {
  rateLimitStore.reset();
});

describe("POST /api/admin/client-errors", () => {
  it("returns 401 for an unauthenticated request", async () => {
    const res = await postClientError(null, VALID_PAYLOAD);
    expect(res.status).toBe(401);
  });

  it("returns 400 for an invalid payload", async () => {
    const res = await postClientError(adminCookie, { source: "csp-violation" });
    expect(res.status).toBe(400);
  });

  it("accepts a valid report from an authenticated session", async () => {
    const res = await postClientError(adminCookie, VALID_PAYLOAD);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  describe("rate limiting", () => {
    it("returns 429 once the per-user 30/min limit is exhausted", async () => {
      const userKey = `admin:client-error:user:${adminId}`;
      for (let i = 0; i < 30; i++) {
        await rateLimitStore.hit(userKey, 60_000, 30);
      }

      const res = await postClientError(adminCookie, VALID_PAYLOAD);
      expect(res.status).toBe(429);
      expect(await res.json()).toEqual({ error: "too many requests" });
    });
  });
});
