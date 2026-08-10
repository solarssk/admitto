import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "redis";
import {
  publish,
  resetSseChannelsForTests,
  shouldUseRedisSse,
  subscribe,
} from "../../src/admin/sse-channel.js";
import { sseChannelName } from "@admitto/shared/sse-events";

const redisUrl = process.env.REDIS_URL;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(assertion: () => void, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      assertion();
      return;
    } catch (err) {
      if (Date.now() >= deadline) throw err;
      await sleep(20);
    }
  }
}

describe("shouldUseRedisSse", () => {
  it("is false under NODE_ENV=test even with REDIS_URL set (matches createRateLimitStore's own test gate)", () => {
    expect(shouldUseRedisSse({ NODE_ENV: "test", REDIS_URL: "redis://localhost:6379" })).toBe(false);
  });

  it("is false without REDIS_URL", () => {
    expect(shouldUseRedisSse({ NODE_ENV: "production" })).toBe(false);
    expect(shouldUseRedisSse({ NODE_ENV: "production", REDIS_URL: "  " })).toBe(false);
  });

  it("is true outside test with REDIS_URL set", () => {
    expect(shouldUseRedisSse({ NODE_ENV: "production", REDIS_URL: "redis://localhost:6379" })).toBe(true);
  });
});

// Forces the module's own env gate open for these tests only - everything else in the suite runs
// under vitest's default NODE_ENV=test, which must keep sse-channel entirely in-process (asserted
// above). Skips outright where no real Redis is configured, same as RedisRateLimitStore's own
// integration test.
describe.skipIf(!redisUrl)("sse-channel Redis fan-out", () => {
  const rawClient = createClient({ url: redisUrl! });

  beforeAll(async () => {
    await rawClient.connect();
  });

  afterAll(async () => {
    if (rawClient.isOpen) await rawClient.quit();
  });

  afterEach(() => {
    resetSseChannelsForTests();
    vi.unstubAllEnvs();
  });

  it("delivers a message PUBLISHed directly to Redis (simulating the worker process) to a local subscriber", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("REDIS_URL", redisUrl!);

    const eventId = `evt-sse-redis-${Date.now()}`;
    const received: unknown[] = [];
    subscribe(eventId, (event) => received.push(event));

    // Give the module's lazy Redis subscriber time to connect and PSUBSCRIBE before the raw
    // client publishes - subscribe() only kicks off the connection, it doesn't await it, and
    // there's no readiness hook exposed to poll instead.
    await sleep(300);

    await rawClient.publish(sseChannelName(eventId), JSON.stringify({ type: "activity_changed" }));

    await waitFor(() => {
      expect(received).toEqual([{ type: "activity_changed" }]);
    });
  });

  it("publish() round-trips through Redis to reach a local subscriber in the same process", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("REDIS_URL", redisUrl!);

    const eventId = `evt-sse-redis-local-${Date.now()}`;
    const received: unknown[] = [];
    subscribe(eventId, (event) => received.push(event));
    await sleep(300);

    publish(eventId, { type: "activity_changed" });

    await waitFor(() => {
      expect(received).toEqual([{ type: "activity_changed" }]);
    });
  });
});
