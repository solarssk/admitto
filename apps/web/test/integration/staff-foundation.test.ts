import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createSession, hashPassword, SESSION_STAGE } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { createApp } from "../../src/app.js";
import { createRateLimitStore } from "../../src/rate-limit/index.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };
const CHECKIN_TOKEN = "staff-foundation-checkin-token-32chars!";

const ORG_A = "org-staff-foundation-a";
const ORG_B = "org-staff-foundation-b";
const EVENT_A = "evt-staff-foundation-a";
const EVENT_B = "evt-staff-foundation-b";

const EMAIL_SUPER = "staff-foundation-super@example.com";
const EMAIL_ADMIN = "staff-foundation-admin@example.com";
const EMAIL_OP = "staff-foundation-op@example.com";
const PASSWORD = "staff-pass-123";

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let superId: string;
let adminId: string;
let opId: string;

async function seed(client: PrismaClient) {
  await client.roleAssignment.deleteMany({
    where: { OR: [{ scope_id: { in: [ORG_A, ORG_B, EVENT_A, EVENT_B] } }] },
  });
  await client.session.deleteMany({
    where: { user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN, EMAIL_OP] } } },
  });
  await client.userMfaMethod.deleteMany({
    where: { user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN] } } },
  });
  await client.user.deleteMany({ where: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN, EMAIL_OP] } } });
  await client.event.deleteMany({ where: { id: { in: [EVENT_A, EVENT_B] } } });
  await client.organization.deleteMany({ where: { id: { in: [ORG_A, ORG_B] } } });

  const password_hash = await hashPassword(PASSWORD);

  await client.organization.createMany({
    data: [
      { id: ORG_A, name: "Org A", slug: "staff-foundation-a" },
      { id: ORG_B, name: "Org B", slug: "staff-foundation-b" },
    ],
  });

  await client.event.createMany({
    data: [
      {
        id: EVENT_A,
        title: "Event A",
        slug: "event-a",
        date: new Date("2026-10-01"),
        organization_id: ORG_A,
      },
      {
        id: EVENT_B,
        title: "Event B",
        slug: "event-b",
        date: new Date("2026-11-01"),
        organization_id: ORG_B,
      },
    ],
  });

  const superUser = await client.user.create({ data: { email: EMAIL_SUPER, password_hash } });
  const adminUser = await client.user.create({ data: { email: EMAIL_ADMIN, password_hash } });
  const opUser = await client.user.create({ data: { email: EMAIL_OP, password_hash } });
  superId = superUser.id;
  adminId = adminUser.id;
  opId = opUser.id;

  await client.roleAssignment.createMany({
    data: [
      { user_id: superId, role: "superadmin", scope_type: "instance", scope_id: null },
      { user_id: adminId, role: "admin", scope_type: "organization", scope_id: ORG_A },
      { user_id: opId, role: "operator", scope_type: "event", scope_id: EVENT_A },
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
  prisma = new PrismaClient();
  await seed(prisma);
  app = createApp({
    prisma,
    checkinToken: CHECKIN_TOKEN,
    allowCheckinBearer: true,
    baseUrl: "https://tickets.example.com",
    rateLimitStore: createRateLimitStore(),
    skipCheckinBootValidation: true,
    adminDistRoot,
  });
});

afterAll(async () => {
  await prisma?.$disconnect();
});

async function sessionCookieFor(userId: string): Promise<string> {
  const { rawToken } = await createSession(prisma, { userId, stage: SESSION_STAGE.FULL });
  return `admitto_session=${rawToken}`;
}

describe("GET /api/admin/me", () => {
  it("returns profile for org admin session", async () => {
    const res = await app.request("/api/admin/me", {
      headers: { Cookie: await sessionCookieFor(adminId) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      user: { email: string };
      assignments: unknown[];
      session_active: boolean;
    };
    expect(body.user.email).toBe(EMAIL_ADMIN);
    expect(body.assignments.length).toBeGreaterThan(0);
    expect(body.session_active).toBe(true);
  });

  it("rejects operator session", async () => {
    const res = await app.request("/api/admin/me", {
      headers: { Cookie: await sessionCookieFor(opId) },
    });
    expect(res.status).toBe(403);
  });
});

describe("GET /api/admin/events", () => {
  it("returns 401 without session", async () => {
    const res = await app.request("/api/admin/events");
    expect(res.status).toBe(401);
  });

  it("returns 403 for operator-only", async () => {
    const res = await app.request("/api/admin/events", {
      headers: { Cookie: await sessionCookieFor(opId) },
    });
    expect(res.status).toBe(403);
  });

  it("scopes org admin to their organization", async () => {
    const res = await app.request("/api/admin/events", {
      headers: { Cookie: await sessionCookieFor(adminId) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: Array<{ id: string }> };
    expect(body.events.map((e) => e.id)).toEqual([EVENT_A]);
  });

  it("returns all events for superadmin including fixture events", async () => {
    const res = await app.request("/api/admin/events", {
      headers: { Cookie: await sessionCookieFor(superId) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: Array<{ id: string }> };
    const ids = body.events.map((e) => e.id);
    expect(ids).toContain(EVENT_A);
    expect(ids).toContain(EVENT_B);
  });
});

describe("GET /api/checkin/events", () => {
  it("returns 401 without session even with bearer", async () => {
    const res = await app.request("/api/checkin/events", {
      headers: { Authorization: `Bearer ${CHECKIN_TOKEN}` },
    });
    expect(res.status).toBe(401);
  });

  it("lists check-in events for operator", async () => {
    const res = await app.request("/api/checkin/events", {
      headers: { Cookie: await sessionCookieFor(opId) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: Array<{ id: string }> };
    expect(body.events.map((e) => e.id)).toEqual([EVENT_A]);
  });

  it("lists org events for org admin", async () => {
    const res = await app.request("/api/checkin/events", {
      headers: { Cookie: await sessionCookieFor(adminId) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: Array<{ id: string }> };
    expect(body.events.map((e) => e.id)).toEqual([EVENT_A]);
  });
});

describe("GET /api/staff/theme", () => {
  it("allows operator to read theme via session path", async () => {
    const res = await app.request("/api/staff/theme", {
      headers: { Cookie: await sessionCookieFor(opId) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { theme: object; vars: Record<string, string> };
    expect(body.vars["--primary"]).toBeTruthy();
  });

  it("rejects theme mutation for operator", async () => {
    const res = await app.request("/api/staff/theme", {
      method: "PUT",
      headers: {
        Cookie: await sessionCookieFor(opId),
        "Content-Type": "application/json",
        ...sameOrigin,
      },
      body: JSON.stringify({ primary: "#112233" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("GET /api/admin/theme", () => {
  it("allows org admin via admin API path", async () => {
    const res = await app.request("/api/admin/theme", {
      headers: { Cookie: await sessionCookieFor(adminId) },
    });
    expect(res.status).toBe(200);
  });
});

describe("staff SPA routes", () => {
  it("serves admin SPA for org admin", async () => {
    const res = await app.request("/admin", {
      headers: { Cookie: await sessionCookieFor(adminId) },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("staff-spa-fixture");
  });

  it("redirects operator-only away from /admin", async () => {
    const res = await app.request("/admin", {
      headers: { Cookie: await sessionCookieFor(opId) },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/operator");
  });

  it("serves operator SPA for operator", async () => {
    const res = await app.request("/operator", {
      headers: { Cookie: await sessionCookieFor(opId) },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("staff-spa-fixture");
  });
});