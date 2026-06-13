export interface RateLimitHitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export interface RateLimitStore {
  hit(key: string, windowMs: number, max: number): Promise<RateLimitHitResult>;
}
