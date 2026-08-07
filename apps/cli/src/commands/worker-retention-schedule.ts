/** In-memory retention cadence for the background worker (ADR 0042). */

export const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** After a failed retention run, wait before retrying (avoids hammering every tick). */
export const RETENTION_FAILURE_BACKOFF_MS = 15 * 60 * 1000;

export type RetentionSchedule = {
  lastRetentionAt: number | null;
  bootDone: boolean;
  /** When set, retention stays skipped until this timestamp (failure backoff). */
  failureBackoffUntil: number | null;
};

export function createRetentionSchedule(): RetentionSchedule {
  return { lastRetentionAt: null, bootDone: false, failureBackoffUntil: null };
}

export function retentionIsDue(schedule: RetentionSchedule, now: number): boolean {
  if (schedule.failureBackoffUntil != null && now < schedule.failureBackoffUntil) {
    return false;
  }
  return (
    !schedule.bootDone ||
    schedule.lastRetentionAt == null ||
    now - schedule.lastRetentionAt >= RETENTION_INTERVAL_MS
  );
}

export function markRetentionSuccess(schedule: RetentionSchedule, now: number): void {
  schedule.lastRetentionAt = now;
  schedule.bootDone = true;
  schedule.failureBackoffUntil = null;
}

export function markRetentionFailure(schedule: RetentionSchedule, now: number): void {
  schedule.failureBackoffUntil = now + RETENTION_FAILURE_BACKOFF_MS;
}
