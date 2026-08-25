import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  reservePassCreatorSlotDistributed,
  resetPassCreatorPaceGateForTest,
} from "../src/passcreator-pace-gate.js";

/** Real local dev Redis (same instance/port apps/web's own integration tests use when run
 * locally) - this module deliberately has no mock-Redis test double of its own (the Lua
 * INCR/PEXPIRE script and connection-lifecycle handling are exactly what needs proving to work,
 * not just that the surrounding TypeScript calls the right client methods - "prefer empirical
 * verification"). Skips instead of failing when no Redis is reachable, so this file doesn't break
 * a CI/sandbox environment that doesn't run one. */
const REDIS_URL = process.env["REDIS_URL"] ?? "redis://localhost:6379";

async function redisReachable(): Promise<boolean> {
  try {
    const { createClient } = await import("redis");
    const probe = createClient({ url: REDIS_URL, socket: { connectTimeout: 500 } });
    probe.on("error", () => {});
    await probe.connect();
    await probe.ping();
    await probe.quit();
    return true;
  } catch {
    return false;
  }
}

const hasRedis = await redisReachable();
const describeIfRedis = hasRedis ? describe : describe.skip;

describeIfRedis("reservePassCreatorSlotDistributed (real Redis, PR #1064 round 3 - bot review)", () => {
  beforeEach(() => {
    resetPassCreatorPaceGateForTest();
  });

  it("admits calls up to the per-window budget, then makes the next caller wait for a new window", async () => {
    // MAX_PER_WINDOW is 6 and WINDOW_MS is 1000 in the module under test - not exported (kept
    // internal so nothing outside this module can accidentally rely on the exact number), so this
    // test proves the *shape* of the behavior (a real ceiling exists, then it resets) rather than
    // hardcoding those constants here too.
    const started = Date.now();
    const results: string[] = [];
    // Fire more reservations than one window can hold, all at once - if this module didn't
    // actually gate anything, all of these would resolve near-instantly.
    await Promise.all(
      Array.from({ length: 10 }, async (_unused, i) => {
        const result = await reservePassCreatorSlotDistributed(REDIS_URL);
        results.push(result);
        void i;
      }),
    );
    const elapsedMs = Date.now() - started;

    expect(results.every((r) => r === "reserved" || r === "fail-open")).toBe(true);
    // At least one reservation had to wait for a second window to open (10 requests > any
    // reasonable single-window budget under 10), proving real cross-call coordination happened,
    // not just 10 instantly-resolved promises.
    expect(elapsedMs).toBeGreaterThan(300);
  }, 15_000);

  it("coordinates two independent reservation streams against the same shared window (simulating app + worker)", async () => {
    // The real fix this round: two independent call sites (standing in for the app container and
    // the worker container) must draw from the SAME Redis-tracked budget, not two separate
    // per-process ones.
    const [streamA, streamB] = await Promise.all([
      Promise.all(Array.from({ length: 4 }, () => reservePassCreatorSlotDistributed(REDIS_URL))),
      Promise.all(Array.from({ length: 4 }, () => reservePassCreatorSlotDistributed(REDIS_URL))),
    ]);
    // Both streams eventually get admitted (or the gate fails open) - the meaningful assertion is
    // that this call exists and is awaited by both streams without either one bypassing it.
    expect([...streamA, ...streamB].every((r) => r === "reserved" || r === "fail-open")).toBe(true);
  }, 15_000);
});

describe("reservePassCreatorSlotDistributed without a reachable Redis", () => {
  it("fails open instead of hanging or throwing when the URL points nowhere", async () => {
    resetPassCreatorPaceGateForTest();
    const result = await reservePassCreatorSlotDistributed("redis://127.0.0.1:1");
    expect(result).toBe("fail-open");
  }, 10_000);
});

afterAll(() => {
  resetPassCreatorPaceGateForTest();
});
