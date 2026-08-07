import { describe, expect, it } from "vitest";
import {
  RETENTION_FAILURE_BACKOFF_MS,
  RETENTION_INTERVAL_MS,
  createRetentionSchedule,
  markRetentionFailure,
  markRetentionSuccess,
  retentionIsDue,
} from "../src/commands/worker-retention-schedule.js";

describe("retention schedule", () => {
  it("is due on boot before any successful run", () => {
    const schedule = createRetentionSchedule();
    expect(retentionIsDue(schedule, 1_000)).toBe(true);
  });

  it("is not due until the 24h interval after success", () => {
    const schedule = createRetentionSchedule();
    const t0 = 1_000_000;
    markRetentionSuccess(schedule, t0);
    expect(retentionIsDue(schedule, t0 + RETENTION_INTERVAL_MS - 1)).toBe(false);
    expect(retentionIsDue(schedule, t0 + RETENTION_INTERVAL_MS)).toBe(true);
  });

  it("backs off after failure then becomes due again", () => {
    const schedule = createRetentionSchedule();
    const t0 = 5_000_000;
    markRetentionFailure(schedule, t0);
    expect(retentionIsDue(schedule, t0 + 1)).toBe(false);
    expect(retentionIsDue(schedule, t0 + RETENTION_FAILURE_BACKOFF_MS - 1)).toBe(false);
    expect(retentionIsDue(schedule, t0 + RETENTION_FAILURE_BACKOFF_MS)).toBe(true);
  });

  it("clears failure backoff on success", () => {
    const schedule = createRetentionSchedule();
    const t0 = 9_000_000;
    markRetentionFailure(schedule, t0);
    markRetentionSuccess(schedule, t0 + 60_000);
    expect(schedule.failureBackoffUntil).toBeNull();
    expect(retentionIsDue(schedule, t0 + 60_000 + 1)).toBe(false);
  });
});
