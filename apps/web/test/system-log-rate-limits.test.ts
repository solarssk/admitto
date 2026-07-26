import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";
import { rateLimit } from "../src/rate-limit/policies.js";
import type { RateLimitStore } from "../src/rate-limit/types.js";

const blockedStore: RateLimitStore = {
  hit: async () => ({ allowed: false, remaining: 0, resetAt: Date.now() + 60_000 }),
  health: async () => ({ ok: true, latencyMs: null }),
};

function createRateLimitedApp(store: RateLimitStore, checkinAuth: "bearer" | "session" = "session") {
  const app = new Hono();
  app.use("/admin/*", async (c, next) => {
    c.set("auth", { userId: "verified-staff-user" });
    await next();
  });
  app.use("/checkin/*", async (c, next) => {
    c.set("checkinAuth", checkinAuth);
    if (checkinAuth === "session") {
      c.set("operatorUserId", "verified-staff-operator");
    }
    await next();
  });

  app.get("/admin/events/:eventId/export", rateLimit(store, "admin:export"), (c) => c.text("ok"));
  app.get(
    "/admin/events/:eventId/export-pii",
    rateLimit(store, "admin:export-pii"),
    (c) => c.text("ok"),
  );
  app.post(
    "/admin/events/:eventId/attendees/resend",
    rateLimit(store, "admin:resend-bulk"),
    (c) => c.text("ok"),
  );
  app.post("/admin/attendees/:id/resend", rateLimit(store, "admin:resend"), (c) => c.text("ok"));
  app.post("/checkin/:eventId/scan", rateLimit(store, "checkin:scan"), (c) => c.text("ok"));
  app.get("/checkin/:eventId/history", rateLimit(store, "checkin:history"), (c) => c.text("ok"));
  app.get("/checkin/:eventId/stream", rateLimit(store, "checkin:stream"), (c) => c.text("ok"));

  return app;
}

describe("System logs rate-limit coverage", () => {
  it("records each newly covered scope with safe routing context", async () => {
    resetSystemLogBufferForTest();
    const app = createRateLimitedApp(blockedStore);

    const responses = await Promise.all([
      app.request("/admin/events/event-1/export"),
      app.request("/admin/events/event-1/export-pii"),
      app.request("/admin/events/event-1/attendees/resend", { method: "POST" }),
      app.request("/admin/attendees/attendee-1/resend", { method: "POST" }),
      app.request("/checkin/event-1/scan", { method: "POST" }),
      app.request("/checkin/event-1/history"),
      app.request("/checkin/event-1/stream"),
    ]);
    expect(responses.map((response) => response.status)).toEqual([429, 429, 429, 429, 429, 429, 429]);

    const entries = querySystemLogs({ source: "security" }).filter(
      (entry) => entry.message === "auth.rate_limit.exceeded",
    );
    expect(entries).toHaveLength(7);
    expect(entries.every((entry) => entry.level === "warn")).toBe(true);
    expect(entries.map((entry) => entry.fields?.scope).sort()).toEqual([
      "admin_export",
      "admin_export_pii",
      "admin_resend",
      "admin_resend_bulk",
      "checkin_history",
      "checkin_scan",
      "checkin_stream",
    ]);
    expect(Object.fromEntries(entries.map((entry) => [entry.fields?.scope, entry.fields?.key_hint]))).toMatchObject({
      admin_export: "user_route",
      admin_export_pii: "user_route",
      admin_resend: "user_attendee",
      admin_resend_bulk: "user",
      checkin_history: "user",
      checkin_scan: "user",
      checkin_stream: "user",
    });
    expect(JSON.stringify(entries)).not.toContain("verified-staff-user");
    expect(JSON.stringify(entries)).not.toContain("verified-staff-operator");
    expect(JSON.stringify(entries)).not.toContain("attendee-1");
  });

  it("labels bearer check-in limits as IP buckets", async () => {
    resetSystemLogBufferForTest();
    const app = createRateLimitedApp(blockedStore, "bearer");

    const responses = await Promise.all([
      app.request("/checkin/event-1/scan", { method: "POST" }),
      app.request("/checkin/event-1/history"),
      app.request("/checkin/event-1/stream"),
    ]);
    expect(responses.map((response) => response.status)).toEqual([429, 429, 429]);

    const entries = querySystemLogs({ source: "security" }).filter(
      (entry) => entry.message === "auth.rate_limit.exceeded",
    );
    expect(Object.fromEntries(entries.map((entry) => [entry.fields?.scope, entry.fields?.key_hint]))).toEqual({
      checkin_history: "ip",
      checkin_scan: "ip",
      checkin_stream: "ip",
    });
    expect(JSON.stringify(entries)).not.toContain("verified-staff-operator");
  });

  it("records the authenticated resend global-limit branch without its user ID", async () => {
    let hits = 0;
    const globalResendStore: RateLimitStore = {
      hit: async () => ({ allowed: hits++ === 0, remaining: 0, resetAt: Date.now() + 60_000 }),
      health: async () => ({ ok: true, latencyMs: null }),
    };
    resetSystemLogBufferForTest();
    const app = createRateLimitedApp(globalResendStore);

    const response = await app.request("/admin/attendees/attendee-1/resend", { method: "POST" });
    expect(response.status).toBe(429);

    const [entry] = querySystemLogs({ source: "security" });
    expect(entry).toMatchObject({
      level: "warn",
      message: "auth.rate_limit.exceeded",
      fields: { scope: "admin_resend", key_hint: "user_global" },
    });
    expect(JSON.stringify(entry)).not.toContain("verified-staff-user");
    expect(JSON.stringify(entry)).not.toContain("attendee-1");
  });
});
