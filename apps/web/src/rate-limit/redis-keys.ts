/** Start timestamp (ms) of the fixed window containing `now`. */
export function redisWindowStart(now: number, windowMs: number): number {
  return Math.floor(now / windowMs) * windowMs;
}

/**
 * Redis key for a fixed-window hit.
 * @internal test helper
 */
export function redisKeyForHit(key: string, windowMs: number, now = Date.now()): string {
  const windowStart = redisWindowStart(now, windowMs);
  return `rl:${key}:${windowStart}`;
}
