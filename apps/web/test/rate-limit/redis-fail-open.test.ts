import { createServer, type Server, type Socket } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RedisRateLimitStore } from "../../src/rate-limit/redis.js";
import { createRateLimitStore } from "../../src/rate-limit/factory.js";
import { InMemoryRateLimitStore } from "../../src/rate-limit/in-memory.js";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";

const unreachableRedis = { connectTimeoutMs: 200 };

describe("RedisRateLimitStore fail-open", () => {
  beforeEach(() => {
    resetSystemLogBufferForTest();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const FALLBACK_WARN = "Rate limit Redis unavailable; falling back to per-process in-memory limiter";

  it("falls back to the local in-memory limiter when Redis is unreachable", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = new RedisRateLimitStore("redis://127.0.0.1:1", unreachableRedis);

    const result = await store.hit("1.2.3.4", 60_000, 60);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(59);
    expect(warnSpy).toHaveBeenCalledWith(FALLBACK_WARN);

    const entries = querySystemLogs({ source: "cache" });
    expect(entries.some((entry) => entry.message === FALLBACK_WARN)).toBe(true);

    await store.disconnect();
  });

  it("still enforces the limit during a Redis outage instead of allowing unlimited traffic", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = new RedisRateLimitStore("redis://127.0.0.1:1", unreachableRedis);

    expect((await store.hit("same-key", 60_000, 3)).allowed).toBe(true);
    expect((await store.hit("same-key", 60_000, 3)).allowed).toBe(true);
    expect((await store.hit("same-key", 60_000, 3)).allowed).toBe(true);
    const blocked = await store.hit("same-key", 60_000, 3);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);

    await store.disconnect();
  });

  it("keeps separate outage buckets per key, like the primary Redis path does", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = new RedisRateLimitStore("redis://127.0.0.1:1", unreachableRedis);

    await store.hit("key-a", 60_000, 1);
    const blockedA = await store.hit("key-a", 60_000, 1);
    expect(blockedA.allowed).toBe(false);

    const allowedB = await store.hit("key-b", 60_000, 1);
    expect(allowedB.allowed).toBe(true);

    await store.disconnect();
  });

  it("throttles fail-open warnings during repeated failures", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = new RedisRateLimitStore("redis://127.0.0.1:1", {
      ...unreachableRedis,
      outageCooldownMs: 1,
    });

    await store.hit("1.2.3.4", 60_000, 60);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await store.hit("1.2.3.4", 60_000, 60);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    await store.disconnect();
  });

  it("skips reconnect during outage cooldown", async () => {
    const store = new RedisRateLimitStore("redis://127.0.0.1:1", {
      connectTimeoutMs: 300,
      outageCooldownMs: 60_000,
    });

    await store.hit("1.2.3.4", 60_000, 60);
    const started = performance.now();
    const result = await store.hit("1.2.3.4", 60_000, 60);
    expect(result.allowed).toBe(true);
    expect(performance.now() - started).toBeLessThan(200);

    await store.disconnect();
  });

  it("rejects invalid timeout options", () => {
    expect(() => new RedisRateLimitStore("redis://localhost", { connectTimeoutMs: 0 })).toThrow(
      "connectTimeoutMs must be a positive number",
    );
    expect(() => new RedisRateLimitStore("redis://localhost", { commandTimeoutMs: -1 })).toThrow(
      "commandTimeoutMs must be a positive number",
    );
  });

  it("does not log Redis URL secrets on failure", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = new RedisRateLimitStore("redis://:supersecret@127.0.0.1:1", unreachableRedis);

    await store.hit("1.2.3.4", 60_000, 60);

    for (const call of warnSpy.mock.calls) {
      expect(String(call[0])).not.toContain("supersecret");
    }

    await store.disconnect();
  });
});

describe("RedisRateLimitStore with a Redis that accepts the socket and never answers", () => {
  let server: Server;
  let sockets: Socket[];
  let url: string;

  beforeEach(async () => {
    resetSystemLogBufferForTest();
    sockets = [];
    server = createServer((socket) => {
      sockets.push(socket);
      socket.on("error", () => {});
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no port");
    url = `redis://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const silentRedis = { connectTimeoutMs: 150, commandTimeoutMs: 150, outageCooldownMs: 50 };

  it("answers from the in-memory limiter within a second, again after the cooldown", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = new RedisRateLimitStore(url, silentRedis);

    const started = Date.now();
    const first = await store.hit("silent", 60_000, 5);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(4);

    await new Promise((resolve) => setTimeout(resolve, 100));
    const secondStarted = Date.now();
    const second = await store.hit("silent", 60_000, 5);
    expect(Date.now() - secondStarted).toBeLessThan(1_000);
    expect(second.remaining).toBe(3);
    expect(sockets.length).toBeGreaterThanOrEqual(2);

    await store.disconnect();
  });

  it("reports health as not ok within a second instead of hanging", async () => {
    const store = new RedisRateLimitStore(url, silentRedis);

    const started = Date.now();
    const health = await store.health();
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(health.ok).toBe(false);

    await store.disconnect();
  });
});

describe("createRateLimitStore", () => {
  it("uses in-memory when REDIS_URL is unset", () => {
    const store = createRateLimitStore({});
    expect(store).toBeInstanceOf(InMemoryRateLimitStore);
  });

  it("uses Redis when REDIS_URL is set", () => {
    const store = createRateLimitStore({ REDIS_URL: "redis://localhost:6379" });
    expect(store).toBeInstanceOf(RedisRateLimitStore);
  });

  it("uses in-memory in test env even when REDIS_URL is set", () => {
    const store = createRateLimitStore({
      REDIS_URL: "redis://localhost:6379",
      NODE_ENV: "test",
    });
    expect(store).toBeInstanceOf(InMemoryRateLimitStore);
  });
});
