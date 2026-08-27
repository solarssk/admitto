import { WEBAUTHN_CHALLENGE_TTL_MS } from "@admitto/auth/constants";

/** "register" (My Account, or the login-time enroll flow) vs "assert" (login verify / step-up) vs
 * "passkey-login" (first-factor discoverable-credential login, keyed by a server-issued opaque
 * ceremony token instead of a session id - there is no session at all before this ceremony
 * completes) - kept separate so a user with one ceremony type mid-flight under a session (or
 * ceremony token) can't collide with a different one under the same key.
 *
 * Process-local (in-memory Map below, not Redis-backed) for all three purposes: a ceremony's
 * begin/finish round trip must land on the same app instance. Fine for this deployment's default
 * docker-compose (one `app` container, no `deploy.replicas` set - unlike `worker`, which is
 * pinned to 1 explicitly for its own locking reasons). A self-hoster running multiple app
 * replicas behind a non-sticky load balancer would see intermittent `challenge_expired` on all
 * three purposes, not just "passkey-login" - a known, pre-existing limitation this type doesn't
 * introduce. Moving to Redis (the existing rate-limit store already has a client) would need
 * SETEX + a single-use GETDEL-style consume for all three purposes at once, so it's left as a
 * follow-up rather than folded into this change. */
export type WebauthnChallengePurpose = "register" | "assert" | "passkey-login";

interface ChallengeEntry {
  challenge: string;
  expiresAt: number;
}

const cache = new Map<string, ChallengeEntry>();
const expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();

function cacheKey(purpose: WebauthnChallengePurpose, sessionId: string): string {
  return `${purpose}:${sessionId}`;
}

function cancelExpiryTimer(key: string): void {
  const timer = expiryTimers.get(key);
  if (!timer) return;
  clearTimeout(timer);
  expiryTimers.delete(key);
}

function removeCacheEntry(key: string): void {
  cancelExpiryTimer(key);
  cache.delete(key);
}

function scheduleExpiry(key: string, expiresAt: number): void {
  cancelExpiryTimer(key);
  const delay = Math.max(0, expiresAt - Date.now());
  const timer = setTimeout(() => {
    expiryTimers.delete(key);
    cache.delete(key);
  }, delay);
  timer.unref?.();
  expiryTimers.set(key, timer);
}

function sweepExpired(): void {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) removeCacheEntry(key);
  }
}

/** Stash a freshly-generated challenge for the in-flight ceremony. Overwrites any previous
 * challenge for the same purpose/session (only one ceremony of a kind can be in flight). */
export function stashWebauthnChallenge(
  purpose: WebauthnChallengePurpose,
  sessionId: string,
  challenge: string,
): void {
  sweepExpired();
  const key = cacheKey(purpose, sessionId);
  const expiresAt = Date.now() + WEBAUTHN_CHALLENGE_TTL_MS;
  cache.set(key, { challenge, expiresAt });
  scheduleExpiry(key, expiresAt);
}

/** Read and delete the stashed challenge (single-use — a finish response can only be checked
 * against it once, matching the ceremony being one begin → one finish). */
export function consumeWebauthnChallenge(
  purpose: WebauthnChallengePurpose,
  sessionId: string,
): string | undefined {
  sweepExpired();
  const key = cacheKey(purpose, sessionId);
  const entry = cache.get(key);
  removeCacheEntry(key);
  if (!entry || entry.expiresAt <= Date.now()) return undefined;
  return entry.challenge;
}

export function clearWebauthnChallenge(purpose: WebauthnChallengePurpose, sessionId: string): void {
  removeCacheEntry(cacheKey(purpose, sessionId));
}

/** @internal test helper — drop all stashed challenges between tests. */
export function clearWebauthnChallengeCacheForTests(): void {
  for (const key of expiryTimers.keys()) {
    cancelExpiryTimer(key);
  }
  cache.clear();
}
