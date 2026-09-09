import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "redis";
import {
  publish,
  resetSseChannelsForTests,
  shouldUseRedisSse,
  subscribe,
  waitForSseRedisReadyForTests,
} from "../../src/admin/sse-channel.js";
import { sseChannelName } from "@admitto/shared/sse-events";

const redisUrl = process.env.REDIS_URL;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 8s, not 2s: this polls for a real Redis round-trip (connect + pub/sub), which shares the host
// machine with every other Vitest project running in the same full-suite invocation (this file's
// own "integration" project stays maxWorkers: 1, but a full `npm test` run also spins up
// web-unit's parallel workers alongside it) - under that combined load, connect/command latency
// can legitimately exceed a couple of seconds without anything actually being broken.
async function waitFor(assertion: () => void, timeoutMs = 8_000): Promise<void> {
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

  it("allows local Compose Redis but requires TLS for a remote Redis host", () => {
    expect(shouldUseRedisSse({ NODE_ENV: "production", REDIS_URL: "redis://redis:6379" })).toBe(true);
    expect(shouldUseRedisSse({ NODE_ENV: "production", REDIS_URL: "redis://redis.example.com:6379" })).toBe(false);
    expect(shouldUseRedisSse({ NODE_ENV: "production", REDIS_URL: "rediss://redis.example.com:6379" })).toBe(true);
    expect(shouldUseRedisSse({ NODE_ENV: "production", REDIS_URL: "https://redis.example.com" })).toBe(false);
    expect(shouldUseRedisSse({ NODE_ENV: "production", REDIS_URL: "not a URL" })).toBe(false);
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

  it(
    "delivers a message PUBLISHed directly to Redis (simulating the worker process) to a local subscriber",
    async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("REDIS_URL", redisUrl!);

      const eventId = `evt-sse-redis-${Date.now()}`;
      const received: unknown[] = [];
      subscribe(eventId, (event) => received.push(event));

      await expect(waitForSseRedisReadyForTests()).resolves.toBe(true);

      await rawClient.publish(sseChannelName(eventId), JSON.stringify({ type: "activity_changed" }));

      await waitFor(() => {
        expect(received).toEqual([{ type: "activity_changed" }]);
      });
    },
    // Above Vitest's 5s default: connect (up to CONNECT_TIMEOUT_MS) plus this file's own 8s
    // waitFor budget can legitimately exceed 5s under a full-suite run's combined worker load -
    // see waitFor's own comment.
    15_000,
  );

  it(
    "publish() round-trips through Redis to reach a local subscriber in the same process",
    async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("REDIS_URL", redisUrl!);

      const eventId = `evt-sse-redis-local-${Date.now()}`;
      const received: unknown[] = [];
      const receivedByRedis: string[] = [];
      subscribe(eventId, (event) => received.push(event));
      await expect(waitForSseRedisReadyForTests()).resolves.toBe(true);
      await rawClient.pSubscribe(sseChannelName(eventId), (message) => receivedByRedis.push(message));

      publish(eventId, { type: "activity_changed" });

      await waitFor(() => {
        expect(received).toEqual([{ type: "activity_changed" }]);
        expect(receivedByRedis).toEqual([JSON.stringify({ type: "activity_changed" })]);
      });
      await rawClient.pUnsubscribe(sseChannelName(eventId));
    },
    // See the previous test's matching comment.
    15_000,
  );
});
