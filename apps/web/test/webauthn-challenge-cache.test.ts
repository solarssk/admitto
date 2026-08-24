import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WEBAUTHN_CHALLENGE_TTL_MS } from "@admitto/auth/constants";
import {
  clearWebauthnChallenge,
  clearWebauthnChallengeCacheForTests,
  consumeWebauthnChallenge,
  stashWebauthnChallenge,
} from "../src/auth/webauthn-challenge-cache.js";

describe("webauthn-challenge-cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearWebauthnChallengeCacheForTests();
  });

  afterEach(() => {
    clearWebauthnChallengeCacheForTests();
    vi.useRealTimers();
  });

  it("stashes and consumes a challenge exactly once", () => {
    stashWebauthnChallenge("register", "sess-1", "challenge-a");
    expect(consumeWebauthnChallenge("register", "sess-1")).toBe("challenge-a");
    expect(consumeWebauthnChallenge("register", "sess-1")).toBeUndefined();
  });

  it("returns undefined consuming a session with nothing stashed", () => {
    expect(consumeWebauthnChallenge("assert", "no-such-session")).toBeUndefined();
  });

  it("keeps register and assert challenges for the same session independent", () => {
    stashWebauthnChallenge("register", "sess-1", "register-challenge");
    stashWebauthnChallenge("assert", "sess-1", "assert-challenge");

    expect(consumeWebauthnChallenge("register", "sess-1")).toBe("register-challenge");
    expect(consumeWebauthnChallenge("assert", "sess-1")).toBe("assert-challenge");
  });

  it("expires a stashed challenge once its TTL elapses", () => {
    stashWebauthnChallenge("register", "sess-1", "challenge-a");
    vi.advanceTimersByTime(WEBAUTHN_CHALLENGE_TTL_MS + 1);

    expect(consumeWebauthnChallenge("register", "sess-1")).toBeUndefined();
  });

  it("reschedules expiry when the same purpose/session is re-stashed", () => {
    stashWebauthnChallenge("register", "sess-1", "challenge-a");
    vi.advanceTimersByTime(WEBAUTHN_CHALLENGE_TTL_MS - 1_000);
    stashWebauthnChallenge("register", "sess-1", "challenge-b");

    vi.advanceTimersByTime(2_000);
    expect(consumeWebauthnChallenge("register", "sess-1")).toBe("challenge-b");
  });

  it("clearWebauthnChallenge discards an in-flight challenge before it's consumed", () => {
    stashWebauthnChallenge("register", "sess-1", "challenge-a");
    clearWebauthnChallenge("register", "sess-1");

    expect(consumeWebauthnChallenge("register", "sess-1")).toBeUndefined();
  });

  it("clearWebauthnChallenge on a session with nothing stashed is a no-op", () => {
    expect(() => clearWebauthnChallenge("assert", "no-such-session")).not.toThrow();
  });

  it("clearWebauthnChallengeCacheForTests cancels a still-pending timer for an unconsumed challenge", () => {
    stashWebauthnChallenge("register", "sess-1", "challenge-a");
    clearWebauthnChallengeCacheForTests();

    expect(consumeWebauthnChallenge("register", "sess-1")).toBeUndefined();
  });

  it("a later stash sweeps another session's entry that's expired but whose own timer hasn't fired yet", () => {
    stashWebauthnChallenge("register", "sess-1", "challenge-a");
    // Move the clock past expiry without letting the timer queue run, so sess-1's entry is stale
    // by `Date.now()` but still sitting in the cache - only `sweepExpired()`'s own expiry check
    // (not the timer callback) can be what clears it below.
    vi.setSystemTime(Date.now() + WEBAUTHN_CHALLENGE_TTL_MS + 1);

    stashWebauthnChallenge("register", "sess-2", "challenge-b");
    expect(consumeWebauthnChallenge("register", "sess-1")).toBeUndefined();
    expect(consumeWebauthnChallenge("register", "sess-2")).toBe("challenge-b");
  });
});
