import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import { InMemoryRateLimitStore } from "../src/rate-limit/index.js";
import {
  createAdminExportRateLimit,
  createAdminPiiExportRateLimit,
} from "../src/admin-export-rate-limit.js";

function adminContext(userId: string) {
  return async (c: Context, next: Next): Promise<void> => {
    c.set("auth", { userId });
    await next();
  };
}

function makeExportApp(store: InMemoryRateLimitStore, userId: string) {
  const app = new Hono();
  app.get(
    "/api/admin/events/:eventId/attendees/export",
    adminContext(userId),
    createAdminExportRateLimit(store),
    (c) => c.json({ ok: true }, 200),
  );
  app.get(
    "/api/admin/events/:eventId/reports/export",
    adminContext(userId),
    createAdminExportRateLimit(store),
    (c) => c.json({ ok: true }, 200),
  );
  return app;
}

function makePiiExportApp(store: InMemoryRateLimitStore, userId: string) {
  const app = new Hono();
  app.get(
    "/api/admin/events/:eventId/export-pii",
    adminContext(userId),
    createAdminPiiExportRateLimit(store),
    (c) => c.json({ ok: true }, 200),
  );
  return app;
}

describe("admin export rate limit", () => {
  it("returns 429 after 10 exports per hour per user per route", async () => {
    const store = new InMemoryRateLimitStore();
    const app = makeExportApp(store, "admin-export-rl");

    for (let i = 0; i < 10; i++) {
      const res = await app.request(
        "/api/admin/events/evt-a/attendees/export?format=csv",
      );
      expect(res.status).toBe(200);
    }

    const limited = await app.request(
      "/api/admin/events/evt-a/attendees/export?format=csv",
    );
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "too many requests" });
  });

  it("does not share export bucket between admins", async () => {
    const store = new InMemoryRateLimitStore();
    const appA = makeExportApp(store, "admin-a");
    const appB = makeExportApp(store, "admin-b");

    for (let i = 0; i < 10; i++) {
      expect(
        (
          await appA.request("/api/admin/events/evt-a/attendees/export?format=csv")
        ).status,
      ).toBe(200);
    }
    expect(
      (await appA.request("/api/admin/events/evt-a/attendees/export?format=csv"))
        .status,
    ).toBe(429);
    expect(
      (await appB.request("/api/admin/events/evt-a/attendees/export?format=csv"))
        .status,
    ).toBe(200);
  });

  it("PII export limiter returns 429 after 5 requests per hour", async () => {
    const store = new InMemoryRateLimitStore();
    const app = makePiiExportApp(store, "admin-pii-rl");

    for (let i = 0; i < 5; i++) {
      const res = await app.request("/api/admin/events/evt-a/export-pii");
      expect(res.status).toBe(200);
    }

    const limited = await app.request("/api/admin/events/evt-a/export-pii");
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "too many requests" });
  });

  it("uses separate buckets per routePath and shared bucket across eventIds", async () => {
    const store = new InMemoryRateLimitStore();
    const app = makeExportApp(store, "admin-route-rl");

    for (let i = 0; i < 10; i++) {
      expect(
        (
          await app.request("/api/admin/events/evt-a/attendees/export?format=csv")
        ).status,
      ).toBe(200);
    }
    expect(
      (await app.request("/api/admin/events/evt-a/attendees/export?format=csv"))
        .status,
    ).toBe(429);

    expect(
      (await app.request("/api/admin/events/evt-b/reports/export?format=csv"))
        .status,
    ).toBe(200);

    for (let i = 0; i < 9; i++) {
      expect(
        (
          await app.request("/api/admin/events/evt-c/reports/export?format=csv")
        ).status,
      ).toBe(200);
    }
    expect(
      (await app.request("/api/admin/events/evt-d/reports/export?format=csv"))
        .status,
    ).toBe(429);

    expect(
      (await app.request("/api/admin/events/evt-other/attendees/export?format=csv"))
        .status,
    ).toBe(429);
  });
});
