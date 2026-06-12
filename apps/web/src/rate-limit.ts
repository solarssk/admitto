const WINDOW_MS = 60_000;
const MAX_REQUESTS = 60;
const MAX_BUCKETS = 10_000;

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

function pruneExpired(now: number): void {
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) {
      buckets.delete(key);
    }
  }
}

function evictOldestBucket(): void {
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

/** Simple in-memory per-IP rate limit for public /t and /q routes. */
export function checkRateLimit(clientKey: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(clientKey);
  if (!bucket || now >= bucket.resetAt) {
    if (bucket && now >= bucket.resetAt) {
      buckets.delete(clientKey);
    }
    if (!buckets.has(clientKey)) {
      pruneExpired(now);
      while (buckets.size >= MAX_BUCKETS) {
        evictOldestBucket();
      }
    }
    buckets.set(clientKey, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (bucket.count >= MAX_REQUESTS) {
    return false;
  }
  bucket.count += 1;
  return true;
}

/** @internal test helper */
export function _resetRateLimits(): void {
  buckets.clear();
}

/** @internal test helper */
export function _bucketCount(): number {
  return buckets.size;
}

export function clientIpFromHeaders(
  forwardedFor: string | undefined,
  fallback = "unknown",
): string {
  if (!forwardedFor) return fallback;
  const first = forwardedFor.split(",")[0]?.trim();
  return first || fallback;
}
