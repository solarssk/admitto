export const CF_ACCESS_HEADER = "Cf-Access-Jwt-Assertion";
/** Documented by Cloudflare; not used for auth — header-only at collision point (ADR 0017). */
export const CF_ACCESS_COOKIE = "CF_Authorization";

/** Extract Cloudflare Access JWT from the edge-injected header only. */
export function extractAccessTokenFromHeaders(
  headers: Record<string, string | undefined>,
): string | null {
  const getHeader = (name: string): string | undefined =>
    Object.getOwnPropertyDescriptor(headers, name)?.value;
  const header =
    getHeader(CF_ACCESS_HEADER) ??
    getHeader(CF_ACCESS_HEADER.toLowerCase()) ??
    getHeader("cf-access-jwt-assertion");
  if (header?.trim()) return header.trim();
  return null;
}
