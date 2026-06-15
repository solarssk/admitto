export const CF_ACCESS_HEADER = "Cf-Access-Jwt-Assertion";
export const CF_ACCESS_COOKIE = "CF_Authorization";

/** Extract token: header first, cookie fallback only when header absent. */
export function extractAccessTokenFromHeaders(
  headers: Record<string, string | undefined>,
  cookieValue?: string,
): string | null {
  const header =
    headers[CF_ACCESS_HEADER] ??
    headers[CF_ACCESS_HEADER.toLowerCase()] ??
    headers["cf-access-jwt-assertion"];
  if (header?.trim()) return header.trim();
  if (cookieValue?.trim()) return cookieValue.trim();
  return null;
}
