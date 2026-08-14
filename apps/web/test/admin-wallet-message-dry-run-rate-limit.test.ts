import { describe, expect, it } from "vitest";
import { Hono, type Context, type Next } from "hono";
import { InMemoryRateLimitStore, rateLimit, skipWalletMessageRateLimitForDryRun } from "../src/rate-limit/index.js";

function adminContext(userId: string) {
  return async (c: Context, next: Next): Promise<void> => {
    c.set("auth", { userId });
    await next();
  };
}

function makeSendApp(store: InMemoryRateLimitStore, userId: string) {
  const app = new Hono();
  app.post(
    "/api/admin/events/:eventId/wallet-message/send",
    adminContext(userId),
    skipWalletMessageRateLimitForDryRun,
    rateLimit(store, "admin:wallet-message-send"),
    (c) => c.json({ ok: true, dryRun: c.get("walletMessageDryRun") === true }, 200),
  );
  return app;
}

describe("admin wallet message dry-run rate-limit skip", () => {
  it("does not consume the send limit for dryRun: true", async () => {
    const store = new InMemoryRateLimitStore();
    const app = makeSendApp(store, "admin-dry-run");

    for (let i = 0; i < 15; i++) {
      const res = await app.request("/api/admin/events/evt-a/wallet-message/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dryRun: true, filter: { type: "all" }, text: "Hi" }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, dryRun: true });
    }
  });

  it("treats invalid JSON as non-dry-run and still applies the send limit", async () => {
    const store = new InMemoryRateLimitStore();
    const app = makeSendApp(store, "admin-bad-json");

    for (let i = 0; i < 10; i++) {
      const res = await app.request("/api/admin/events/evt-a/wallet-message/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not-json",
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, dryRun: false });
    }

    const limited = await app.request("/api/admin/events/evt-a/wallet-message/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not-json",
    });
    expect(limited.status).toBe(429);
  });

  it("applies the real send limit (max 10/10min) once dryRun is false", async () => {
    const store = new InMemoryRateLimitStore();
    const app = makeSendApp(store, "admin-real-send");

    for (let i = 0; i < 10; i++) {
      const res = await app.request("/api/admin/events/evt-a/wallet-message/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dryRun: false, filter: { type: "all" }, text: "Hi" }),
      });
      expect(res.status).toBe(200);
    }

    const limited = await app.request("/api/admin/events/evt-a/wallet-message/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dryRun: false, filter: { type: "all" }, text: "Hi" }),
    });
    expect(limited.status).toBe(429);
  });
});
