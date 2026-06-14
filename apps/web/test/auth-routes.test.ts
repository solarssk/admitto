import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "@admitto/auth";
import { createApp } from "../src/app.js";
import { createRateLimitStore } from "../src/rate-limit/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_ROOT = path.resolve(__dirname, "..", "..", "..", "packages", "db");
const CHECKIN_TOKEN = "test-checkin-token-for-vitest-32chars!";
const EVENT_ID = "event-web-auth";
const ORG_ID = "org_default";

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

beforeAll(async () => {
  execSync("npx prisma db push --force-reset --accept-data-loss", {
    cwd: DB_ROOT,
    env: { ...process.env },
    stdio: "pipe",
  });

  prisma = new PrismaClient();
  const password_hash = await hashPassword("login-pass-123");

  await prisma.organization.upsert({
    where: { id: ORG_ID },
    create: { id: ORG_ID, name: "Default", slug: "default" },
    update: {},
  });

  await prisma.event.create({
    data: {
      id: EVENT_ID,
      title: "Web Auth Event",
      slug: "web-auth-event",
      date: new Date("2026-09-01T09:00:00Z"),
      organization_id: ORG_ID,
    },
  });

  const operator = await prisma.user.create({
    data: { email: "operator@example.com", password_hash },
  });

  await prisma.roleAssignment.create({
    data: {
      user_id: operator.id,
      role: "operator",
      scope_type: "event",
      scope_id: EVENT_ID,
    },
  });

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
  await prisma.$disconnect();
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
      body: jsonLoginBody("operator@example.com", "login-pass-123"),
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
      body: jsonLoginBody("nobody@example.com", "login-pass-123"),
    });
    const wrongPass = await app.request("/api/auth/login", {
      method: "POST",
      headers: loginHeaders(),
      body: jsonLoginBody("operator@example.com", "wrong"),
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
      body: jsonLoginBody("operator@example.com", "login-pass-123"),
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
    const body = jsonLoginBody("operator@example.com", "login-pass-123");

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
      body: jsonLoginBody("operator@example.com", "login-pass-123"),
    });
    const cookie = sessionCookie(loginRes);
    const res = await app.request("/api/auth/me", {
      headers: { Cookie: cookie! },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { user: { email: string }; assignments: unknown[] };
    expect(json.user.email).toBe("operator@example.com");
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
      body: jsonLoginBody("operator@example.com", "login-pass-123"),
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
      body: jsonLoginBody("operator@example.com", "login-pass-123"),
    });
    expect(loginRes.status).toBe(200);
    const cookie = sessionCookie(loginRes)!;
    const res = await app.request(`/api/checkin/history?eventId=${EVENT_ID}`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
  });
});
