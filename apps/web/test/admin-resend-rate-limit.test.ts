import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import { InMemoryRateLimitStore } from "../src/rate-limit/index.js";
import { rateLimit } from "../src/rate-limit/policies.js";

function adminContext(userId: string) {
  return async (c: Context, next: Next): Promise<void> => {
    c.set("auth", { userId });
    await next();
  };
}

function makeResendApp(store: InMemoryRateLimitStore, userId: string) {
  const app = new Hono();
  app.post(
    "/api/admin/events/:eventId/attendees/:id/resend",
    adminContext(userId),
    rateLimit(store, "admin:resend"),
    (c) => c.json({ ok: true }, 200),
  );
  return app;
}

function makeResendAppWithoutAuth(store: InMemoryRateLimitStore) {
  const app = new Hono();
  app.post(
    "/api/admin/events/:eventId/attendees/:id/resend",
    rateLimit(store, "admin:resend"),
    (c) => c.json({ ok: true }, 200),
  );
  return app;
}

describe("admin resend rate limit", () => {
  it("returns 429 after 5 resends per attendee per minute", async () => {
    const store = new InMemoryRateLimitStore();
    const app = makeResendApp(store, "admin-resend-rl");

    for (let i = 0; i < 5; i++) {
      const res = await app.request("/api/admin/events/evt-a/attendees/att-1/resend", {
        method: "POST",
      });
      expect(res.status).toBe(200);
    }

    const limited = await app.request("/api/admin/events/evt-a/attendees/att-1/resend", {
      method: "POST",
    });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "too many requests" });
  });

  it("returns resend_global_limit after 30 resends per hour across attendees", async () => {
    const store = new InMemoryRateLimitStore();
    const app = makeResendApp(store, "admin-resend-global");

    for (let i = 0; i < 30; i++) {
      const res = await app.request(`/api/admin/events/evt-a/attendees/att-${i}/resend`, {
        method: "POST",
      });
      expect(res.status).toBe(200);
    }

    const limited = await app.request("/api/admin/events/evt-a/attendees/att-new/resend", {
      method: "POST",
    });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "resend_global_limit" });
  });

  it("does not share per-attendee bucket between admins", async () => {
    const store = new InMemoryRateLimitStore();
    const appA = makeResendApp(store, "admin-a");
    const appB = makeResendApp(store, "admin-b");

    for (let i = 0; i < 5; i++) {
      expect(
        (await appA.request("/api/admin/events/evt-a/attendees/att-1/resend", { method: "POST" }))
          .status,
      ).toBe(200);
    }
    expect(
      (await appA.request("/api/admin/events/evt-a/attendees/att-1/resend", { method: "POST" }))
        .status,
    ).toBe(429);
    expect(
      (await appB.request("/api/admin/events/evt-a/attendees/att-1/resend", { method: "POST" }))
        .status,
    ).toBe(200);
  });

  it("returns 400 when attendee id param is missing", async () => {
    const store = new InMemoryRateLimitStore();
    const app = new Hono();
    // Route without :id — exercises beforeCheck when param("id") is absent.
    app.post(
      "/api/admin/events/:eventId/attendees/resend",
      adminContext("admin-missing-id"),
      rateLimit(store, "admin:resend"),
      (c) => c.json({ ok: true }, 200),
    );

    const res = await app.request("/api/admin/events/evt-a/attendees/resend", { method: "POST" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "id required" });
  });

  it("skips global cap when userId is absent (IP-only per-attendee keys)", async () => {
    const store = new InMemoryRateLimitStore();
    const app = makeResendAppWithoutAuth(store);
    const headers = { "X-Forwarded-For": "203.0.113.99" };

    for (let i = 0; i < 31; i++) {
      const res = await app.request(`/api/admin/events/evt-a/attendees/att-${i}/resend`, {
        method: "POST",
        headers,
      });
      expect(res.status).toBe(200);
    }
  });
});
