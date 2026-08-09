import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { InMemoryRateLimitStore } from "../src/rate-limit/in-memory.js";
import {
  checkLoginEmailRateLimit,
  createLoginRateLimitMiddleware,
} from "../src/auth/login-rate-limit.js";

const LOGIN_IP_MAX = 10;
const LOGIN_EMAIL_MAX = 10;

describe("createLoginRateLimitMiddleware", () => {
  it("allows requests under the IP budget and returns JSON 429 when exhausted", async () => {
    const store = new InMemoryRateLimitStore();
    const app = new Hono();
    app.post("/api/auth/login", createLoginRateLimitMiddleware(store), (c) => c.json({ ok: true }));

    for (let i = 0; i < LOGIN_IP_MAX; i++) {
      const res = await app.request("/api/auth/login", { method: "POST" });
      expect(res.status).toBe(200);
    }
    const blocked = await app.request("/api/auth/login", { method: "POST" });
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "too many requests" });
  });

  it("returns text 429 when format is text", async () => {
    const store = new InMemoryRateLimitStore();
    const app = new Hono();
    app.post(
      "/login",
      createLoginRateLimitMiddleware(store, { format: "text" }),
      (c) => c.text("ok"),
    );

    for (let i = 0; i < LOGIN_IP_MAX; i++) {
      expect((await app.request("/login", { method: "POST" })).status).toBe(200);
    }
    const blocked = await app.request("/login", { method: "POST" });
    expect(blocked.status).toBe(429);
    expect(await blocked.text()).toBe("Too many requests");
  });
});

describe("checkLoginEmailRateLimit", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns false after the per-email budget is exhausted", async () => {
    const store = new InMemoryRateLimitStore();
    for (let i = 0; i < LOGIN_EMAIL_MAX; i++) {
      expect(await checkLoginEmailRateLimit(store, "ops@example.com", "127.0.0.1")).toBe(true);
    }
    expect(await checkLoginEmailRateLimit(store, "ops@example.com", "127.0.0.1")).toBe(false);
  });
});
