import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import { createRateLimitStore } from "../src/rate-limit/index.js";
import {
  createRequestLogMiddleware,
  redactRequestPath,
  resolveLogHttpRequests,
} from "../src/request-log.js";

function captureInfoLines(): string[] {
  const lines: string[] = [];
  vi.spyOn(console, "info").mockImplementation((line: string) => {
    lines.push(line);
  });
  return lines;
}

function appWithLogging(): Hono {
  const app = new Hono();
  app.use("*", createRequestLogMiddleware());
  app.get("/ok", (c) => c.text("ok"));
  app.get("/healthz", (c) => c.json({ status: "ok" }));
  app.get("/readyz", (c) => c.json({ status: "unavailable" }, 503));
  app.get("/boom", () => {
    throw new Error("handler failed");
  });
  return app;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("redactRequestPath", () => {
  it("redacts ticket and QR token paths", () => {
    expect(redactRequestPath("/t/abc123token")).toBe("/t/[redacted]");
    expect(redactRequestPath("/t/summit/a/agency-ref")).toBe("/t/[redacted]");
    expect(redactRequestPath("/q/abc123token.png")).toBe("/q/[redacted]");
  });

  it("leaves token-free paths unchanged", () => {
    expect(redactRequestPath("/login")).toBe("/login");
    expect(redactRequestPath("/api/admin/events")).toBe("/api/admin/events");
    expect(redactRequestPath("/")).toBe("/");
  });
});

describe("resolveLogHttpRequests", () => {
  it("is off by default and on for 1/true", () => {
    expect(resolveLogHttpRequests({} as NodeJS.ProcessEnv)).toBe(false);
    expect(resolveLogHttpRequests({ LOG_HTTP_REQUESTS: "0" } as NodeJS.ProcessEnv)).toBe(false);
    expect(resolveLogHttpRequests({ LOG_HTTP_REQUESTS: "1" } as NodeJS.ProcessEnv)).toBe(true);
    expect(resolveLogHttpRequests({ LOG_HTTP_REQUESTS: "true" } as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe("createRequestLogMiddleware", () => {
  it("logs one JSON line with method, path, status, duration", async () => {
    const lines = captureInfoLines();
    const res = await appWithLogging().request("/ok");
    expect(res.status).toBe(200);

    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(entry).toMatchObject({ msg: "http_request", method: "GET", path: "/ok", status: 200 });
    expect(typeof entry["duration_ms"]).toBe("number");
  });

  it("never logs query strings or token paths", async () => {
    const lines = captureInfoLines();
    const app = appWithLogging();
    app.get("/t/:token", (c) => c.text("ticket"));

    await app.request("/ok?email=user@example.com&next=%2Fadmin");
    await app.request("/t/secret-qr-token-value");

    expect(lines.join("\n")).not.toContain("email");
    expect(lines.join("\n")).not.toContain("secret-qr-token-value");
    const ticketEntry = JSON.parse(lines[1]!) as { path: string };
    expect(ticketEntry.path).toBe("/t/[redacted]");
  });

  it("skips successful health probes but logs failing ones", async () => {
    const lines = captureInfoLines();
    const app = appWithLogging();

    await app.request("/healthz");
    expect(lines).toHaveLength(0);

    await app.request("/readyz");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ path: "/readyz", status: 503 });
  });

  it("logs 404s for unknown routes", async () => {
    const lines = captureInfoLines();
    await appWithLogging().request("/nope");
    expect(JSON.parse(lines[0]!)).toMatchObject({ path: "/nope", status: 404 });
  });

  it("still logs when the handler throws", async () => {
    const lines = captureInfoLines();
    const res = await appWithLogging().request("/boom");
    expect(res.status).toBe(500);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ path: "/boom", status: 500 });
  });
});

describe("createApp logHttpRequests wiring", () => {
  function buildApp(logHttpRequests: boolean) {
    return createApp({
      prisma: { $queryRaw: vi.fn(async () => [{ "?column?": 1 }]) } as unknown as PrismaClient,
      baseUrl: "https://tickets.example.com",
      skipCheckinBootValidation: true,
      rateLimitStore: createRateLimitStore(),
      logHttpRequests,
    });
  }

  it("emits access-log lines when enabled, including 404s", async () => {
    const lines = captureInfoLines();
    await buildApp(true).request("/no-such-route");
    const accessLines = lines.filter((l) => l.includes("http_request"));
    expect(accessLines).toHaveLength(1);
    expect(JSON.parse(accessLines[0]!)).toMatchObject({ path: "/no-such-route", status: 404 });
  });

  it("stays silent when disabled (test/default behaviour)", async () => {
    const lines = captureInfoLines();
    await buildApp(false).request("/no-such-route");
    expect(lines.filter((l) => l.includes("http_request"))).toHaveLength(0);
  });
});
