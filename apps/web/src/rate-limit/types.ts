/** Outcome of a single rate-limit check for one client key within a time window. */
export interface RateLimitHitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/** Pluggable store for per-key request counting (in-memory or Redis). */
export interface RateLimitStore {
  /** Record one request and return whether it is within the configured limit. */
  hit(key: string, windowMs: number, max: number): Promise<RateLimitHitResult>;
}
