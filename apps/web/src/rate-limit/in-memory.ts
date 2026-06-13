import { MAX_BUCKETS } from "./constants.js";
import type { RateLimitHitResult, RateLimitStore } from "./types.js";

type Bucket = { count: number; resetAt: number };

function pruneExpired(buckets: Map<string, Bucket>, now: number): void {
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) {
      buckets.delete(key);
    }
  }
}

function evictOldestBucket(buckets: Map<string, Bucket>): void {
  let oldestKey: string | undefined;
  let oldestReset = Infinity;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt < oldestReset) {
      oldestReset = bucket.resetAt;
      oldestKey = key;
    }
  }
  if (oldestKey) {
    buckets.delete(oldestKey);
  }
}

export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, Bucket>();
  private readonly maxBuckets: number;

  constructor(maxBuckets = MAX_BUCKETS) {
    if (!Number.isInteger(maxBuckets) || maxBuckets < 1) {
      throw new Error("maxBuckets must be a positive integer");
    }
    this.maxBuckets = maxBuckets;
  }

  async hit(key: string, windowMs: number, max: number): Promise<RateLimitHitResult> {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      if (bucket && now >= bucket.resetAt) {
        this.buckets.delete(key);
      }
      if (!this.buckets.has(key)) {
        pruneExpired(this.buckets, now);
        while (this.buckets.size >= this.maxBuckets) {
          evictOldestBucket(this.buckets);
        }
      }
      const resetAt = now + windowMs;
      this.buckets.set(key, { count: 1, resetAt });
      return { allowed: true, remaining: max - 1, resetAt };
    }
    if (bucket.count >= max) {
      return { allowed: false, remaining: 0, resetAt: bucket.resetAt };
    }
    bucket.count += 1;
    return {
      allowed: true,
      remaining: Math.max(0, max - bucket.count),
      resetAt: bucket.resetAt,
    };
  }

  /** @internal test helper */
  reset(): void {
    this.buckets.clear();
  }

  /** @internal test helper */
  bucketCount(): number {
    return this.buckets.size;
  }
}
