import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import { InMemoryRateLimitStore } from "../src/rate-limit/in-memory.js";
import { rateLimit } from "../src/rate-limit/policies.js";

function sessionContext(userId: string) {
  return async (c: Context, next: Next): Promise<void> => {
    c.set("checkinAuth", "session");
    c.set("operatorUserId", userId);
    await next();
  };
}

function makeScanApp(store: InMemoryRateLimitStore, userId: string) {
  const app = new Hono();
  app.post(
    "/api/checkin/scan",
    sessionContext(userId),
    rateLimit(store, "checkin:scan"),
    (c) => c.json({ ok: true }, 200),
  );
  return app;
}

describe("check-in authenticated rate limit", () => {
  it("returns 429 after per-user scan limit exceeded", async () => {
    const store = new InMemoryRateLimitStore();
    const app = makeScanApp(store, "op-a");

    for (let i = 0; i < 120; i++) {
      const res = await app.request("/api/checkin/scan", { method: "POST" });
      expect(res.status).toBe(200);
    }

    const blocked = await app.request("/api/checkin/scan", { method: "POST" });
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "too many requests" });
  });

  it("does not share scan bucket between operators on the same IP", async () => {
    const store = new InMemoryRateLimitStore();
    const appA = makeScanApp(store, "op-a");
    const appB = makeScanApp(store, "op-b");
    const headers = { "X-Forwarded-For": "203.0.113.99" };

    for (let i = 0; i < 120; i++) {
      expect((await appA.request("/api/checkin/scan", { method: "POST", headers })).status).toBe(200);
    }
    expect((await appA.request("/api/checkin/scan", { method: "POST", headers })).status).toBe(429);
    expect((await appB.request("/api/checkin/scan", { method: "POST", headers })).status).toBe(200);
  });

  it("uses separate buckets for scan and history per user", async () => {
    const store = new InMemoryRateLimitStore();
    const app = new Hono();
    app.get(
      "/api/checkin/history",
      sessionContext("op-a"),
      rateLimit(store, "checkin:history"),
      (c) => c.json({ ok: true }, 200),
    );
    app.post(
      "/api/checkin/scan",
      sessionContext("op-a"),
      rateLimit(store, "checkin:scan"),
      (c) => c.json({ ok: true }, 200),
    );

    for (let i = 0; i < 120; i++) {
      expect((await app.request("/api/checkin/history?eventId=e1")).status).toBe(200);
    }
    expect((await app.request("/api/checkin/scan", { method: "POST" })).status).toBe(200);
  });
});
