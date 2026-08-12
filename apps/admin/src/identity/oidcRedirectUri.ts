/** Build the OAuth redirect URI an IdP must register for this provider.
 *  Mirrors `buildOidcRedirectUri` in `@admitto/auth` (packages/auth/src/oidc/provider.ts). */
export function buildOidcRedirectUri(baseUrl: string, providerId: string): string {
  const base = baseUrl.replace(/\/$/, "");
  return `${base}/api/auth/oidc/${providerId}/callback`;
}
