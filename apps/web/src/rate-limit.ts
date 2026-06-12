const WINDOW_MS = 60_000;
const MAX_REQUESTS = 60;

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Simple in-memory per-IP rate limit for public /t and /q routes. */
export function checkRateLimit(clientKey: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(clientKey);
  if (!bucket || now >= bucket.resetAt) {
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

export function clientIpFromHeaders(
  forwardedFor: string | undefined,
  fallback = "unknown",
): string {
  if (!forwardedFor) return fallback;
  const first = forwardedFor.split(",")[0]?.trim();
  return first || fallback;
}
