import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { hashPassword } from "@admitto/auth";
import { createApp } from "../../src/app.js";
import { createRateLimitStore } from "../../src/rate-limit/index.js";

const CHECKIN_TOKEN = "test-checkin-token-for-vitest-32chars!";
const EVENT_ID = "event-web-auth-routes";
const ORG_ID = "org-web-auth-routes";
const OPERATOR_EMAIL = "auth-routes-operator@example.com";
const OPERATOR_PASSWORD = "login-pass-123";

/** Hono `app.request()` uses `http://localhost` as the request URL. */
const sameOrigin = { Origin: "http://localhost" };

function jsonLoginBody(email: string, password: string): string {
  return JSON.stringify({ email, password });
}

function loginHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { "Content-Type": "application/json", ...sameOrigin, ...extra };
}

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;

/** Seed fixture — schema from integration globalSetup (`migrate deploy`). */
async function seedAuthRoutesFixture(client: PrismaClient): Promise<void> {
  await client.roleAssignment.deleteMany({
    where: { OR: [{ scope_id: EVENT_ID }, { user: { email: OPERATOR_EMAIL } }] },
  });
  await client.session.deleteMany({ where: { user: { email: OPERATOR_EMAIL } } });
  await client.user.deleteMany({ where: { email: OPERATOR_EMAIL } });
  await client.event.deleteMany({ where: { id: EVENT_ID } });
  await client.organization.deleteMany({ where: { id: ORG_ID } });

  const password_hash = await hashPassword(OPERATOR_PASSWORD);

  await client.organization.create({
    data: { id: ORG_ID, name: "Auth Routes Test Org", slug: "web-auth-routes-org" },
  });

  await client.event.create({
    data: {
      id: EVENT_ID,
      title: "Web Auth Event",
      slug: "web-auth-routes-event",
      date: new Date("2026-09-01T09:00:00Z"),
      organization_id: ORG_ID,
    },
  });

  const operator = await client.user.create({
    data: { email: OPERATOR_EMAIL, password_hash },
  });

  await client.roleAssignment.create({
    data: {
      user_id: operator.id,
      role: "operator",
      scope_type: "event",
      scope_id: EVENT_ID,
    },
  });
}

beforeAll(async () => {
  prisma = createTestPrismaClient();
  await seedAuthRoutesFixture(prisma);

  app = createApp({
    prisma,
    checkinToken: CHECKIN_TOKEN,
    allowCheckinBearer: false,
    baseUrl: "https://tickets.example.com",
    rateLimitStore: createRateLimitStore(),
    skipCheckinBootValidation: true,
  });
});

afterAll(async () => {
  await prisma?.$disconnect();
});

function sessionCookie(res: Response): string | undefined {
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const line = setCookie.find((c) => c.startsWith("admitto_session="));
  if (!line) return undefined;
  return line.split(";")[0];
}

function hasHttpOnlySessionCookie(res: Response): boolean {
  const setCookie = res.headers.getSetCookie?.() ?? [];
  return setCookie.some(
    (line) => line.startsWith("admitto_session=") && line.toLowerCase().includes("httponly"),
  );
}

describe("POST /api/auth/login", () => {
  it("returns session cookie on success", async () => {
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: loginHeaders(),
      body: jsonLoginBody(OPERATOR_EMAIL, OPERATOR_PASSWORD),
    });
    expect(res.status).toBe(200);
    const cookie = sessionCookie(res);
    expect(cookie).toMatch(/^admitto_session=/);
    expect(hasHttpOnlySessionCookie(res)).toBe(true);
  });

  it("returns uniform 401 for wrong email and wrong password", async () => {
    const wrongEmail = await app.request("/api/auth/login", {
      method: "POST",
      headers: loginHeaders(),
      body: jsonLoginBody("nobody@example.com", OPERATOR_PASSWORD),
    });
    const wrongPass = await app.request("/api/auth/login", {
      method: "POST",
      headers: loginHeaders(),
      body: jsonLoginBody(OPERATOR_EMAIL, "wrong"),
    });
    expect(wrongEmail.status).toBe(401);
    expect(wrongPass.status).toBe(401);
    expect(await wrongEmail.json()).toEqual(await wrongPass.json());
  });

  it("rejects cross-site POST without same-origin headers", async () => {
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://evil.example",
      },
      body: jsonLoginBody(OPERATOR_EMAIL, OPERATOR_PASSWORD),
    });
    expect(res.status).toBe(403);
    expect(sessionCookie(res)).toBeUndefined();
  });

  it("cross-origin POST 403 does not consume IP login rate limit", async () => {
    const limitedApp = createApp({
      prisma,
      checkinToken: CHECKIN_TOKEN,
      allowCheckinBearer: false,
      baseUrl: "https://tickets.example.com",
      rateLimitStore: createRateLimitStore(),
      skipCheckinBootValidation: true,
    });
    const evil = { Origin: "https://evil.example" };
    const body = jsonLoginBody(OPERATOR_EMAIL, OPERATOR_PASSWORD);

    for (let i = 0; i < 10; i++) {
      const res = await limitedApp.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...evil },
        body,
      });
      expect(res.status).toBe(403);
    }

    const ok = await limitedApp.request("/api/auth/login", {
      method: "POST",
      headers: loginHeaders(),
      body,
    });
    expect(ok.status).toBe(200);
  });
});

describe("GET /api/auth/me", () => {
  it("returns user and assignments with session", async () => {
    const loginRes = await app.request("/api/auth/login", {
      method: "POST",
      headers: loginHeaders(),
      body: jsonLoginBody(OPERATOR_EMAIL, OPERATOR_PASSWORD),
    });
    const cookie = sessionCookie(loginRes);
    const res = await app.request("/api/auth/me", {
      headers: { Cookie: cookie! },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      user: { email: string; preferred_locale: string | null; preferred_time_format: string | null };
      assignments: unknown[];
    };
    expect(json.user.email).toBe(OPERATOR_EMAIL);
    expect(json.user).toHaveProperty("preferred_locale");
    expect(json.user.preferred_locale).toBeNull();
    expect(json.user.preferred_time_format).toBeNull();
    expect(json.assignments.length).toBeGreaterThan(0);
  });

  it("returns 401 without session", async () => {
    const res = await app.request("/api/auth/me");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/auth/logout", () => {
  it("revokes session and clears cookie", async () => {
    const loginRes = await app.request("/api/auth/login", {
      method: "POST",
      headers: loginHeaders(),
      body: jsonLoginBody(OPERATOR_EMAIL, OPERATOR_PASSWORD),
    });
    const cookie = sessionCookie(loginRes)!;
    const logoutRes = await app.request("/api/auth/logout", {
      method: "POST",
      headers: { Cookie: cookie, ...sameOrigin },
    });
    expect(logoutRes.status).toBe(200);
    const meRes = await app.request("/api/auth/me", { headers: { Cookie: cookie } });
    expect(meRes.status).toBe(401);
  });
});

describe("check-in session auth E2E", () => {
  it("login → cookie → history without Bearer", async () => {
    const loginRes = await app.request("/api/auth/login", {
      method: "POST",
      headers: loginHeaders(),
      body: jsonLoginBody(OPERATOR_EMAIL, OPERATOR_PASSWORD),
    });
    expect(loginRes.status).toBe(200);
    const cookie = sessionCookie(loginRes)!;
    const res = await app.request(`/api/checkin/history?eventId=${EVENT_ID}`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
  });
});
