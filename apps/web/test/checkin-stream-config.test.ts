import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { Context, Next } from "hono";
import {
  DEFAULT_CHECKIN_STREAM_LIMITS,
  resolveCheckinStreamLimits,
} from "../src/checkin-stream-config.js";
import { InMemoryRateLimitStore } from "../src/rate-limit/in-memory.js";

vi.mock("@hono/node-server/conninfo", () => ({
  getConnInfo: vi.fn(() => ({ remote: { address: "127.0.0.1", port: 1234 } })),
}));

const RATE_ENV_NAMES = [
  "CHECKIN_STREAM_RATE_LIMIT_PER_EVENT",
  "CHECKIN_STREAM_RATE_LIMIT_PER_ACTOR",
  "CHECKIN_STREAM_RATE_LIMIT_WINDOW_MS",
  "CHECKIN_STREAM_MAX_CONCURRENT_PER_EVENT",
  "CHECKIN_STREAM_MAX_CONCURRENT_PER_ACTOR",
] as const;

function sessionContext(userId: string) {
  return async (c: Context, next: Next): Promise<void> => {
    c.set("checkinAuth", "session");
    c.set("operatorUserId", userId);
    await next();
  };
}

describe("resolveCheckinStreamLimits", () => {
  it("ships the documented defaults: 120/240 requests per 60s, 3/12 concurrent streams", () => {
    expect(DEFAULT_CHECKIN_STREAM_LIMITS).toEqual({
      rateLimitPerEvent: 120,
      rateLimitPerActor: 240,
      rateLimitWindowMs: 60_000,
      maxConcurrentPerEvent: 3,
      maxConcurrentPerActor: 12,
    });
  });

  it("uses the defaults when no variable is set", () => {
    expect(resolveCheckinStreamLimits({})).toEqual(DEFAULT_CHECKIN_STREAM_LIMITS);
  });

  it("uses the defaults, without a warning, for blank values", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const limits = resolveCheckinStreamLimits({
      CHECKIN_STREAM_RATE_LIMIT_PER_EVENT: "",
      CHECKIN_STREAM_RATE_LIMIT_PER_ACTOR: "   ",
    });
    expect(limits).toEqual(DEFAULT_CHECKIN_STREAM_LIMITS);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("overrides each limit independently from its own variable", () => {
    const limits = resolveCheckinStreamLimits({
      CHECKIN_STREAM_RATE_LIMIT_PER_EVENT: "240",
      CHECKIN_STREAM_RATE_LIMIT_PER_ACTOR: "480",
      CHECKIN_STREAM_RATE_LIMIT_WINDOW_MS: "30000",
      CHECKIN_STREAM_MAX_CONCURRENT_PER_EVENT: "5",
      CHECKIN_STREAM_MAX_CONCURRENT_PER_ACTOR: "20",
    });
    expect(limits).toEqual({
      rateLimitPerEvent: 240,
      rateLimitPerActor: 480,
      rateLimitWindowMs: 30_000,
      maxConcurrentPerEvent: 5,
      maxConcurrentPerActor: 20,
    });

    expect(resolveCheckinStreamLimits({ CHECKIN_STREAM_MAX_CONCURRENT_PER_EVENT: "7" })).toEqual({
      ...DEFAULT_CHECKIN_STREAM_LIMITS,
      maxConcurrentPerEvent: 7,
    });
  });

  it("tolerates surrounding whitespace in a valid value", () => {
    expect(
      resolveCheckinStreamLimits({ CHECKIN_STREAM_RATE_LIMIT_PER_ACTOR: " 300 " }).rateLimitPerActor,
    ).toBe(300);
  });

  it.each([
    ["zero", "0"],
    ["negative", "-5"],
    ["NaN", "NaN"],
    ["fractional", "1.5"],
    ["trailing junk", "12abc"],
    ["garbage", "lots"],
    ["exponent", "1e3"],
    ["hex", "0x10"],
    ["Infinity", "Infinity"],
    ["explicit plus", "+5"],
    ["beyond safe integer", "9007199254740993"],
  ])("rejects a %s value and falls back to the default with a warning", (_label, raw) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (const name of RATE_ENV_NAMES) {
      warn.mockClear();
      const limits = resolveCheckinStreamLimits({ [name]: raw });
      expect(limits).toEqual(DEFAULT_CHECKIN_STREAM_LIMITS);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toContain(name);
    }
    warn.mockRestore();
  });

  it("keeps a valid sibling value when another variable is invalid", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const limits = resolveCheckinStreamLimits({
      CHECKIN_STREAM_RATE_LIMIT_PER_EVENT: "0",
      CHECKIN_STREAM_RATE_LIMIT_PER_ACTOR: "500",
    });
    expect(limits.rateLimitPerEvent).toBe(DEFAULT_CHECKIN_STREAM_LIMITS.rateLimitPerEvent);
    expect(limits.rateLimitPerActor).toBe(500);
    warn.mockRestore();
  });
});

/** The limits are resolved once when the modules first load, i.e. at app start. These tests
 * re-import the real modules under a stubbed environment, exactly like a container restart with
 * a changed variable and no rebuild. */
describe("ENV-configured limits are applied at startup", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("registers the checkin:stream policy with the default budgets when ENV is unset", async () => {
    for (const name of RATE_ENV_NAMES) vi.stubEnv(name, "");
    vi.resetModules();
    const { RATE_POLICIES } = await import("../src/rate-limit/policies.js");

    const checks = RATE_POLICIES["checkin:stream"].checks;
    expect(checks.map((c) => c.max)).toEqual([120, 240]);
    expect(checks.map((c) => c.windowMs)).toEqual([60_000, 60_000]);
  });

  it("registers the checkin:stream policy from CHECKIN_STREAM_RATE_LIMIT_* variables", async () => {
    vi.stubEnv("CHECKIN_STREAM_RATE_LIMIT_PER_EVENT", "3");
    vi.stubEnv("CHECKIN_STREAM_RATE_LIMIT_PER_ACTOR", "5");
    vi.stubEnv("CHECKIN_STREAM_RATE_LIMIT_WINDOW_MS", "15000");
    vi.resetModules();
    const { RATE_POLICIES } = await import("../src/rate-limit/policies.js");

    const checks = RATE_POLICIES["checkin:stream"].checks;
    expect(checks.map((c) => c.max)).toEqual([3, 5]);
    expect(checks.map((c) => c.windowMs)).toEqual([15_000, 15_000]);
  });

  it("still answers 429 once a configured request budget is exceeded, per event and actor-wide", async () => {
    vi.stubEnv("CHECKIN_STREAM_RATE_LIMIT_PER_EVENT", "3");
    vi.stubEnv("CHECKIN_STREAM_RATE_LIMIT_PER_ACTOR", "5");
    vi.resetModules();
    const { rateLimit } = await import("../src/rate-limit/policies.js");

    const app = new Hono();
    app.get(
      "/api/checkin/events/:eventId/stream",
      sessionContext("op-env-rl"),
      rateLimit(new InMemoryRateLimitStore(), "checkin:stream"),
      (c) => c.json({ ok: true }, 200),
    );

    for (let i = 0; i < 3; i++) {
      expect((await app.request("/api/checkin/events/evt-a/stream")).status).toBe(200);
    }
    // Per-event budget (3) exhausted for evt-a...
    expect((await app.request("/api/checkin/events/evt-a/stream")).status).toBe(429);
    // ...but a different event has its own budget until the actor-wide one (5) runs out.
    for (let i = 0; i < 2; i++) {
      expect((await app.request("/api/checkin/events/evt-b/stream")).status).toBe(200);
    }
    expect((await app.request("/api/checkin/events/evt-b/stream")).status).toBe(429);
  });

  it("falls back to the default request budget when CHECKIN_STREAM_RATE_LIMIT_PER_EVENT is invalid", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubEnv("CHECKIN_STREAM_RATE_LIMIT_PER_EVENT", "0");
    vi.resetModules();
    const { RATE_POLICIES } = await import("../src/rate-limit/policies.js");

    expect(RATE_POLICIES["checkin:stream"].checks[0]!.max).toBe(120);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("CHECKIN_STREAM_RATE_LIMIT_PER_EVENT"));
    warn.mockRestore();
  });

  it("builds the concurrency limiter from CHECKIN_STREAM_MAX_CONCURRENT_* variables", async () => {
    vi.stubEnv("CHECKIN_STREAM_MAX_CONCURRENT_PER_EVENT", "1");
    vi.stubEnv("CHECKIN_STREAM_MAX_CONCURRENT_PER_ACTOR", "2");
    vi.resetModules();
    const limit = await import("../src/checkin-stream-limit.js");
    limit.resetCheckinStreamLimitsForTests();

    const app = new Hono();
    app.get(
      "/events/:eventId/stream",
      sessionContext("op-env-conc"),
      limit.createCheckinStreamConcurrencyLimit(),
      (c) =>
        streamSSE(c, async (stream) => {
          await new Promise<void>((resolve) => {
            stream.onAbort(() => {
              limit.releaseCheckinStreamSlot(c);
              resolve();
            });
          });
        }),
    );

    const first = await app.request("/events/evt-a/stream");
    expect(first.status).toBe(200);
    // Per-event ceiling of 1 reached for evt-a.
    const secondSameEvent = await app.request("/events/evt-a/stream");
    expect(secondSameEvent.status).toBe(429);
    expect(await secondSameEvent.json()).toEqual({ error: "too_many_streams" });

    const otherEvent = await app.request("/events/evt-b/stream");
    expect(otherEvent.status).toBe(200);
    // Actor-wide ceiling of 2 reached, so even a brand-new event is refused.
    expect((await app.request("/events/evt-c/stream")).status).toBe(429);

    await first.body?.cancel();
    await otherEvent.body?.cancel();
    await new Promise((r) => setTimeout(r, 20));
    limit.resetCheckinStreamLimitsForTests();
  });
});

describe("concurrency limiter with explicit limits", () => {
  it("uses the limits it is given instead of the process defaults", async () => {
    const limit = await import("../src/checkin-stream-limit.js");
    limit.resetCheckinStreamLimitsForTests();

    const app = new Hono();
    app.get(
      "/events/:eventId/stream",
      sessionContext("op-explicit"),
      limit.createCheckinStreamConcurrencyLimit({ maxConcurrentPerEvent: 2, maxConcurrentPerActor: 3 }),
      (c) =>
        streamSSE(c, async (stream) => {
          await new Promise<void>((resolve) => {
            stream.onAbort(() => {
              limit.releaseCheckinStreamSlot(c);
              resolve();
            });
          });
        }),
    );

    const open = [
      await app.request("/events/evt-a/stream"),
      await app.request("/events/evt-a/stream"),
    ];
    expect(open.map((r) => r.status)).toEqual([200, 200]);
    expect((await app.request("/events/evt-a/stream")).status).toBe(429);

    const third = await app.request("/events/evt-b/stream");
    expect(third.status).toBe(200);
    expect((await app.request("/events/evt-c/stream")).status).toBe(429);

    for (const res of [...open, third]) await res.body?.cancel();
    await new Promise((r) => setTimeout(r, 20));
    expect(limit.activeCheckinStreamActorCountForTests("checkin:stream:user:op-explicit")).toBe(0);
    limit.resetCheckinStreamLimitsForTests();
  });
});
