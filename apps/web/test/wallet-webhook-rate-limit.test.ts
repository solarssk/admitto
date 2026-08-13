import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { InMemoryRateLimitStore } from "../src/rate-limit/index.js";
import { rateLimit } from "../src/rate-limit/policies.js";

function makeWebhookApp(store: InMemoryRateLimitStore) {
  const app = new Hono();
  app.post(
    "/api/wallet/webhook/passcreator/:eventId",
    rateLimit(store, "wallet:webhook"),
    (c) => c.body(null, 200),
  );
  return app;
}

describe("wallet webhook rate limit", () => {
  it("returns 429 after 120 deliveries per event per minute", async () => {
    const store = new InMemoryRateLimitStore();
    const app = makeWebhookApp(store);

    for (let i = 0; i < 120; i++) {
      const res = await app.request("/api/wallet/webhook/passcreator/evt-a", { method: "POST" });
      expect(res.status).toBe(200);
    }

    const limited = await app.request("/api/wallet/webhook/passcreator/evt-a", { method: "POST" });
    expect(limited.status).toBe(429);
  });

  it("does not let rotating fake event ids bypass the per-event cap - the per-IP check catches it", async () => {
    const store = new InMemoryRateLimitStore();
    const app = makeWebhookApp(store);

    // Each request uses a distinct, attacker-controlled eventId - the per-event check alone would
    // never trip (every id sees at most one request), which is exactly the gap being closed here.
    for (let i = 0; i < 600; i++) {
      const res = await app.request(`/api/wallet/webhook/passcreator/fake-event-${i}`, {
        method: "POST",
      });
      expect(res.status).toBe(200);
    }

    const limited = await app.request("/api/wallet/webhook/passcreator/fake-event-600", {
      method: "POST",
    });
    expect(limited.status).toBe(429);
  });

  it("keeps two events' per-event buckets independent, both under the shared per-IP ceiling", async () => {
    const store = new InMemoryRateLimitStore();
    const app = makeWebhookApp(store);

    for (let i = 0; i < 120; i++) {
      const res = await app.request("/api/wallet/webhook/passcreator/evt-a", { method: "POST" });
      expect(res.status).toBe(200);
    }
    // evt-a is now at its own per-event cap, but evt-b's own bucket is untouched.
    const evtB = await app.request("/api/wallet/webhook/passcreator/evt-b", { method: "POST" });
    expect(evtB.status).toBe(200);
  });
});
