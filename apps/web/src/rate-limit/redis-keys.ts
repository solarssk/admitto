export function redisWindowStart(now: number, windowMs: number): number {
  return Math.floor(now / windowMs) * windowMs;
}

/** @internal test helper — Redis key for a fixed-window hit */
export function redisKeyForHit(key: string, windowMs: number, now = Date.now()): string {
  const windowStart = redisWindowStart(now, windowMs);
  return `rl:${key}:${windowStart}`;
}
