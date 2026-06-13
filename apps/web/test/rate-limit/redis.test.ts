import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "redis";
import { RedisRateLimitStore } from "../../src/rate-limit/redis.js";
import { redisKeyForHit } from "../../src/rate-limit/redis-keys.js";

const redisUrl = process.env.REDIS_URL;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe.skipIf(!redisUrl)("RedisRateLimitStore", () => {
  const store = new RedisRateLimitStore(redisUrl!);
  const rawClient = createClient({ url: redisUrl! });

  beforeAll(async () => {
    await rawClient.connect();
  });

  afterAll(async () => {
    try {
      await store.disconnect();
    } catch {
      // ignore — connection may never have succeeded
    }
    try {
      if (rawClient.isOpen) {
        await rawClient.quit();
      }
    } catch {
      // ignore
    }
  });

  it("blocks when limit exceeded", async () => {
    const key = `test-block-${Date.now()}`;
    for (let i = 0; i < 60; i++) {
      const result = await store.hit(key, 60_000, 60);
      expect(result.allowed).toBe(true);
    }
    const blocked = await store.hit(key, 60_000, 60);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("expires key after window via PEXPIRE", async () => {
    const key = `test-ttl-${Date.now()}`;
    const windowMs = 500;

    const first = await store.hit(key, windowMs, 1);
    expect(first.allowed).toBe(true);
    const redisKey = redisKeyForHit(key, windowMs, first.resetAt - 1);

    const pttl = await rawClient.pTTL(redisKey);
    expect(pttl).toBeGreaterThan(0);
    expect(pttl).toBeLessThanOrEqual(windowMs);

    await sleep(700);

    const exists = await rawClient.exists(redisKey);
    expect(exists).toBe(0);

    const afterExpiry = await store.hit(key, windowMs, 1);
    expect(afterExpiry.allowed).toBe(true);
  });
});
