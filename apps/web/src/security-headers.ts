/**
 * Baseline security headers for JSON/health responses and ops probes.
 * HTML pages set route-specific CSP via their own helpers.
 */
export function getBaselineSecurityHeaders(): Record<string, string> {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Robots-Tag": "noindex, nofollow",
  };
}

/** Apply baseline headers to a Hono context (mutates response headers). */
export function applyBaselineSecurityHeaders(
  setHeader: (name: string, value: string) => void,
): void {
  for (const [name, value] of Object.entries(getBaselineSecurityHeaders())) {
    setHeader(name, value);
  }
}
