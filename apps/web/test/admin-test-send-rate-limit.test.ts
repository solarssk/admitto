import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

function makeTestSendApp(store: InMemoryRateLimitStore, userId: string) {
  const app = new Hono();
  app.post(
    "/api/admin/events/:eventId/template/test-send",
    adminContext(userId),
    rateLimit(store, "admin:test-send"),
    (c) => c.json({ ok: true }, 200),
  );
  return app;
}

describe("admin test-send rate limit", () => {
  it("returns 429 after 5 test-sends per minute (burst)", async () => {
    const store = new InMemoryRateLimitStore();
    const app = makeTestSendApp(store, "admin-test-send-burst");

    for (let i = 0; i < 5; i++) {
      const res = await app.request("/api/admin/events/evt-a/template/test-send", {
        method: "POST",
      });
      expect(res.status).toBe(200);
    }

    const limited = await app.request("/api/admin/events/evt-a/template/test-send", {
      method: "POST",
    });
    expect(limited.status).toBe(429);
  });

  describe("sustained bucket", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("blocks the 21st test-send within an hour even though the per-minute burst bucket keeps resetting", async () => {
      const store = new InMemoryRateLimitStore();
      const app = makeTestSendApp(store, "admin-test-send-sustained");

      // 4 rounds of 5 (the full burst budget) with a 61s gap between rounds - each round starts
      // with a fresh burst bucket (60s window), so none of these 20 requests are blocked by burst.
      // Only the sustained bucket (3,600,000ms window, max 20) accumulates across all 4 rounds.
      for (let round = 0; round < 4; round++) {
        for (let i = 0; i < 5; i++) {
          const res = await app.request("/api/admin/events/evt-a/template/test-send", {
            method: "POST",
          });
          expect(res.status).toBe(200);
        }
        vi.advanceTimersByTime(61_000);
      }

      // Fresh burst window again (only 244s elapsed, still inside the 3600s sustained window) -
      // if this were blocked by burst, that would misattribute the cause; it must be sustained.
      const limited = await app.request("/api/admin/events/evt-a/template/test-send", {
        method: "POST",
      });
      expect(limited.status).toBe(429);
    });
  });
});
