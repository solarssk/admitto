import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import {
  InMemoryRateLimitStore,
  createPublicRateLimitMiddleware,
} from "../src/rate-limit/index.js";

function makeRateLimitTestApp(store: InMemoryRateLimitStore) {
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
});
