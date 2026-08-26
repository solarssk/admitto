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

const EMAIL_SUPER = "external-services-super@example.com";
const PASSWORD = "external-services-test-pass-123";

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let rateLimitStore: InMemoryRateLimitStore;
let superId: string;
let superCookie = "";

async function seed(client: PrismaClient) {
  await client.session.deleteMany({ where: { user: { email: EMAIL_SUPER } } });
  await client.userMfaMethod.deleteMany({ where: { user: { email: EMAIL_SUPER } } });
  await client.roleAssignment.deleteMany({ where: { user: { email: EMAIL_SUPER } } });
  await client.user.deleteMany({ where: { email: EMAIL_SUPER } });

  const password_hash = await hashPassword(PASSWORD);
  const superUser = await client.user.create({ data: { email: EMAIL_SUPER, password_hash } });
  await client.roleAssignment.create({
    data: { user_id: superUser.id, role: "superadmin", scope_type: "instance", scope_id: null },
  });
  // Superadmin is an MFA-required role - a FULL session without a confirmed method fails
  // validateSession's MFA policy check and looks unauthenticated, not just unauthorized.
  await client.userMfaMethod.create({
    data: {
      user_id: superUser.id,
      type: "totp",
      secret_enc: encryptTotpSecret(generateTotpSecret()),
      confirmed_at: new Date(),
    },
  });
  return { superId: superUser.id };
}

function weatherTest(cookie: string | null, body: unknown) {
  return app.request("/api/admin/external-services/weather/test", {
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
  const { superId: seededSuperId } = await seed(prisma);
  superId = seededSuperId;

  rateLimitStore = new InMemoryRateLimitStore();
  app = createApp({
    prisma,
    baseUrl: "https://tickets.example.com",
    rateLimitStore,
    skipCheckinBootValidation: true,
    adminDistRoot,
  });

  const session = await createSession(prisma, { userId: superId, stage: SESSION_STAGE.FULL });
  superCookie = `admitto_session=${session.rawToken}`;
});

afterAll(async () => {
  await prisma.session.deleteMany({ where: { user_id: superId } });
  await prisma.userMfaMethod.deleteMany({ where: { user_id: superId } });
  await prisma.roleAssignment.deleteMany({ where: { user_id: superId } });
  await prisma.user.deleteMany({ where: { id: superId } });
  await prisma?.$disconnect();
});

beforeEach(() => {
  rateLimitStore.reset();
});

describe("POST /api/admin/external-services/weather/test", () => {
  it("returns 429 once the per-user 5/min limit is exhausted", async () => {
    const userKey = `admin:weather-test:user:${superId}`;
    for (let i = 0; i < 5; i++) {
      await rateLimitStore.hit(userKey, 60_000, 5);
    }

    // metno ignores baseUrl entirely (hardcoded forecast host), so this never reaches out to the
    // network even if it got past the rate limit - the point here is that it doesn't get past it.
    const res = await weatherTest(superCookie, { provider: "metno" });
    expect(res.status).toBe(429);
  });
});
