import { MFA_PENDING_SESSION_TTL_MS, BACKUP_CODES_STEP_TTL_MS } from "@admitto/auth/constants";

interface CacheEntry {
  codes: string[];
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();

function cancelExpiryTimer(sessionId: string): void {
  const timer = expiryTimers.get(sessionId);
  if (!timer) return;
  clearTimeout(timer);
  expiryTimers.delete(sessionId);
}

function removeCacheEntry(sessionId: string): void {
  cancelExpiryTimer(sessionId);
  cache.delete(sessionId);
}

function scheduleExpiry(sessionId: string, expiresAt: number): void {
  cancelExpiryTimer(sessionId);
  const delay = Math.max(0, expiresAt - Date.now());
  const timer = setTimeout(() => {
    expiryTimers.delete(sessionId);
    cache.delete(sessionId);
  }, delay);
  timer.unref?.();
  expiryTimers.set(sessionId, timer);
}

function sweepExpired(): void {
  const now = Date.now();
  for (const [sessionId, entry] of cache) {
    if (entry.expiresAt <= now) removeCacheEntry(sessionId);
  }
}

/** Keep plaintext backup codes for the current enrollment session (same TTL as partial session). */
export function stashEnrollmentBackupCodes(sessionId: string, codes: string[]): void {
  if (codes.length === 0) return;
  sweepExpired();
  const expiresAt = Date.now() + MFA_PENDING_SESSION_TTL_MS;
  cache.set(sessionId, {
    codes: [...codes],
    expiresAt,
  });
  scheduleExpiry(sessionId, expiresAt);
}

export function getStashedEnrollmentBackupCodes(sessionId: string): string[] | undefined {
  sweepExpired();
  const entry = cache.get(sessionId);
  if (!entry || entry.expiresAt <= Date.now()) {
    removeCacheEntry(sessionId);
    return undefined;
  }
  return [...entry.codes];
}

function normalizeCodeSet(codes: string[]): string[] {
  return codes.map((code) => code.replace(/[\s-]/g, "").toUpperCase()).sort((a, b) => a.localeCompare(b));
}

/** True when submitted codes exactly match the server-stashed enrollment set (no hash work). */
export function submittedCodesMatchStashedEnrollmentBackup(
  sessionId: string,
  submitted: string[],
): boolean {
  const stashed = getStashedEnrollmentBackupCodes(sessionId);
  if (stashed?.length !== submitted.length) return false;
  const expected = normalizeCodeSet(stashed);
  const actual = normalizeCodeSet(submitted);
  return expected.length === actual.length && expected.every((code, i) => code === actual[i]);
}

/**
 * Extend the stash TTL to `BACKUP_CODES_STEP_TTL_MS` from now.
 * Called when the session is promoted to backup_codes_required so the stash
 * lifetime matches the fresh session window.  Returns false when no stash
 * exists for this session (nothing to extend).
 */
export function extendEnrollmentBackupCodes(sessionId: string): boolean {
  sweepExpired();
  const entry = cache.get(sessionId);
  if (!entry || entry.expiresAt <= Date.now()) {
    removeCacheEntry(sessionId);
    return false;
  }
  const newExpiry = Date.now() + BACKUP_CODES_STEP_TTL_MS;
  if (newExpiry > entry.expiresAt) {
    entry.expiresAt = newExpiry;
    scheduleExpiry(sessionId, newExpiry);
  }
  return true;
}

export function clearEnrollmentBackupCodes(sessionId: string): void {
  removeCacheEntry(sessionId);
}

/** @internal test helper — drop all stashed enrollment codes between tests. */
export function clearEnrollmentBackupCacheForTests(): void {
  for (const sessionId of expiryTimers.keys()) {
    cancelExpiryTimer(sessionId);
  }
  cache.clear();
}
