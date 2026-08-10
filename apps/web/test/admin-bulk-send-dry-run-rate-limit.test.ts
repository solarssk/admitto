import { describe, expect, it } from "vitest";
import { Hono, type Context, type Next } from "hono";
import { InMemoryRateLimitStore, rateLimit, skipBulkSendRateLimitForDryRun } from "../src/rate-limit/index.js";

function adminContext(userId: string) {
  return async (c: Context, next: Next): Promise<void> => {
    c.set("auth", { userId });
    await next();
  };
}

function makeSendApp(store: InMemoryRateLimitStore, userId: string) {
  const app = new Hono();
  app.post(
    "/api/admin/events/:eventId/send",
    adminContext(userId),
    skipBulkSendRateLimitForDryRun,
    rateLimit(store, "admin:resend-bulk"),
    (c) => c.json({ ok: true, dryRun: c.get("bulkSendDryRun") === true }, 200),
  );
  return app;
}

describe("admin bulk send dry-run rate-limit skip", () => {
  it("does not consume the bulk-send limit for dryRun: true", async () => {
    const store = new InMemoryRateLimitStore();
    const app = makeSendApp(store, "admin-dry-run");

    for (let i = 0; i < 5; i++) {
      const res = await app.request("/api/admin/events/evt-a/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dryRun: true, filter: { type: "all" } }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, dryRun: true });
    }
  });

  it("treats invalid JSON as non-dry-run and still applies the bulk limit", async () => {
    const store = new InMemoryRateLimitStore();
    const app = makeSendApp(store, "admin-bad-json");

    for (let i = 0; i < 3; i++) {
      const res = await app.request("/api/admin/events/evt-a/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not-json",
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, dryRun: false });
    }

    const limited = await app.request("/api/admin/events/evt-a/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not-json",
    });
    expect(limited.status).toBe(429);
  });
});
