import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";

function createMockPrisma(queryRaw: () => Promise<unknown>): PrismaClient {
  return {
    $queryRaw: vi.fn(queryRaw),
  } as unknown as PrismaClient;
}

describe("GET /healthz", () => {
  it("returns 200 when the database responds", async () => {
    const app = createApp({
      prisma: createMockPrisma(async () => [{ "?column?": 1 }]),
      baseUrl: "https://tickets.example.com",
      skipCheckinBootValidation: true,
    });

    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "ok" });
  });

  it("returns 503 when the database is unavailable", async () => {
    const app = createApp({
      prisma: createMockPrisma(async () => {
        throw new Error("connection refused");
      }),
      baseUrl: "https://tickets.example.com",
      skipCheckinBootValidation: true,
    });

    const res = await app.request("/healthz");
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ status: "unavailable" });
  });
});
