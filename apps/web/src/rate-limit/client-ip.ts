/**
 * First X-Forwarded-For hop — safe only behind a reverse proxy that
 * overwrites/forwards a trusted client IP (document in deployment runbook).
 */
export function clientIpFromHeaders(
  forwardedFor: string | undefined,
  fallback = "unknown",
): string {
  if (!forwardedFor) return fallback;
  const first = forwardedFor.split(",")[0]?.trim();
  return first || fallback;
}
