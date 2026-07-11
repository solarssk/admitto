import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { PrismaClient } from "@prisma/client";
import { hashPassword, createSession, SESSION_STAGE } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import {
  createCheckinPreAuth,
  createCheckinSessionCsrfGuard,
  createCheckinEventScope,
  parseScanBodyMiddleware,
  eventIdFromScanBody,
  eventIdFromHistoryQuery,
} from "../../src/checkin-gate.js";
import { handleCheckinStats } from "../../src/admin/checkin-api-routes.js";
import { rateLimit } from "../../src/rate-limit/policies.js";
import { InMemoryRateLimitStore, type RateLimitStore } from "../../src/rate-limit/index.js";

const TOKEN = "test-operator-token-abc123";
const ORG_A = "org-dual-a";
const ORG_B = "org-dual-b";
const EVENT_A = "event-dual-a";
const EVENT_B = "event-dual-b";
const USER_SUPER = "user-dual-super";
const USER_ADMIN_A = "user-dual-admin-a";
const USER_OP_A = "user-dual-op-a";

let prisma: PrismaClient;

async function seedDualAuthFixture(client: PrismaClient): Promise<void> {
  const userIds = [USER_SUPER, USER_ADMIN_A, USER_OP_A];
  const eventIds = [EVENT_A, EVENT_B];
  const orgIds = [ORG_A, ORG_B];

  await client.roleAssignment.deleteMany({
    where: {
      OR: [
        { user_id: { in: userIds } },
        { scope_id: { in: [...eventIds, ...orgIds] } },
      ],
    },
  });
  await client.session.deleteMany({ where: { user_id: { in: userIds } } });
  await client.userMfaMethod.deleteMany({ where: { user_id: { in: userIds } } });
  await client.checkIn.deleteMany({ where: { event_id: { in: eventIds } } });
  await client.attendee.deleteMany({ where: { event_id: { in: eventIds } } });
  await client.user.deleteMany({ where: { id: { in: userIds } } });
  await client.event.deleteMany({ where: { id: { in: eventIds } } });
  await client.organization.deleteMany({ where: { id: { in: orgIds } } });

  const password_hash = await hashPassword("x");

  await client.organization.createMany({
    data: [
      { id: ORG_A, name: "A", slug: "dual-a" },
      { id: ORG_B, name: "B", slug: "dual-b" },
    ],
  });
  await client.event.createMany({
    data: [
      {
        id: EVENT_A,
        title: "A",
        slug: "ev-dual-a",
        date: new Date("2026-09-01"),
        organization_id: ORG_A,
      },
      {
        id: EVENT_B,
        title: "B",
        slug: "ev-dual-b",
        date: new Date("2026-09-01"),
        organization_id: ORG_B,
      },
    ],
  });
  await client.user.createMany({
    data: [
      { id: USER_SUPER, email: "s@example.com", password_hash },
      { id: USER_ADMIN_A, email: "a@example.com", password_hash },
      { id: USER_OP_A, email: "o@example.com", password_hash },
    ],
  });
  await client.roleAssignment.createMany({
    data: [
      { user_id: USER_SUPER, role: "superadmin", scope_type: "instance", scope_id: null },
      { user_id: USER_ADMIN_A, role: "admin", scope_type: "organization", scope_id: ORG_A },
      { user_id: USER_OP_A, role: "operator", scope_type: "event", scope_id: EVENT_A },
    ],
  });

  for (const userId of [USER_SUPER, USER_ADMIN_A]) {
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

function gateDeps(allowBearer: boolean) {
  return {
    prisma,
    config: {
      allowBearer,
      operatorToken: allowBearer ? TOKEN : null,
    },
  };
}

function buildSessionApp(allowBearer = false) {
  const deps = gateDeps(allowBearer);
  const app = new Hono();
  app.get(
    "/api/checkin/test",
    createCheckinPreAuth(deps),
    createCheckinEventScope(deps, eventIdFromHistoryQuery),
    (c) => c.json({ ok: true }, 200),
  );
  return app;
}

function buildScanApp(allowBearer = false, rateLimitStore?: RateLimitStore) {
  const deps = gateDeps(allowBearer);
  const app = new Hono();
  const handler = (c: { json: (body: unknown, status: number) => Response }) => c.json({ ok: true }, 200);
  if (rateLimitStore) {
    app.post(
      "/api/checkin/scan",
      createCheckinPreAuth(deps),
      createCheckinSessionCsrfGuard(),
      rateLimit(rateLimitStore, "checkin:scan"),
      parseScanBodyMiddleware,
      createCheckinEventScope(deps, eventIdFromScanBody),
      handler,
    );
  } else {
    app.post(
      "/api/checkin/scan",
      createCheckinPreAuth(deps),
      createCheckinSessionCsrfGuard(),
      parseScanBodyMiddleware,
      createCheckinEventScope(deps, eventIdFromScanBody),
      handler,
    );
  }
  return app;
}

beforeAll(async () => {
  prisma = new PrismaClient();
  await seedDualAuthFixture(prisma);
});

afterAll(async () => {
  await prisma?.$disconnect();
});

async function sessionCookieFor(userId: string): Promise<string> {
  const { rawToken } = await createSession(prisma, { userId, stage: SESSION_STAGE.FULL });
  return `admitto_session=${rawToken}`;
}

describe("createCheckinPreAuth + eventScope — session matrix", () => {
  const dualTestApp = () => buildSessionApp(false);

  it("operator matching event → 200", async () => {
    const cookie = await sessionCookieFor(USER_OP_A);
    const res = await dualTestApp().request(`/api/checkin/test?eventId=${EVENT_A}`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
  });

  it("operator wrong event → 403", async () => {
    const cookie = await sessionCookieFor(USER_OP_A);
    const res = await dualTestApp().request(`/api/checkin/test?eventId=${EVENT_B}`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(403);
  });

  it("admin matching org → 200", async () => {
    const cookie = await sessionCookieFor(USER_ADMIN_A);
    const res = await dualTestApp().request(`/api/checkin/test?eventId=${EVENT_A}`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
  });

  it("admin wrong org → 403", async () => {
    const cookie = await sessionCookieFor(USER_ADMIN_A);
    const res = await dualTestApp().request(`/api/checkin/test?eventId=${EVENT_B}`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(403);
  });

  it("superadmin → 200", async () => {
    const cookie = await sessionCookieFor(USER_SUPER);
    const res = await dualTestApp().request(`/api/checkin/test?eventId=${EVENT_B}`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
  });

  it("missing eventId → 400", async () => {
    const cookie = await sessionCookieFor(USER_SUPER);
    const res = await dualTestApp().request("/api/checkin/test", { headers: { Cookie: cookie } });
    expect(res.status).toBe(400);
  });

  it("no session no bearer → 401", async () => {
    const res = await dualTestApp().request(`/api/checkin/test?eventId=${EVENT_A}`);
    expect(res.status).toBe(401);
  });

  it("Bearer rejected when allowBearer=false", async () => {
    const res = await dualTestApp().request(`/api/checkin/test?eventId=${EVENT_A}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(401);
  });
});

describe("Bearer emergency path", () => {
  const bearerApp = () => buildSessionApp(true);

  it("valid Bearer without session → 200", async () => {
    const res = await bearerApp().request(`/api/checkin/test?eventId=${EVENT_A}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
  });

  it("wrong Bearer → 401", async () => {
    const res = await bearerApp().request(`/api/checkin/test?eventId=${EVENT_A}`, {
      headers: { Authorization: "Bearer wrong" },
    });
    expect(res.status).toBe(401);
  });

  it("Bearer scan without Origin header → 200", async () => {
    const bearerScanApp = buildScanApp(true);
    const res = await bearerScanApp.request("/api/checkin/scan", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ eventId: EVENT_A, scanned: "qr" }),
    });
    expect(res.status).toBe(200);
  });

  it("Bearer without an eventId skips the archived check and reaches the handler (no eventId to check archived status against)", async () => {
    const res = await bearerApp().request("/api/checkin/test", {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
  });
});

describe("scan middleware order", () => {
  const scanApp = () => buildScanApp(false);
  const sameOrigin = { Origin: "http://localhost" };

  it("unauthenticated invalid JSON → 401 not 400", async () => {
    const res = await scanApp().request("/api/checkin/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    expect(res.status).toBe(401);
  });

  it("unauthenticated valid JSON → 401", async () => {
    const res = await scanApp().request("/api/checkin/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId: EVENT_A, scanned: "x" }),
    });
    expect(res.status).toBe(401);
  });

  it("authenticated invalid JSON → 400", async () => {
    const cookie = await sessionCookieFor(USER_OP_A);
    const res = await scanApp().request("/api/checkin/scan", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json", ...sameOrigin },
      body: "not-json",
    });
    expect(res.status).toBe(400);
  });

  it("session auth uses body.eventId", async () => {
    const cookie = await sessionCookieFor(USER_OP_A);
    const res = await scanApp().request("/api/checkin/scan", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ eventId: EVENT_A, scanned: "qr" }),
    });
    expect(res.status).toBe(200);
  });

  it("rejects cross-origin session scan before body parse", async () => {
    const cookie = await sessionCookieFor(USER_OP_A);
    const res = await scanApp().request("/api/checkin/scan", {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        Origin: "https://evil.example",
      },
      body: JSON.stringify({ eventId: EVENT_A, scanned: "qr" }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });

  it("cross-origin session scan 403 does not consume per-user scan quota", async () => {
    const store = new InMemoryRateLimitStore();
    const scanApp = () => buildScanApp(false, store);
    const cookie = await sessionCookieFor(USER_OP_A);
    const crossOrigin = {
      Cookie: cookie,
      "Content-Type": "application/json",
      Origin: "https://evil.example",
    };
    const body = JSON.stringify({ eventId: EVENT_A, scanned: "x" });

    for (let i = 0; i < 120; i++) {
      expect((await scanApp().request("/api/checkin/scan", { method: "POST", headers: crossOrigin, body })).status).toBe(403);
    }

    const ok = await scanApp().request("/api/checkin/scan", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ eventId: EVENT_A, scanned: "qr" }),
    });
    expect(ok.status).toBe(200);
  });
});

describe("parseScanBodyMiddleware — single parse", () => {
  const app = new Hono();
  let parseCount = 0;

  app.post("/api/checkin/scan", parseScanBodyMiddleware, async (c) => {
    const body = c.get("parsedScanBody");
    parseCount += 1;
    return c.json({ eventId: body["eventId"], count: parseCount }, 200);
  });

  it("stores body on context", async () => {
    const res = await app.request("/api/checkin/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId: EVENT_A, scanned: "x" }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { eventId: string; count: number };
    expect(json.eventId).toBe(EVENT_A);
    expect(json.count).toBe(1);
  });
});

function buildStatsApp() {
  const deps = gateDeps(false);
  const app = new Hono();
  app.get(
    "/api/checkin/stats",
    createCheckinPreAuth(deps),
    createCheckinEventScope(deps, eventIdFromHistoryQuery),
    (c) => handleCheckinStats(c, prisma),
  );
  return app;
}

describe("GET /api/checkin/stats", () => {
  it("returns admitted_count and total_count", async () => {
    await prisma.attendee.createMany({
      data: [
        {
          id: "att-dual-stats-1",
          event_id: EVENT_A,
          email: "one@example.com",
          name: "One",
          admitted_at: new Date("2026-09-01T10:00:00Z"),
        },
        {
          id: "att-dual-stats-2",
          event_id: EVENT_A,
          email: "two@example.com",
          name: "Two",
        },
      ],
    });
    const cookie = await sessionCookieFor(USER_OP_A);
    const res = await buildStatsApp().request(`/api/checkin/stats?eventId=${EVENT_A}`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { admitted_count: number; total_count: number };
    expect(body.total_count).toBeGreaterThanOrEqual(body.admitted_count);
    expect(body.admitted_count).toBeGreaterThanOrEqual(1);
  });

  it("excludes revoked and cancelled attendees from both counts (#380)", async () => {
    const cookie = await sessionCookieFor(USER_OP_A);
    const fetchStats = async () =>
      (await (
        await buildStatsApp().request(`/api/checkin/stats?eventId=${EVENT_A}`, {
          headers: { Cookie: cookie },
        })
      ).json()) as { admitted_count: number; total_count: number };

    const before = await fetchStats();

    await prisma.attendee.createMany({
      data: [
        {
          id: "att-dual-stats-revoked",
          event_id: EVENT_A,
          email: "revoked-stats@example.com",
          name: "Revoked After Admit",
          status: "revoked",
          admitted_at: new Date("2026-09-01T11:00:00Z"),
        },
        {
          id: "att-dual-stats-cancelled",
          event_id: EVENT_A,
          email: "cancelled-stats@example.com",
          name: "Cancelled",
          status: "cancelled",
        },
      ],
    });

    const after = await fetchStats();
    expect(after.total_count).toBe(before.total_count);
    expect(after.admitted_count).toBe(before.admitted_count);
  });
});
