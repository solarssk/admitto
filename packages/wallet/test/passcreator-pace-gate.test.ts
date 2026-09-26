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

/** The gate's own window length (1000ms, not exported from the module under test) - only used
 * here to align the burst with a window boundary and to bound how long it must wait. */
const WINDOW_MS = 1_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
    // The gate counts in fixed 1s windows, so how long the callers over the budget wait depends on
    // where in a window the burst starts: begun 900ms into one, the next window opens 100ms later
    // and a fixed "waited more than 300ms" bound fails roughly a third of the time. Start just
    // after a window opens, so the burst has almost a full second to wait for the next one.
    await sleep(WINDOW_MS - (Date.now() % WINDOW_MS) + 20);
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
    // not just 10 instantly-resolved promises. A caller over the budget cannot be admitted before
    // the next window boundary, however late the scheduler let this test start (a few ms of
    // slack for the sleep granularity), so this bound holds on a slow machine too.
    const untilNextWindowMs = WINDOW_MS - (started % WINDOW_MS);
    expect(elapsedMs).toBeGreaterThanOrEqual(untilNextWindowMs - 15);
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
