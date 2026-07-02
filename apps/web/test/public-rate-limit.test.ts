import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import {
  InMemoryRateLimitStore,
  createPublicRateLimitMiddleware,
  type RateLimitStore,
} from "../src/rate-limit/index.js";
import { RedisRateLimitStore } from "../src/rate-limit/redis.js";

function makeRateLimitTestApp(store: RateLimitStore) {
  const app = new Hono();
  app.use("/t/*", createPublicRateLimitMiddleware(store));
  app.use("/q/*", createPublicRateLimitMiddleware(store));
  app.get("/t/:tok", (c) => c.text("ok", 200));
  app.get("/q/:file", (c) => c.text("ok", 200));
  app.get("/api/checkin/history", (c) => c.text("ok", 200));
  return app;
}

const clientHeaders = { "X-Forwarded-For": "203.0.113.10" };

describe("public rate limit middleware", () => {
  it("returns 429 on /t after limit exceeded", async () => {
    const store = new InMemoryRateLimitStore();
    const app = makeRateLimitTestApp(store);

    for (let i = 0; i < 60; i++) {
      const res = await app.request("/t/x", { headers: clientHeaders });
      expect(res.status).toBe(200);
    }

    const blocked = await app.request("/t/x", { headers: clientHeaders });
    expect(blocked.status).toBe(429);
    expect(await blocked.text()).toBe("Too Many Requests");
  });

  it("returns 429 on /q after limit exceeded", async () => {
    const store = new InMemoryRateLimitStore();
    const app = makeRateLimitTestApp(store);

    for (let i = 0; i < 60; i++) {
      const res = await app.request("/q/foo.png", { headers: clientHeaders });
      expect(res.status).toBe(200);
    }

    const blocked = await app.request("/q/foo.png", { headers: clientHeaders });
    expect(blocked.status).toBe(429);
  });

  it("does not rate limit /api/checkin routes", async () => {
    const store = new InMemoryRateLimitStore();
    const app = makeRateLimitTestApp(store);

    for (let i = 0; i < 65; i++) {
      const res = await app.request("/api/checkin/history", { headers: clientHeaders });
      expect(res.status).toBe(200);
    }
  });

  it("fails open when Redis is unreachable", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = new RedisRateLimitStore("redis://127.0.0.1:1", { connectTimeoutMs: 200 });
    const app = makeRateLimitTestApp(store);

    try {
      const res = await app.request("/t/x", { headers: clientHeaders });
      expect(res.status).toBe(200);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      await store.disconnect();
      warnSpy.mockRestore();
    }
  });
});
