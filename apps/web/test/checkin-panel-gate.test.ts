import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { PrismaClient } from "@admitto/db";

vi.mock("@admitto/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/auth")>();
  return {
    ...actual,
    canAccessCheckInPanel: vi.fn(),
    canAccessAdminPanel: vi.fn(),
  };
});

vi.mock("../src/setup-routes.js", () => ({
  resolveStaffEntryPath: vi.fn(async () => "/login"),
}));

import { canAccessAdminPanel, canAccessCheckInPanel } from "@admitto/auth";
import { resolveStaffEntryPath } from "../src/setup-routes.js";
import { createCheckInPanelCapabilityGuard } from "../src/auth/checkin-panel-gate.js";

const canCheckIn = vi.mocked(canAccessCheckInPanel);
const canAdmin = vi.mocked(canAccessAdminPanel);
const resolveEntry = vi.mocked(resolveStaffEntryPath);

type Vars = { Variables: { auth?: { userId: string } | null } };

function makePrisma(mustChangePassword = false): PrismaClient {
  return {
    user: {
      findUnique: vi.fn(async () => ({ must_change_password: mustChangePassword })),
    },
  } as unknown as PrismaClient;
}

function makeApp(opts: {
  auth?: { userId: string } | null;
  mustChangePassword?: boolean;
}): Hono<Vars> {
  const prisma = makePrisma(opts.mustChangePassword ?? false);
  const app = new Hono<Vars>();
  app.use("*", async (c, next) => {
    if (opts.auth !== undefined) c.set("auth", opts.auth);
    await next();
  });
  app.use("*", createCheckInPanelCapabilityGuard(prisma));
  app.get("/operator", (c) => c.text("ok"));
  app.get("/api/checkin/history", (c) => c.json({ ok: true }));
  return app;
}

describe("createCheckInPanelCapabilityGuard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveEntry.mockResolvedValue("/login");
    canCheckIn.mockResolvedValue(true);
    canAdmin.mockResolvedValue(false);
  });

  it("returns 401 JSON for API paths without auth", async () => {
    const app = makeApp({ auth: null });
    const res = await app.request("/api/checkin/history");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("redirects HTML paths without auth to staff entry", async () => {
    resolveEntry.mockResolvedValue("/setup");
    const app = makeApp({ auth: null });
    const res = await app.request("/operator");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/setup");
  });

  it("redirects admin-capable users without check-in access to /admin", async () => {
    canCheckIn.mockResolvedValue(false);
    canAdmin.mockResolvedValue(true);
    const app = makeApp({ auth: { userId: "u1" } });
    const res = await app.request("/operator");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin");
  });

  it("returns 403 JSON when admin-capable user hits API without check-in access", async () => {
    canCheckIn.mockResolvedValue(false);
    canAdmin.mockResolvedValue(true);
    const app = makeApp({ auth: { userId: "u1" } });
    const res = await app.request("/api/checkin/history");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });

  it("returns 403 text when user has neither check-in nor admin access", async () => {
    canCheckIn.mockResolvedValue(false);
    canAdmin.mockResolvedValue(false);
    const app = makeApp({ auth: { userId: "u1" } });
    const res = await app.request("/operator");
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Forbidden");
  });

  it("returns 403 JSON for API when user has neither check-in nor admin access", async () => {
    canCheckIn.mockResolvedValue(false);
    canAdmin.mockResolvedValue(false);
    const app = makeApp({ auth: { userId: "u1" } });
    const res = await app.request("/api/checkin/history");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });

  it("redirects to change-password when must_change_password is set", async () => {
    const app = makeApp({ auth: { userId: "u1" }, mustChangePassword: true });
    const res = await app.request("/operator");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/change-password");
  });

  it("returns password_change_required for API when must_change_password is set", async () => {
    const app = makeApp({ auth: { userId: "u1" }, mustChangePassword: true });
    const res = await app.request("/api/checkin/history");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "password_change_required" });
  });

  it("calls next when check-in access is granted and password is fine", async () => {
    const app = makeApp({ auth: { userId: "u1" } });
    const res = await app.request("/operator");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });
});
