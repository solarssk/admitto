import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { Context, Next } from "hono";
import {
  activeCheckinStreamActorCountForTests,
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

function bearerContext() {
  return async (c: Context, next: Next): Promise<void> => {
    c.set("checkinAuth", "bearer");
    await next();
  };
}

function anonymousIpContext() {
  return async (c: Context, next: Next): Promise<void> => {
    // Neither bearer nor a resolved operator user - the IP-only fallback branch.
    await next();
  };
}

describe("check-in stream concurrency limit", () => {
  it("holds slots until SSE disconnect and blocks a fourth parallel stream", async () => {
    resetCheckinStreamLimitsForTests();
    const app = new Hono();

    app.get(
      "/events/:eventId/stream",
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
      const res = await app.request("/events/evt-a/stream");
      expect(res.status).toBe(200);
      readers.push(res.body!.getReader());
    }

    expect(activeCheckinStreamCountForTests("checkin:stream:user:op-stream:event:evt-a")).toBe(3);

    const blocked = await app.request("/events/evt-a/stream");
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "too_many_streams" });

    // A stream for a different event under the same account has its own budget, not blocked by
    // evt-a's already-full 3 slots - the whole point of scoping this key per event.
    const otherEvent = await app.request("/events/evt-b/stream");
    expect(otherEvent.status).toBe(200);
    expect(activeCheckinStreamCountForTests("checkin:stream:user:op-stream:event:evt-b")).toBe(1);
    await otherEvent.body?.cancel();

    await readers[0]!.cancel();
    await new Promise((r) => setTimeout(r, 20));
    expect(activeCheckinStreamCountForTests("checkin:stream:user:op-stream:event:evt-a")).toBe(2);

    const reopened = await app.request("/events/evt-a/stream");
    expect(reopened.status).toBe(200);
    await reopened.body?.cancel();

    for (const reader of readers.slice(1)) {
      await reader.cancel();
    }
    resetCheckinStreamLimitsForTests();
  });

  it("caps total streams per actor across many distinct events, not just per event (bot review: bearer + made-up eventId)", async () => {
    resetCheckinStreamLimitsForTests();
    const app = new Hono();

    app.get(
      "/events/:eventId/stream",
      sessionContext("op-actor-cap"),
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

    // 3 slots each across 4 distinct events = 12, the actor-wide ceiling - well under any single
    // event's own per-event cap of 3, so only the actor-wide check can be what blocks the 13th.
    const readers = [];
    for (let e = 0; e < 4; e++) {
      for (let i = 0; i < 3; i++) {
        const res = await app.request(`/events/evt-actor-${e}/stream`);
        expect(res.status).toBe(200);
        readers.push(res.body!.getReader());
      }
    }
    expect(activeCheckinStreamActorCountForTests("checkin:stream:user:op-actor-cap")).toBe(12);

    // A 5th, completely fresh event id still gets rejected - the actor-wide budget is exhausted
    // even though this specific event has never been seen before (0 of its own 3 slots used).
    const blocked = await app.request("/events/evt-actor-fresh/stream");
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "too_many_streams" });
    expect(activeCheckinStreamCountForTests("checkin:stream:user:op-actor-cap:event:evt-actor-fresh")).toBe(0);

    for (const reader of readers) {
      await reader.cancel();
    }
    await new Promise((r) => setTimeout(r, 20));
    expect(activeCheckinStreamActorCountForTests("checkin:stream:user:op-actor-cap")).toBe(0);
    resetCheckinStreamLimitsForTests();
  });

  it("keys a bearer-authenticated stream by IP, not by operator user id", async () => {
    resetCheckinStreamLimitsForTests();
    const app = new Hono();
    app.get(
      "/events/:eventId/stream",
      bearerContext(),
      createCheckinStreamConcurrencyLimit(),
      (c) =>
        streamSSE(c, async (stream) => {
          await new Promise<void>((resolve) => stream.onAbort(resolve));
        }),
    );

    const res = await app.request("/events/evt-bearer/stream");
    expect(res.status).toBe(200);
    expect(activeCheckinStreamCountForTests("checkin:stream:bearer:ip:unknown:event:evt-bearer")).toBe(1);
    expect(activeCheckinStreamActorCountForTests("checkin:stream:bearer:ip:unknown")).toBe(1);
    await res.body?.cancel();
    resetCheckinStreamLimitsForTests();
  });

  it("falls back to a plain IP key when neither bearer auth nor an operator user id is present", async () => {
    resetCheckinStreamLimitsForTests();
    const app = new Hono();
    app.get(
      "/events/:eventId/stream",
      anonymousIpContext(),
      createCheckinStreamConcurrencyLimit(),
      (c) =>
        streamSSE(c, async (stream) => {
          await new Promise<void>((resolve) => stream.onAbort(resolve));
        }),
    );

    const res = await app.request("/events/evt-anon/stream");
    expect(res.status).toBe(200);
    expect(activeCheckinStreamCountForTests("checkin:stream:ip:unknown:event:evt-anon")).toBe(1);
    expect(activeCheckinStreamActorCountForTests("checkin:stream:ip:unknown")).toBe(1);
    await res.body?.cancel();
    resetCheckinStreamLimitsForTests();
  });

  it("releaseCheckinStreamSlot is a no-op when no slot was ever acquired on this context", async () => {
    resetCheckinStreamLimitsForTests();
    const app = new Hono();
    let releaseThrew = false;
    app.get("/events/:eventId/noop-release", sessionContext("op-noop"), (c) => {
      try {
        // Never went through createCheckinStreamConcurrencyLimit()/tryAcquireCheckinStreamSlot -
        // e.g. a request that errors out before reaching the limiter. Must not throw or touch
        // any counters.
        releaseCheckinStreamSlot(c);
      } catch {
        releaseThrew = true;
      }
      return c.text("ok");
    });

    await app.request("/events/evt-noop/noop-release");

    expect(releaseThrew).toBe(false);
    expect(activeCheckinStreamCountForTests("checkin:stream:user:op-noop:event:evt-noop")).toBe(0);
    expect(activeCheckinStreamActorCountForTests("checkin:stream:user:op-noop")).toBe(0);
  });
});
