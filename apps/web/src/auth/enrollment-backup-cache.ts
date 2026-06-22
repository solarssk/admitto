import { MFA_PENDING_SESSION_TTL_MS } from "@admitto/auth";

interface CacheEntry {
  codes: string[];
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function sweepExpired(): void {
  const now = Date.now();
  for (const [sessionId, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(sessionId);
  }
}

/** Keep plaintext backup codes for the current enrollment session (same TTL as partial session). */
export function stashEnrollmentBackupCodes(sessionId: string, codes: string[]): void {
  if (codes.length === 0) return;
  sweepExpired();
  cache.set(sessionId, {
    codes: [...codes],
    expiresAt: Date.now() + MFA_PENDING_SESSION_TTL_MS,
  });
}

export function getStashedEnrollmentBackupCodes(sessionId: string): string[] | undefined {
  sweepExpired();
  const entry = cache.get(sessionId);
  if (!entry || entry.expiresAt <= Date.now()) {
    cache.delete(sessionId);
    return undefined;
  }
  return [...entry.codes];
}

export function clearEnrollmentBackupCodes(sessionId: string): void {
  cache.delete(sessionId);
}

/** @internal test helper — drop all stashed enrollment codes between tests. */
export function clearEnrollmentBackupCacheForTests(): void {
  cache.clear();
}
