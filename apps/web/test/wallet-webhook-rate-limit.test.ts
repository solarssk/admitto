import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { InMemoryRateLimitStore } from "../src/rate-limit/index.js";
import { RATE_POLICIES, rateLimit } from "../src/rate-limit/policies.js";

function makeWebhookApp(store: InMemoryRateLimitStore) {
  const app = new Hono();
  app.post(
    "/api/wallet/webhook/passcreator/:eventId",
    rateLimit(store, "wallet:webhook"),
    (c) => c.body(null, 200),
  );
  return app;
}

// Derived from the policy instead of hardcoded, so this test stays correct if its numbers change.
const WALLET_WEBHOOK_IP_MAX = Math.max(...RATE_POLICIES["wallet:webhook"].checks.map((check) => check.max));

describe("wallet webhook rate limit (before the signature is known)", () => {
  it("does not count requests per event: the per-event ceiling only applies once a signature has verified", async () => {
    const store = new InMemoryRateLimitStore();
    const app = makeWebhookApp(store);

    // Well past the 120/min per-event ceiling that signed deliveries get, all still under the IP one.
    for (let i = 0; i < 130; i++) {
      const res = await app.request("/api/wallet/webhook/passcreator/evt-a", { method: "POST" });
      expect(res.status).toBe(200);
    }
  });

  it("caps requests per IP, whatever event ids they name", async () => {
    const store = new InMemoryRateLimitStore();
    const app = makeWebhookApp(store);

    // Each request uses a distinct, attacker-controlled eventId, so only the per-IP check can stop it.
    for (let i = 0; i < WALLET_WEBHOOK_IP_MAX; i++) {
      const res = await app.request(`/api/wallet/webhook/passcreator/fake-event-${i}`, {
        method: "POST",
      });
      expect(res.status).toBe(200);
    }

    const limited = await app.request(`/api/wallet/webhook/passcreator/fake-event-${WALLET_WEBHOOK_IP_MAX}`, {
      method: "POST",
    });
    expect(limited.status).toBe(429);
  });
});
