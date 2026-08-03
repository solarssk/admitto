import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { PrismaClient } from "@admitto/db";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";
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

beforeEach(() => {
  resetSystemLogBufferForTest();
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

  it("skips successful polls of the System-logs live-tail endpoint but logs failures", async () => {
    const lines = captureInfoLines();
    const okApp = new Hono();
    okApp.use("*", createRequestLogMiddleware());
    okApp.get("/api/admin/system-logs", (c) => c.json({ entries: [] }));
    await okApp.request("/api/admin/system-logs");
    expect(lines).toHaveLength(0);

    const failApp = new Hono();
    failApp.use("*", createRequestLogMiddleware());
    failApp.get("/api/admin/system-logs", (c) => c.json({ error: "forbidden" }, 403));
    await failApp.request("/api/admin/system-logs");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ path: "/api/admin/system-logs", status: 403 });
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

describe("createApp global error handler", () => {
  it("records the matched route template without exception text", async () => {
    const error = new Error("ticket-token-123 and attendee@example.com must not be logged");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const app = createApp({
      prisma: { $queryRaw: vi.fn(async () => [{ "?column?": 1 }]) } as unknown as PrismaClient,
      baseUrl: "https://tickets.example.com",
      skipCheckinBootValidation: true,
      rateLimitStore: createRateLimitStore(),
      logHttpRequests: false,
    });
    app.get("/__test/events/:eventId/attendees/:attendeeId", () => {
      throw error;
    });

    const res = await app.request("/__test/events/event-secret/attendees/attendee-secret");

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal_error" });
    expect(querySystemLogs({ source: "api" })).toContainEqual(
      expect.objectContaining({
        level: "error",
        message: "unhandled_exception",
        fields: {
          method: "GET",
          path: "/__test/events/:eventId/attendees/:attendeeId",
          error_name: "Error",
        },
      }),
    );
    expect(errorSpy).toHaveBeenCalledWith("unhandled_exception:", error);
    expect(JSON.stringify(querySystemLogs())).not.toContain("ticket-token-123");
    expect(JSON.stringify(querySystemLogs())).not.toContain("attendee@example.com");
    expect(JSON.stringify(querySystemLogs())).not.toContain("event-secret");
    expect(JSON.stringify(querySystemLogs())).not.toContain("attendee-secret");
  });

  it("includes a stable error_code in System logs when the thrown error exposes one", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = Object.assign(new Error("smtp host blocked"), {
      name: "MailDestinationError",
      code: "mail_destination_blocked",
    });
    const app = createApp({
      prisma: { $queryRaw: vi.fn(async () => [{ "?column?": 1 }]) } as unknown as PrismaClient,
      baseUrl: "https://tickets.example.com",
      skipCheckinBootValidation: true,
      rateLimitStore: createRateLimitStore(),
      logHttpRequests: false,
    });
    app.get("/__test/mail-dest", () => {
      throw error;
    });

    const res = await app.request("/__test/mail-dest");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal_error" });
    expect(querySystemLogs({ source: "api" })).toContainEqual(
      expect.objectContaining({
        message: "unhandled_exception",
        fields: {
          method: "GET",
          path: "/__test/mail-dest",
          error_name: "MailDestinationError",
          error_code: "mail_destination_blocked",
        },
      }),
    );
  });

  it("omits error_code from System logs when the thrown error exposes a non-string code", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = Object.assign(new Error("provider failed"), { code: 535 });
    const app = createApp({
      prisma: { $queryRaw: vi.fn(async () => [{ "?column?": 1 }]) } as unknown as PrismaClient,
      baseUrl: "https://tickets.example.com",
      skipCheckinBootValidation: true,
      rateLimitStore: createRateLimitStore(),
      logHttpRequests: false,
    });
    app.get("/__test/numeric-code", () => {
      throw error;
    });

    const res = await app.request("/__test/numeric-code");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal_error" });
    expect(querySystemLogs({ source: "api" })).toContainEqual(
      expect.objectContaining({
        message: "unhandled_exception",
        fields: {
          method: "GET",
          path: "/__test/numeric-code",
          error_name: "Error",
        },
      }),
    );
  });

  it("uses a constant route label if Hono has no matched route", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const app = createApp({
      prisma: { $queryRaw: vi.fn(async () => [{ "?column?": 1 }]) } as unknown as PrismaClient,
      baseUrl: "https://tickets.example.com",
      skipCheckinBootValidation: true,
      rateLimitStore: createRateLimitStore(),
      logHttpRequests: false,
    });
    app.get("/__test/fallback/:attendeeId", (c) => {
      Object.defineProperty(c.req, "routePath", { value: "" });
      throw new Error("handler failed");
    });

    const res = await app.request("/__test/fallback/attendee-secret");

    expect(res.status).toBe(500);
    expect(querySystemLogs({ source: "api" })).toContainEqual(
      expect.objectContaining({
        message: "unhandled_exception",
        fields: { method: "GET", path: "/[unmatched]", error_name: "Error" },
      }),
    );
    expect(JSON.stringify(querySystemLogs())).not.toContain("attendee-secret");
  });

  it("preserves Hono HTTPException responses without recording an error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const app = createApp({
      prisma: { $queryRaw: vi.fn(async () => [{ "?column?": 1 }]) } as unknown as PrismaClient,
      baseUrl: "https://tickets.example.com",
      skipCheckinBootValidation: true,
      rateLimitStore: createRateLimitStore(),
      logHttpRequests: false,
    });
    app.get("/__test/http-exception", () => {
      throw new HTTPException(403, { message: "Forbidden" });
    });

    const res = await app.request("/__test/http-exception");

    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Forbidden");
    expect(querySystemLogs({ source: "api" })).toEqual([]);
  });
});
