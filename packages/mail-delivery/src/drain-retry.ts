/**
 * Mail drain retry policy (worker reclaim of failed+retryable EmailDelivery rows).
 *
 * Aligns with transactional-email practice (cap ~7–10) and Graph guidance
 * (no immediate retries; exponential backoff when Retry-After is absent).
 */

/** Max drain attempts per delivery row (includes the first send). */
export const MAX_MAIL_DRAIN_ATTEMPTS = 8;

/** Base delay before the first reclaim after a failed attempt. */
export const MAIL_DRAIN_BACKOFF_BASE_MS = 30_000;

/** Cap for exponential backoff between reclaims. */
export const MAIL_DRAIN_BACKOFF_CAP_MS = 5 * 60_000;

/**
 * Wait after a failed attempt before the worker may reclaim the row.
 * `attempts` is the post-increment count on the row (schema default starts at 1).
 */
export function mailDrainRetryBackoffMs(attempts: number): number {
  const exp = Math.max(0, attempts - 1);
  const raw = MAIL_DRAIN_BACKOFF_BASE_MS * 2 ** exp;
  return Math.min(MAIL_DRAIN_BACKOFF_CAP_MS, raw);
}

export function isMailDrainRetryDue(
  row: { status: string; attempts: number; attempted_at: Date | null },
  nowMs: number,
): boolean {
  if (row.status === "queued") return true;
  if (row.attempted_at == null) return true;
  return nowMs - row.attempted_at.getTime() >= mailDrainRetryBackoffMs(row.attempts);
}

export function nextMailDrainAttempts(currentAttempts: number): number {
  return currentAttempts + 1;
}

export function isMailDrainAttemptsExhausted(nextAttempts: number): boolean {
  return nextAttempts >= MAX_MAIL_DRAIN_ATTEMPTS;
}
