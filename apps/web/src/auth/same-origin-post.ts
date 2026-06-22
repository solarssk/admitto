import type { Context, Next } from "hono";
import { resolveTrustProxy } from "../config.js";

/** First comma-separated hop from a proxy-forwarded header value. */
function firstForwardedValue(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const first = raw.split(",")[0]?.trim();
  return first || undefined;
}

/**
 * Canonical request origin for CSRF checks.
 * Uses `X-Forwarded-Proto` / `X-Forwarded-Host` only when `TRUST_PROXY=true`; otherwise the
 * request URL (defense-in-depth when the app is not behind a sanitizing reverse proxy).
 */
export function resolveRequestOrigin(c: Context): string {
  const requestUrl = new URL(c.req.url);
  let proto = requestUrl.protocol.replace(/:$/, "");
  let host = requestUrl.host;

  if (resolveTrustProxy()) {
    proto = firstForwardedValue(c.req.header("x-forwarded-proto")) ?? proto;
    host = firstForwardedValue(c.req.header("x-forwarded-host")) ?? host;
  }

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

/** Browser-set Fetch Metadata; not spoofable from cross-origin pages in modern UAs. */
function isSameSiteFetch(c: Context): boolean {
  const site = c.req.header("sec-fetch-site")?.toLowerCase();
  return site === "same-origin" || site === "same-site";
}

/**
 * Reject cross-site POST when `Origin`/`Referer` do not match the request origin.
 * When both are absent (e.g. Safari + `Referrer-Policy: no-referrer` on HTML forms), accept
 * `Sec-Fetch-Site: same-origin|same-site`. Tools like curl/Postman without those headers still fail.
 */
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

  if (isSameSiteFetch(c)) {
    return null;
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
