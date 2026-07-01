import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { Context, Next } from "hono";
import {
  activeCheckinStreamCountForTests,
  createCheckinStreamConcurrencyLimit,
  releaseCheckinStreamSlot,
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
  it("holds slots until SSE disconnect and blocks a fourth parallel stream", async () => {
    resetCheckinStreamLimitsForTests();
    const app = new Hono();

    app.get(
      "/stream",
      sessionContext("op-stream"),
      createCheckinStreamConcurrencyLimit(),
      (c) =>
        streamSSE(c, async (stream) => {
          await new Promise<void>((resolve) => {
            stream.onAbort(() => {
              releaseCheckinStreamSlot(c);
              resolve();
            });
          });
        }),
    );

    const readers = [];
    for (let i = 0; i < 3; i++) {
      const res = await app.request("/stream");
      expect(res.status).toBe(200);
      readers.push(res.body!.getReader());
    }

    expect(activeCheckinStreamCountForTests("checkin:stream:user:op-stream")).toBe(3);

    const blocked = await app.request("/stream");
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "too_many_streams" });

    await readers[0]!.cancel();
    await new Promise((r) => setTimeout(r, 20));
    expect(activeCheckinStreamCountForTests("checkin:stream:user:op-stream")).toBe(2);

    const reopened = await app.request("/stream");
    expect(reopened.status).toBe(200);
    await reopened.body?.cancel();

    for (const reader of readers.slice(1)) {
      await reader.cancel();
    }
    resetCheckinStreamLimitsForTests();
  });
});
