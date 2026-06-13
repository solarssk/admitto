import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { PrismaClient } from "@prisma/client";
import { hashPassword, createSession } from "@admitto/auth";
import {
  createCheckinConfiguredGuard,
  createCheckinDualAuth,
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
let dualTestApp: Hono;
let scanApp: Hono;

function buildDualApp(getEventId: (c: import("hono").Context) => string | undefined): Hono {
  const app = new Hono();
  app.use("/api/checkin/*", createCheckinConfiguredGuard(TOKEN));
  app.get(
    "/api/checkin/test",
    createCheckinDualAuth({ prisma, operatorToken: TOKEN }, getEventId),
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

  dualTestApp = buildDualApp(eventIdFromHistoryQuery);
  scanApp = new Hono();
  scanApp.use("/api/checkin/*", createCheckinConfiguredGuard(TOKEN));
  scanApp.post(
    "/api/checkin/scan",
    parseScanBodyMiddleware,
    createCheckinDualAuth({ prisma, operatorToken: TOKEN }, eventIdFromScanBody),
    (c) => c.json({ ok: true }, 200),
  );
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

describe("createCheckinDualAuth — session matrix", () => {
  it("operator matching event → 200", async () => {
    const cookie = await sessionCookieFor(USER_OP_A);
    const res = await dualTestApp.request(`/api/checkin/test?eventId=${EVENT_A}`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
  });

  it("operator wrong event → 401", async () => {
    const cookie = await sessionCookieFor(USER_OP_A);
    const res = await dualTestApp.request(`/api/checkin/test?eventId=${EVENT_B}`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(401);
  });

  it("admin matching org → 200", async () => {
    const cookie = await sessionCookieFor(USER_ADMIN_A);
    const res = await dualTestApp.request(`/api/checkin/test?eventId=${EVENT_A}`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
  });

  it("admin wrong org → 401", async () => {
    const cookie = await sessionCookieFor(USER_ADMIN_A);
    const res = await dualTestApp.request(`/api/checkin/test?eventId=${EVENT_B}`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(401);
  });

  it("superadmin → 200", async () => {
    const cookie = await sessionCookieFor(USER_SUPER);
    const res = await dualTestApp.request(`/api/checkin/test?eventId=${EVENT_B}`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
  });

  it("missing eventId → 400", async () => {
    const cookie = await sessionCookieFor(USER_SUPER);
    const res = await dualTestApp.request("/api/checkin/test", { headers: { Cookie: cookie } });
    expect(res.status).toBe(400);
  });

  it("no session no bearer → 401", async () => {
    const res = await dualTestApp.request(`/api/checkin/test?eventId=${EVENT_A}`);
    expect(res.status).toBe(401);
  });

  it("expired session + valid Bearer → 200", async () => {
    const { rawToken, session } = await createSession(prisma, { userId: USER_OP_A });
    await prisma.session.update({
      where: { id: session.id },
      data: { expires_at: new Date(Date.now() - 1000) },
    });
    const res = await dualTestApp.request(`/api/checkin/test?eventId=${EVENT_A}`, {
      headers: {
        Cookie: `admitto_session=${rawToken}`,
        Authorization: `Bearer ${TOKEN}`,
      },
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

describe("createCheckinConfiguredGuard — 503 when unconfigured", () => {
  const app = new Hono();
  app.use("/api/checkin/*", createCheckinConfiguredGuard(null));
  app.get("/api/checkin/history", (c) => c.json([], 200));

  it("returns 503 even if session would work", async () => {
    const cookie = await sessionCookieFor(USER_SUPER);
    const res = await app.request(`/api/checkin/history?eventId=${EVENT_A}`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(503);
  });
});

describe("scan route eventId from body only", () => {
  it("session auth uses body.eventId", async () => {
    const cookie = await sessionCookieFor(USER_OP_A);
    const res = await scanApp.request("/api/checkin/scan", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ eventId: EVENT_A, scanned: "qr" }),
    });
    expect(res.status).toBe(200);
  });
});
