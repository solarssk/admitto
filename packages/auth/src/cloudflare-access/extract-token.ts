export const CF_ACCESS_HEADER = "Cf-Access-Jwt-Assertion";
/** Documented by Cloudflare; not used for auth — header-only at collision point (ADR 0017). */
export const CF_ACCESS_COOKIE = "CF_Authorization";

/** Extract Cloudflare Access JWT from the edge-injected header only. */
export function extractAccessTokenFromHeaders(
  headers: Record<string, string | undefined>,
): string | null {
  const header =
    headers[CF_ACCESS_HEADER] ??
    headers[CF_ACCESS_HEADER.toLowerCase()] ??
    headers["cf-access-jwt-assertion"];
  if (header?.trim()) return header.trim();
  return null;
}
