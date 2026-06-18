/** Outcome of a single rate-limit check for one client key within a time window. */
export interface RateLimitHitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/** Result of a lightweight store connectivity probe (no secrets). */
export interface RateLimitHealthResult {
  ok: boolean;
  latencyMs: number | null;
}

/** Pluggable store for per-key request counting (in-memory or Redis). */
export interface RateLimitStore {
  /** Record one request and return whether it is within the configured limit. */
  hit(key: string, windowMs: number, max: number): Promise<RateLimitHitResult>;
  /** Ping the backing store; in-memory returns ok with null latency. */
  health(): Promise<RateLimitHealthResult>;
}
