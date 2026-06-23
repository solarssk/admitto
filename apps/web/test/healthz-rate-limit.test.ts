import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { InMemoryRateLimitStore } from "../src/rate-limit/in-memory.js";
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
});
