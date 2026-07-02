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

function makeBulkApp(store: InMemoryRateLimitStore, userId: string) {
  const app = new Hono();
  app.post(
    "/api/admin/events/:eventId/attendees/bulk-resend",
    adminContext(userId),
    rateLimit(store, "admin:resend-bulk"),
    (c) => c.json({ queued: 0, skipped: 0, failed: 0 }, 200),
  );
  return app;
}

describe("admin bulk resend rate limit", () => {
  it("returns 429 after 3 bulk sends per 10 minutes per user", async () => {
    const store = new InMemoryRateLimitStore();
    const app = makeBulkApp(store, "admin-bulk-rl");

    for (let i = 0; i < 3; i++) {
      const res = await app.request("/api/admin/events/evt-a/attendees/bulk-resend", {
        method: "POST",
      });
      expect(res.status).toBe(200);
    }

    const limited = await app.request("/api/admin/events/evt-a/attendees/bulk-resend", {
      method: "POST",
    });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "too many requests" });
  });

  it("does not share bulk bucket between admins", async () => {
    const store = new InMemoryRateLimitStore();
    const appA = makeBulkApp(store, "admin-a");
    const appB = makeBulkApp(store, "admin-b");

    for (let i = 0; i < 3; i++) {
      expect(
        (await appA.request("/api/admin/events/evt-a/attendees/bulk-resend", { method: "POST" }))
          .status,
      ).toBe(200);
    }
    expect(
      (await appA.request("/api/admin/events/evt-a/attendees/bulk-resend", { method: "POST" }))
        .status,
    ).toBe(429);
    expect(
      (await appB.request("/api/admin/events/evt-a/attendees/bulk-resend", { method: "POST" }))
        .status,
    ).toBe(200);
  });
});
