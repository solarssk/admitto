import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { hashPassword, createSession } from "@admitto/auth";
import { generateToken } from "@admitto/tickets";
import { createApp } from "../src/app.js";
import { createRateLimitStore } from "../src/rate-limit/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_ROOT = path.resolve(__dirname, "..", "..", "..", "packages", "db");
const ORG_ID = "org-login-html";
const EVENT_ID = "evt-login-html";

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let operatorId: string;

beforeAll(async () => {
  execSync("npx prisma db push --force-reset --accept-data-loss", {
    cwd: DB_ROOT,
    env: { ...process.env },
    stdio: "pipe",
  });

  prisma = new PrismaClient();
  const password_hash = await hashPassword("op-pass-123");

  await prisma.organization.create({
    data: { id: ORG_ID, name: "Org", slug: "login-org" },
  });
  await prisma.event.create({
    data: {
      id: EVENT_ID,
      title: "Login Test Event",
      slug: "login-test-event",
      date: new Date("2026-09-01"),
      organization_id: ORG_ID,
    },
  });

  const operator = await prisma.user.create({
    data: { email: "operator@example.com", password_hash },
  });
  operatorId = operator.id;

  await prisma.roleAssignment.create({
    data: {
      user_id: operatorId,
      role: "operator",
      scope_type: "event",
      scope_id: EVENT_ID,
    },
  });

  app = createApp({
    prisma,
    checkinToken: null,
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
  return line?.split(";")[0];
}

/** Hono `app.request()` uses `http://localhost` as the request URL. */
const sameOrigin = { Origin: "http://localhost" };

describe("GET /login", () => {
  it("renders login form", async () => {
    const res = await app.request("/login");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('name="email"');
    expect(html).toContain('name="password"');
    expect(html).toContain("device_label");
    expect(html).toContain("coming soon");
  });
});

describe("POST /login", () => {
  it("success sets cookie and redirects to /operator", async () => {
    const res = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...sameOrigin },
      body: new URLSearchParams({
        email: "operator@example.com",
        password: "op-pass-123",
        device_label: "Tablet 1",
      }).toString(),
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/operator");
    expect(sessionCookie(res)).toMatch(/^admitto_session=/);
  });

  it("wrong password shows uniform error", async () => {
    const res = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...sameOrigin },
      body: new URLSearchParams({
        email: "operator@example.com",
        password: "wrong",
      }).toString(),
    });
    expect(res.status).toBe(401);
    const html = await res.text();
    expect(html).toContain("Invalid email or password");
    expect(sessionCookie(res)).toBeUndefined();
  });

  it("persists device_label on session", async () => {
    const email = "device@example.com";
    const password_hash = await hashPassword("x");
    const user = await prisma.user.create({
      data: { email, password_hash },
    });
    await prisma.roleAssignment.create({
      data: { user_id: user.id, role: "operator", scope_type: "event", scope_id: EVENT_ID },
    });

    const res = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...sameOrigin },
      body: new URLSearchParams({
        email,
        password: "x",
        device_label: "Tablet 2 — side entrance",
      }).toString(),
    });
    expect(res.status).toBe(302);
    const cookie = sessionCookie(res)!;
    const meRes = await app.request("/api/auth/me", { headers: { Cookie: cookie } });
    expect(meRes.status).toBe(200);

    const sessions = await prisma.session.findMany({
      where: { user_id: user.id },
      orderBy: { created_at: "desc" },
      take: 1,
    });
    expect(sessions[0]?.device_label).toBe("Tablet 2 — side entrance");
  });

  it("rejects cross-site POST without same-origin headers", async () => {
    const res = await app.request("/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://evil.example",
      },
      body: new URLSearchParams({
        email: "operator@example.com",
        password: "op-pass-123",
      }).toString(),
    });
    expect(res.status).toBe(403);
    expect(sessionCookie(res)).toBeUndefined();
  });

  it("rejects HTTP Origin when request is HTTPS (cross-scheme CSRF)", async () => {
    const res = await app.request("https://localhost/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "http://localhost",
      },
      body: new URLSearchParams({
        email: "operator@example.com",
        password: "op-pass-123",
      }).toString(),
    });
    expect(res.status).toBe(403);
    expect(sessionCookie(res)).toBeUndefined();
  });

  it("cross-origin POST 403 does not consume IP login rate limit", async () => {
    const limitedApp = createApp({
      prisma,
      checkinToken: null,
      allowCheckinBearer: false,
      baseUrl: "https://tickets.example.com",
      rateLimitStore: createRateLimitStore(),
      skipCheckinBootValidation: true,
    });
    const evil = { Origin: "https://evil.example" };
    const body = new URLSearchParams({
      email: "operator@example.com",
      password: "op-pass-123",
    }).toString();

    for (let i = 0; i < 10; i++) {
      const res = await limitedApp.request("/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", ...evil },
        body,
      });
      expect(res.status).toBe(403);
    }

    const ok = await limitedApp.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...sameOrigin },
      body,
    });
    expect(ok.status).toBe(302);
    expect(ok.headers.get("location")).toBe("/operator");
  });

  it("returns plain text 429 when IP login rate limit exceeded", async () => {
    const limitedApp = createApp({
      prisma,
      checkinToken: null,
      allowCheckinBearer: false,
      baseUrl: "https://tickets.example.com",
      rateLimitStore: createRateLimitStore(),
      skipCheckinBootValidation: true,
    });
    const body = new URLSearchParams({
      email: "operator@example.com",
      password: "wrong-password",
    }).toString();

    for (let i = 0; i < 10; i++) {
      const res = await limitedApp.request("/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", ...sameOrigin },
        body,
      });
      expect(res.status).toBe(401);
    }

    const blocked = await limitedApp.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...sameOrigin },
      body,
    });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("content-type")).toContain("text/plain");
    expect(await blocked.text()).toBe("Too many requests");
  });
});

describe("GET /operator", () => {
  it("redirects to /login without session", async () => {
    const res = await app.request("/operator");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
  });

  it("shows signed-in landing with events", async () => {
    const { rawToken } = await createSession(prisma, { userId: operatorId });
    const res = await app.request("/operator", {
      headers: { Cookie: `admitto_session=${rawToken}` },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Signed in");
    expect(html).toContain("operator@example.com");
    expect(html).toContain("Login Test Event");
  });
});

describe("POST /logout", () => {
  it("clears session and redirects", async () => {
    const { rawToken } = await createSession(prisma, { userId: operatorId });
    const cookie = `admitto_session=${rawToken}`;
    const res = await app.request("/logout", {
      method: "POST",
      headers: { Cookie: cookie, ...sameOrigin },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
    const meRes = await app.request("/api/auth/me", { headers: { Cookie: cookie } });
    expect(meRes.status).toBe(401);
  });

  it("rejects cross-site POST", async () => {
    const { rawToken } = await createSession(prisma, { userId: operatorId });
    const res = await app.request("/logout", {
      method: "POST",
      headers: {
        Cookie: `admitto_session=${rawToken}`,
        Origin: "https://evil.example",
      },
    });
    expect(res.status).toBe(403);
  });
});
