import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { PrismaClient } from "@prisma/client";
import { hashPassword, createSession } from "@admitto/auth";
import {
  createCheckinPreAuth,
  createCheckinEventScope,
  parseScanBodyMiddleware,
  eventIdFromScanBody,
  eventIdFromHistoryQuery,
  createCheckinGate,
} from "../src/checkin-gate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_ROOT = path.resolve(__dirname, "..", "..", "..", "packages", "db");
const TOKEN = "test-operator-token-abc123";
const ORG_A = "org-dual-a";
const ORG_B = "org-dual-b";
const EVENT_A = "event-dual-a";
const EVENT_B = "event-dual-b";
const USER_SUPER = "user-dual-super";
const USER_ADMIN_A = "user-dual-admin-a";
const USER_OP_A = "user-dual-op-a";

let prisma: PrismaClient;

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

function buildScanApp(allowBearer = false) {
  const deps = gateDeps(allowBearer);
  const app = new Hono();
  app.post(
    "/api/checkin/scan",
    createCheckinPreAuth(deps),
    parseScanBodyMiddleware,
    createCheckinEventScope(deps, eventIdFromScanBody),
    (c) => c.json({ ok: true }, 200),
  );
  return app;
}

beforeAll(async () => {
  execSync("npx prisma db push --force-reset --accept-data-loss", {
    cwd: DB_ROOT,
    env: { ...process.env },
    stdio: "pipe",
  });

  prisma = new PrismaClient();
  const password_hash = await hashPassword("x");

  await prisma.organization.createMany({
    data: [
      { id: ORG_A, name: "A", slug: "dual-a" },
      { id: ORG_B, name: "B", slug: "dual-b" },
    ],
  });
  await prisma.event.createMany({
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
  await prisma.user.createMany({
    data: [
      { id: USER_SUPER, email: "s@example.com", password_hash },
      { id: USER_ADMIN_A, email: "a@example.com", password_hash },
      { id: USER_OP_A, email: "o@example.com", password_hash },
    ],
  });
  await prisma.roleAssignment.createMany({
    data: [
      { user_id: USER_SUPER, role: "superadmin", scope_type: "instance", scope_id: null },
      { user_id: USER_ADMIN_A, role: "admin", scope_type: "organization", scope_id: ORG_A },
      { user_id: USER_OP_A, role: "operator", scope_type: "event", scope_id: EVENT_A },
    ],
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function sessionCookieFor(userId: string): Promise<string> {
  const { rawToken } = await createSession(prisma, { userId });
  return `admitto_session=${rawToken}`;
}

describe("createCheckinGate bearer-only (legacy)", () => {
  const app = new Hono();
  app.use("/api/checkin/*", createCheckinGate(TOKEN));
  app.get("/api/checkin/history", (c) => c.json([], 200));

  it("Bearer passes", async () => {
    const res = await app.request("/api/checkin/history", {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
  });

  it("no auth → 401", async () => {
    const res = await app.request("/api/checkin/history");
    expect(res.status).toBe(401);
  });
});

describe("createCheckinPreAuth + eventScope — session matrix", () => {
  const dualTestApp = () => buildSessionApp(false);

  it("operator matching event → 200", async () => {
    const cookie = await sessionCookieFor(USER_OP_A);
    const res = await dualTestApp().request(`/api/checkin/test?eventId=${EVENT_A}`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
  });

  it("operator wrong event → 401", async () => {
    const cookie = await sessionCookieFor(USER_OP_A);
    const res = await dualTestApp().request(`/api/checkin/test?eventId=${EVENT_B}`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(401);
  });

  it("admin matching org → 200", async () => {
    const cookie = await sessionCookieFor(USER_ADMIN_A);
    const res = await dualTestApp().request(`/api/checkin/test?eventId=${EVENT_A}`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
  });

  it("admin wrong org → 401", async () => {
    const cookie = await sessionCookieFor(USER_ADMIN_A);
    const res = await dualTestApp().request(`/api/checkin/test?eventId=${EVENT_B}`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(401);
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
});

describe("scan middleware order", () => {
  const scanApp = () => buildScanApp(false);

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
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: "not-json",
    });
    expect(res.status).toBe(400);
  });

  it("session auth uses body.eventId", async () => {
    const cookie = await sessionCookieFor(USER_OP_A);
    const res = await scanApp().request("/api/checkin/scan", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ eventId: EVENT_A, scanned: "qr" }),
    });
    expect(res.status).toBe(200);
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
