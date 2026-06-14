import type { Context } from "hono";

/** First comma-separated hop from a proxy-forwarded header value. */
function firstForwardedValue(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const first = raw.split(",")[0]?.trim();
  return first || undefined;
}

/**
 * Canonical request origin for CSRF checks.
 * Uses X-Forwarded-Proto/Host when present (reverse proxy); otherwise the request URL.
 */
export function resolveRequestOrigin(c: Context): string {
  const requestUrl = new URL(c.req.url);
  const proto =
    firstForwardedValue(c.req.header("x-forwarded-proto")) ??
    requestUrl.protocol.replace(/:$/, "");
  const host = firstForwardedValue(c.req.header("x-forwarded-host")) ?? requestUrl.host;
  return new URL(`${proto}://${host}`).origin;
}

function headerOriginMatches(expectedOrigin: string, headerValue: string): boolean {
  try {
    return new URL(headerValue).origin === expectedOrigin;
  } catch {
    return false;
  }
}

/** Reject cross-site POST when `Origin`/`Referer` do not match the request origin. */
export function rejectCrossSitePost(c: Context): Response | null {
  const expectedOrigin = resolveRequestOrigin(c);

  const origin = c.req.header("origin");
  if (origin) {
    return headerOriginMatches(expectedOrigin, origin) ? null : c.text("Forbidden", 403);
  }

  const referer = c.req.header("referer");
  if (referer) {
    return headerOriginMatches(expectedOrigin, referer) ? null : c.text("Forbidden", 403);
  }

  return c.text("Forbidden", 403);
}
