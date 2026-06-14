import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { InMemoryRateLimitStore } from "../src/rate-limit/index.js";
import { createCheckinRateLimitMiddleware } from "../src/checkin-rate-limit.js";

function makeApp(store: InMemoryRateLimitStore) {
  const app = new Hono();
  app.use("/api/checkin/*", createCheckinRateLimitMiddleware(store));
  app.get("/api/checkin/history", (c) => c.json({ ok: true }, 200));
  app.post("/api/checkin/scan", (c) => c.json({ ok: true }, 200));
  return app;
}

const clientHeaders = { "X-Forwarded-For": "203.0.113.42" };

describe("check-in rate limit middleware", () => {
  it("returns 429 after limit exceeded on scan", async () => {
    const store = new InMemoryRateLimitStore();
    const app = makeApp(store);

    for (let i = 0; i < 120; i++) {
      const res = await app.request("/api/checkin/scan", {
        method: "POST",
        headers: clientHeaders,
      });
      expect(res.status).toBe(200);
    }

    const blocked = await app.request("/api/checkin/scan", {
      method: "POST",
      headers: clientHeaders,
    });
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "too many requests" });
  });

  it("shares the same IP bucket for scan and history", async () => {
    const store = new InMemoryRateLimitStore();
    const app = makeApp(store);

    for (let i = 0; i < 120; i++) {
      const res = await app.request("/api/checkin/history?eventId=e1", { headers: clientHeaders });
      expect(res.status).toBe(200);
    }

    const blocked = await app.request("/api/checkin/scan", {
      method: "POST",
      headers: clientHeaders,
    });
    expect(blocked.status).toBe(429);
  });
});
