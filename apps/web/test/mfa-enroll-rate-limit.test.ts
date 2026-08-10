import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { SESSION_STAGE } from "@admitto/auth";
import { InMemoryRateLimitStore } from "../src/rate-limit/in-memory.js";
import {
  createAccountMfaEnrollRateLimitMiddleware,
  createMfaEnrollRateLimitMiddleware,
} from "../src/auth/mfa-rate-limit.js";

const ENROLL_MAX = 10;

type AuthVars = {
  Variables: {
    auth?: { sessionId?: string };
    partialAuth: { sessionId: string; userId: string; stage: string };
  };
};

describe("createAccountMfaEnrollRateLimitMiddleware", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns JSON 401 when the full session is missing", async () => {
    const store = new InMemoryRateLimitStore();
    const app = new Hono<AuthVars>();
    app.post(
      "/api/account/mfa/enroll",
      createAccountMfaEnrollRateLimitMiddleware(store),
      (c) => c.json({ ok: true }),
    );
    const res = await app.request("/api/account/mfa/enroll", { method: "POST" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("returns text 401 when format is text and session is missing", async () => {
    const store = new InMemoryRateLimitStore();
    const app = new Hono<AuthVars>();
    app.post(
      "/mfa/enroll/start",
      createAccountMfaEnrollRateLimitMiddleware(store, { format: "text" }),
      (c) => c.text("ok"),
    );
    const res = await app.request("/mfa/enroll/start", { method: "POST" });
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Unauthorized");
  });

  it("returns JSON 429 when the session enroll budget is exhausted", async () => {
    const store = new InMemoryRateLimitStore();
    const app = new Hono<AuthVars>();
    app.use("*", async (c, next) => {
      c.set("auth", { sessionId: "sess-account" });
      await next();
    });
    app.post(
      "/api/account/mfa/enroll",
      createAccountMfaEnrollRateLimitMiddleware(store),
      (c) => c.json({ ok: true }),
    );

    for (let i = 0; i < ENROLL_MAX; i++) {
      expect((await app.request("/api/account/mfa/enroll", { method: "POST" })).status).toBe(200);
    }
    const blocked = await app.request("/api/account/mfa/enroll", { method: "POST" });
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "too many requests" });
  });

  it("returns text 429 for IP budget exhaustion when format is text", async () => {
    const store = new InMemoryRateLimitStore();
    // Hono app.request() has no socket peer, so resolveClientIp falls back to "unknown".
    for (let i = 0; i < ENROLL_MAX; i++) {
      await store.hit(`mfa:enroll:ip:unknown`, 15 * 60_000, ENROLL_MAX);
    }
    const app = new Hono<AuthVars>();
    app.use("*", async (c, next) => {
      c.set("auth", { sessionId: "sess-other" });
      await next();
    });
    app.post(
      "/mfa/enroll/start",
      createAccountMfaEnrollRateLimitMiddleware(store, { format: "text" }),
      (c) => c.text("ok"),
    );
    const blocked = await app.request("/mfa/enroll/start", { method: "POST" });
    expect(blocked.status).toBe(429);
    expect(await blocked.text()).toBe("Too many requests");
  });
});

describe("createMfaEnrollRateLimitMiddleware", () => {
  it("returns JSON 429 when the partial-session enroll budget is exhausted", async () => {
    const store = new InMemoryRateLimitStore();
    const app = new Hono<AuthVars>();
    app.use("*", async (c, next) => {
      c.set("partialAuth", {
        sessionId: "partial-1",
        userId: "u1",
        stage: SESSION_STAGE.ENROLLMENT_REQUIRED,
      });
      await next();
    });
    app.post(
      "/mfa/enroll/start",
      createMfaEnrollRateLimitMiddleware(store),
      (c) => c.json({ ok: true }),
    );

    for (let i = 0; i < ENROLL_MAX; i++) {
      expect((await app.request("/mfa/enroll/start", { method: "POST" })).status).toBe(200);
    }
    const blocked = await app.request("/mfa/enroll/start", { method: "POST" });
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "too many requests" });
  });

  it("returns text 429 for IP budget when format is text", async () => {
    const store = new InMemoryRateLimitStore();
    for (let i = 0; i < ENROLL_MAX; i++) {
      await store.hit(`mfa:enroll:ip:unknown`, 15 * 60_000, ENROLL_MAX);
    }
    const app = new Hono<AuthVars>();
    app.use("*", async (c, next) => {
      c.set("partialAuth", {
        sessionId: "partial-2",
        userId: "u1",
        stage: SESSION_STAGE.ENROLLMENT_REQUIRED,
      });
      await next();
    });
    app.post(
      "/mfa/enroll/start",
      createMfaEnrollRateLimitMiddleware(store, { format: "text" }),
      (c) => c.text("ok"),
    );
    const blocked = await app.request("/mfa/enroll/start", { method: "POST" });
    expect(blocked.status).toBe(429);
    expect(await blocked.text()).toBe("Too many requests");
  });
});
