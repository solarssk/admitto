import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import {
  createCheckinStreamConcurrencyLimit,
  resetCheckinStreamLimitsForTests,
} from "../src/checkin-stream-limit.js";

function sessionContext(userId: string) {
  return async (c: Context, next: Next): Promise<void> => {
    c.set("checkinAuth", "session");
    c.set("operatorUserId", userId);
    await next();
  };
}

describe("check-in stream concurrency limit", () => {
  it("returns 429 when operator exceeds parallel stream cap", async () => {
    resetCheckinStreamLimitsForTests();
    const app = new Hono();
    const gates: Array<() => void> = [];

    app.get(
      "/stream",
      sessionContext("op-stream"),
      createCheckinStreamConcurrencyLimit(),
      async () => {
        await new Promise<void>((resolve) => {
          gates.push(resolve);
        });
        return new Response("ok");
      },
    );

    const first = app.request("/stream");
    const second = app.request("/stream");
    const third = app.request("/stream");
    await Promise.resolve();

    const blocked = await app.request("/stream");
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "too_many_streams" });

    for (const release of gates) {
      release();
    }
    await first;
    await second;
    await third;
    resetCheckinStreamLimitsForTests();
  });
});
