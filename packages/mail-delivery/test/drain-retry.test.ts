import { describe, expect, it } from "vitest";
import {
  MAIL_DRAIN_BACKOFF_BASE_MS,
  MAIL_DRAIN_BACKOFF_CAP_MS,
  MAX_MAIL_DRAIN_ATTEMPTS,
  isMailDrainAttemptsExhausted,
  isMailDrainRetryDue,
  mailDrainRetryBackoffMs,
  nextMailDrainAttempts,
} from "../src/drain-retry.js";

describe("mail drain retry policy", () => {
  it("uses exponential backoff capped at 5 minutes", () => {
    expect(mailDrainRetryBackoffMs(1)).toBe(MAIL_DRAIN_BACKOFF_BASE_MS);
    expect(mailDrainRetryBackoffMs(2)).toBe(MAIL_DRAIN_BACKOFF_BASE_MS * 2);
    expect(mailDrainRetryBackoffMs(3)).toBe(MAIL_DRAIN_BACKOFF_BASE_MS * 4);
    expect(mailDrainRetryBackoffMs(10)).toBe(MAIL_DRAIN_BACKOFF_CAP_MS);
  });

  it("treats queued rows as always due", () => {
    const now = 1_000_000;
    expect(
      isMailDrainRetryDue(
        { status: "queued", attempts: 1, attempted_at: new Date(now) },
        now,
      ),
    ).toBe(true);
  });

  it("waits for backoff after a failed attempt", () => {
    const now = 1_000_000;
    const attempts = 2;
    const wait = mailDrainRetryBackoffMs(attempts);
    expect(
      isMailDrainRetryDue(
        { status: "failed", attempts, attempted_at: new Date(now - wait + 1) },
        now,
      ),
    ).toBe(false);
    expect(
      isMailDrainRetryDue(
        { status: "failed", attempts, attempted_at: new Date(now - wait) },
        now,
      ),
    ).toBe(true);
  });

  it("exhausts at MAX_MAIL_DRAIN_ATTEMPTS", () => {
    expect(MAX_MAIL_DRAIN_ATTEMPTS).toBe(8);
    expect(nextMailDrainAttempts(7)).toBe(8);
    expect(isMailDrainAttemptsExhausted(8)).toBe(true);
    expect(isMailDrainAttemptsExhausted(7)).toBe(false);
  });
});
