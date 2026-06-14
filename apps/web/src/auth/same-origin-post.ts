import type { Context, Next } from "hono";

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
  try {
    return new URL(`${proto}://${host}`).origin;
  } catch {
    return requestUrl.origin;
  }
}

function headerOriginMatches(expectedOrigin: string, headerValue: string): boolean {
  try {
    return new URL(headerValue).origin === expectedOrigin;
  } catch {
    return false;
  }
}

/** Reject cross-site POST when `Origin`/`Referer` do not match the request origin. */
export function rejectCrossSitePost(
  c: Context,
  options: { format?: "text" | "json" } = {},
): Response | null {
  const format = options.format ?? "text";
  const forbidden = () =>
    format === "json" ? c.json({ error: "forbidden" }, 403) : c.text("Forbidden", 403);

  let expectedOrigin: string;
  try {
    expectedOrigin = resolveRequestOrigin(c);
  } catch {
    return forbidden();
  }

  const origin = c.req.header("origin");
  if (origin) {
    return headerOriginMatches(expectedOrigin, origin) ? null : forbidden();
  }

  const referer = c.req.header("referer");
  if (referer) {
    return headerOriginMatches(expectedOrigin, referer) ? null : forbidden();
  }

  return forbidden();
}

/** Hono middleware: reject cross-site POST before rate limits or body parsing. */
export function createCrossSitePostGuard(options: { format?: "text" | "json" } = {}) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const blocked = rejectCrossSitePost(c, options);
    if (blocked) return blocked;
    await next();
  };
}
