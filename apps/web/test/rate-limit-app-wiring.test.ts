import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import { InMemoryRateLimitStore } from "../src/rate-limit/index.js";
import { RedisRateLimitStore } from "../src/rate-limit/redis.js";

function createMockPrisma(): PrismaClient {
  return {
    $queryRaw: vi.fn(async () => [{ "?column?": 1 }]),
  } as unknown as PrismaClient;
}

describe("createApp rate-limit wiring", () => {
  it("rate-limits /healthz through registry policy", async () => {
    const store = new InMemoryRateLimitStore();
    const app = createApp({
      prisma: createMockPrisma(),
      baseUrl: "https://tickets.example.com",
      skipCheckinBootValidation: true,
      rateLimitStore: store,
    });

    for (let i = 0; i < 120; i++) {
      expect((await app.request("/healthz")).status).toBe(200);
    }
    expect((await app.request("/healthz")).status).toBe(429);
  });

  it("rate-limits /readyz through registry policy", async () => {
    const store = new InMemoryRateLimitStore();
    const app = createApp({
      prisma: createMockPrisma(),
      baseUrl: "https://tickets.example.com",
      skipCheckinBootValidation: true,
      rateLimitStore: store,
      opsHealthToken: "test-readyz-token-32-characters!!",
    });

    for (let i = 0; i < 10; i++) {
      expect((await app.request("/readyz")).status).toBe(401);
    }
    expect((await app.request("/readyz")).status).toBe(429);
  });

  it("rate-limits /t through public:tq registry policy", async () => {
    const store = new InMemoryRateLimitStore();
    const app = createApp({
      prisma: createMockPrisma(),
      baseUrl: "https://tickets.example.com",
      skipCheckinBootValidation: true,
      rateLimitStore: store,
    });
    const headers = { "X-Forwarded-For": "203.0.113.77" };

    for (let i = 0; i < 60; i++) {
      expect((await app.request("/t/sample-token", { headers })).status).not.toBe(429);
    }
    const blocked = await app.request("/t/sample-token", { headers });
    expect(blocked.status).toBe(429);
    expect(await blocked.text()).toBe("Too Many Requests");
  });

  it("allows /t when Redis is unreachable (store fail-open)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = new RedisRateLimitStore("redis://127.0.0.1:1", { connectTimeoutMs: 200 });
    const app = createApp({
      prisma: createMockPrisma(),
      baseUrl: "https://tickets.example.com",
      skipCheckinBootValidation: true,
      rateLimitStore: store,
    });

    const res = await app.request("/t/sample-token", {
      headers: { "X-Forwarded-For": "203.0.113.88" },
    });
    expect(res.status).not.toBe(429);

    await store.disconnect();
    warnSpy.mockRestore();
  });
});
