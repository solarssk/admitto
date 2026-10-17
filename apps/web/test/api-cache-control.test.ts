import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { streamSSE } from "hono/streaming";
import type { PrismaClient } from "@admitto/db";
import { createApp } from "../src/app.js";

/**
 * Routes added after `createApp()` still run behind its `/api/*` middleware, so these probes show
 * what that middleware does to each kind of answer a handler can produce. The real routes are
 * covered against a database in `integration/api-cache-control.test.ts`.
 */
function buildApp() {
  const built = createApp({
    prisma: {} as unknown as PrismaClient,
    baseUrl: "https://tickets.example.com",
    skipCheckinBootValidation: true,
  });
  built.get("/api/probe/json", (c) => c.json({ ok: true }));
  built.get("/api/probe/own-header", (c) => {
    c.header("Cache-Control", "private, max-age=60");
    return c.json({ ok: true });
  });
  built.get("/api/probe/bare", () => new Response("plain"));
  built.get(
    "/api/probe/bare-own-header",
    () => new Response("plain", { headers: { "Cache-Control": "public, max-age=30" } }),
  );
  built.get("/api/probe/immutable-headers", () =>
    Response.redirect("https://tickets.example.com/elsewhere", 302),
  );
  built.get("/api/probe/stream", (c) =>
    streamSSE(c, async (stream) => {
      await stream.writeSSE({ data: "hello" });
    }),
  );
  built.get("/api/probe/throws", () => {
    throw new Error("probe failure");
  });
  return built;
}

let app: ReturnType<typeof buildApp>;

beforeAll(async () => {
  // The stub has no tables, so the start-up sweeps createApp() launches fail and log. Nothing here
  // reads what they would have loaded.
  const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
  app = buildApp();
  await new Promise((resolve) => setImmediate(resolve));
  quiet.mockRestore();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Cache-Control on /api answers", () => {
  it("adds no-store to a JSON answer that sets none", async () => {
    const res = await app.request("/api/probe/json");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("adds no-store to a bare Response that sets none", async () => {
    const res = await app.request("/api/probe/bare");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("adds no-store to a Response whose headers cannot be changed, and keeps the rest of it", async () => {
    const res = await app.request("/api/probe/immutable-headers");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://tickets.example.com/elsewhere");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("keeps the Cache-Control a handler sets itself", async () => {
    const res = await app.request("/api/probe/own-header");
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=60");
  });

  it("keeps the Cache-Control of a bare Response that sets its own", async () => {
    const res = await app.request("/api/probe/bare-own-header");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=30");
  });

  it("leaves an event stream with its own no-cache", async () => {
    const res = await app.request("/api/probe/stream");
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
    await res.body?.cancel();
  });

  it("adds no-store to the 500 answer for a handler that throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await app.request("/api/probe/throws");
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "internal_error" });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("adds no-store to the 404 answer for an unknown /api path", async () => {
    for (const path of ["/api/does-not-exist", "/api"]) {
      const res = await app.request(path);
      expect(res.status).toBe(404);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
    }
  });

  it("adds no-store to the 401 answer of a real staff route", async () => {
    const res = await app.request("/api/auth/me");
    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("keeps the baseline security headers next to it", async () => {
    const res = await app.request("/api/probe/json");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("does not touch answers outside /api that have their own rule", async () => {
    const res = await app.request("/robots.txt");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=86400");
  });
});
