import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { hashPassword, SETTING_SETUP_COMPLETE } from "@admitto/auth";
import { createApp } from "../../src/app.js";
import { createRateLimitStore } from "../../src/rate-limit/index.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const FIXTURE_EMAIL = "setup-gate@example.com";
const SETUP_EMAIL = "first-run@example.com";
const SETUP_PASSWORD = "setup-pass-12345";
/** Deliberately not password-shaped — gitleaks flags `confirm_password: "...pass..."` literals. */
const MISMATCH_CONFIRM = "not-the-same-value";

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;

async function clearAllUsers(client: PrismaClient): Promise<void> {
  await client.session.deleteMany({});
  await client.roleAssignment.deleteMany({});
  await client.userMfaMethod.deleteMany({});
  await client.user.deleteMany({});
  await client.systemSettings.deleteMany({ where: { key: SETTING_SETUP_COMPLETE } });
}

async function seedGateUser(client: PrismaClient): Promise<void> {
  const password_hash = await hashPassword("gate-pass-12345");
  const user = await client.user.create({
    data: { email: FIXTURE_EMAIL, password_hash },
  });
  await client.roleAssignment.create({
    data: {
      user_id: user.id,
      role: "superadmin",
      scope_type: "instance",
      scope_id: null,
    },
  });
}

beforeAll(async () => {
  prisma = new PrismaClient();
  app = createApp({
    prisma,
    checkinToken: null,
    allowCheckinBearer: false,
    baseUrl: "https://tickets.example.com",
    rateLimitStore: createRateLimitStore(),
    skipCheckinBootValidation: true,
    adminDistRoot,
  });
});

afterAll(async () => {
  await clearAllUsers(prisma);
  await prisma?.$disconnect();
});

const sameOrigin = { Origin: "http://localhost" };

function sessionCookie(res: Response): string | undefined {
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const line = setCookie.find((c) => c.startsWith("admitto_session="));
  return line?.split(";")[0];
}

describe("GET /setup", () => {
  beforeEach(async () => {
    await clearAllUsers(prisma);
  });

  it("renders setup form on empty database", async () => {
    const res = await app.request("/setup");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('action="/setup"');
    expect(html).toContain('name="confirm_password"');
    expect(html).toContain("Initial setup");
    expect(html).not.toContain("<script");
  });

  it("redirects to /login when users exist", async () => {
    await seedGateUser(prisma);
    const res = await app.request("/setup", { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/login");
  });
});

describe("POST /setup", () => {
  beforeEach(async () => {
    await clearAllUsers(prisma);
  });

  it("returns 403 without same-origin CSRF signal", async () => {
    const res = await app.request("/setup", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        email: SETUP_EMAIL,
        password: SETUP_PASSWORD,
        confirm_password: SETUP_PASSWORD,
      }).toString(),
    });
    expect(res.status).toBe(403);
  });

  it("re-renders validation errors with preserved email", async () => {
    const res = await app.request("/setup", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...sameOrigin,
      },
      body: new URLSearchParams({
        email: SETUP_EMAIL,
        password: "short",
        confirm_password: "short",
        display_name: "Admin",
      }).toString(),
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("at least 12 characters");
    expect(html).toContain(SETUP_EMAIL);
  });

  it("re-renders password mismatch", async () => {
    const res = await app.request("/setup", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...sameOrigin,
      },
      body: new URLSearchParams({
        email: SETUP_EMAIL,
        password: SETUP_PASSWORD,
        confirm_password: MISMATCH_CONFIRM,
      }).toString(),
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("do not match");
  });

  it("creates superadmin, sets setup_complete false, session cookie, redirects MFA enroll", async () => {
    const res = await app.request("/setup", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...sameOrigin,
      },
      body: new URLSearchParams({
        email: SETUP_EMAIL,
        password: SETUP_PASSWORD,
        confirm_password: SETUP_PASSWORD,
        display_name: "First Admin",
      }).toString(),
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/mfa/enroll");
    expect(sessionCookie(res)).toMatch(/^admitto_session=/);

    const user = await prisma.user.findUnique({ where: { email: SETUP_EMAIL } });
    expect(user).not.toBeNull();
    expect(user?.display_name).toBe("First Admin");

    const role = await prisma.roleAssignment.findFirst({
      where: { user_id: user!.id, role: "superadmin", scope_type: "instance" },
    });
    expect(role).not.toBeNull();

    const setting = await prisma.systemSettings.findUnique({
      where: { key: SETTING_SETUP_COMPLETE },
    });
    expect(setting?.value_json).toBe("false");
  });

  it("returns 409 already_initialized when concurrent first-run setup races", async () => {
    const postSetup = (email: string) =>
      app.request("/setup", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          ...sameOrigin,
        },
        body: new URLSearchParams({
          email,
          password: SETUP_PASSWORD,
          confirm_password: SETUP_PASSWORD,
        }).toString(),
      });

    const [resA, resB] = await Promise.all([
      postSetup("race-a@example.com"),
      postSetup("race-b@example.com"),
    ]);

    const statuses = [resA.status, resB.status].sort((a, b) => a - b);
    expect(statuses).toEqual([302, 409]);

    const loser = resA.status === 409 ? resA : resB;
    const body = (await loser.json()) as { code: string };
    expect(body.code).toBe("already_initialized");
    expect(await prisma.user.count()).toBe(1);
  });

  it("returns 409 when database already initialized", async () => {
    await seedGateUser(prisma);
    const res = await app.request("/setup", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...sameOrigin,
      },
      body: new URLSearchParams({
        email: "other@example.com",
        password: SETUP_PASSWORD,
        confirm_password: SETUP_PASSWORD,
      }).toString(),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("already_initialized");
  });
});

describe("first-run staff entry redirect", () => {
  beforeEach(async () => {
    await clearAllUsers(prisma);
  });

  it("redirects GET /login to /setup when database is empty", async () => {
    const res = await app.request("/login", { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/setup");
  });

  it("redirects POST /login to /setup when database is empty", async () => {
    const res = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...sameOrigin },
      body: new URLSearchParams({
        email: "nobody@example.com",
        password: "wrong-password",
      }).toString(),
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/setup");
  });

  it("redirects GET / to /setup when database is empty", async () => {
    const res = await app.request("/", { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/setup");
  });

  it("redirects GET /operator to /setup when database is empty", async () => {
    const res = await app.request("/operator", { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/setup");
  });

  it("redirects GET /admin to /setup when database is empty", async () => {
    const res = await app.request("/admin", { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/setup");
  });
});
