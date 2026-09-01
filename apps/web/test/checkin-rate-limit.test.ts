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

function bearerContext() {
  return async (c: Context, next: Next): Promise<void> => {
    c.set("checkinAuth", "bearer");
    await next();
  };
}

function anonymousIpContext() {
  return async (c: Context, next: Next): Promise<void> => {
    // Neither bearer nor a resolved operator user - the plain-IP fallback branch.
    await next();
  };
}

function makeStreamApp(store: InMemoryRateLimitStore, authMiddleware: (c: Context, next: Next) => Promise<void>) {
  const app = new Hono();
  app.get(
    "/api/checkin/events/:eventId/stream",
    authMiddleware,
    rateLimit(store, "checkin:stream"),
    (c) => c.json({ ok: true }, 200),
  );
  return app;
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

  it("scopes the checkin:stream rate limit per event for a bearer-authenticated caller", async () => {
    const store = new InMemoryRateLimitStore();
    const app = makeStreamApp(store, bearerContext());

    for (let i = 0; i < 12; i++) {
      expect((await app.request("/api/checkin/events/evt-a/stream")).status).toBe(200);
    }
    expect((await app.request("/api/checkin/events/evt-a/stream")).status).toBe(429);
    // A different event under the same bearer/IP still has its own per-event budget.
    expect((await app.request("/api/checkin/events/evt-b/stream")).status).toBe(200);
  });

  it("falls back to a plain-IP checkin:stream key when neither bearer auth nor an operator user id is present", async () => {
    const store = new InMemoryRateLimitStore();
    const app = makeStreamApp(store, anonymousIpContext());

    for (let i = 0; i < 12; i++) {
      expect((await app.request("/api/checkin/events/evt-anon/stream")).status).toBe(200);
    }
    expect((await app.request("/api/checkin/events/evt-anon/stream")).status).toBe(429);
  });

  it("caps checkin:stream at the actor-wide ceiling across many distinct events, not just the per-event one", async () => {
    const store = new InMemoryRateLimitStore();
    const app = makeStreamApp(store, sessionContext("op-actor-rl"));

    // 12/event * 4 events = 48, the actor-wide ceiling - well under any single event's own cap,
    // so only the actor-wide check can be what blocks a 49th request on a brand-new 5th event.
    for (let e = 0; e < 4; e++) {
      for (let i = 0; i < 12; i++) {
        expect((await app.request(`/api/checkin/events/evt-rl-${e}/stream`)).status).toBe(200);
      }
    }
    expect((await app.request("/api/checkin/events/evt-rl-fresh/stream")).status).toBe(429);
  });
});
