import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { InMemoryRateLimitStore } from "../src/rate-limit/in-memory.js";
import type { RateLimitStore } from "../src/rate-limit/types.js";
import { createHealthzRateLimitMiddleware } from "../src/ops/healthz-rate-limit.js";

describe("createHealthzRateLimitMiddleware", () => {
  it("isolates counters per replica when Redis is shared", async () => {
    const store = new InMemoryRateLimitStore();
    const appA = new Hono();
    appA.get("/", createHealthzRateLimitMiddleware(store, "replica-a"), (c) => c.text("ok"));
    const appB = new Hono();
    appB.get("/", createHealthzRateLimitMiddleware(store, "replica-b"), (c) => c.text("ok"));

    for (let i = 0; i < 120; i++) {
      expect((await appA.request("/")).status).toBe(200);
    }
    expect((await appA.request("/")).status).toBe(429);
    expect((await appB.request("/")).status).toBe(200);
  });

  it("fails open when the rate-limit store throws", async () => {
    const store: RateLimitStore = {
      hit: vi.fn().mockRejectedValue(new Error("redis down")),
      health: vi.fn().mockResolvedValue({ ok: false, latencyMs: null }),
    };
    const app = new Hono();
    app.get("/", createHealthzRateLimitMiddleware(store, "replica-a"), (c) => c.text("ok"));

    const res = await app.request("/");
    expect(res.status).toBe(200);
  });
});
