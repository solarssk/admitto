import type { LookupAddress } from "node:dns";
import {
  isBlockedPrivateOrMetadataHost,
  isLoopbackHost,
  resolveSafeHostname,
  unbracketHostname,
} from "@admitto/shared";

/** Block server-side OIDC/Cloudflare Access fetches to private/link-local targets (SSRF mitigation). */

export { unbracketHostname };

/** Whether the hostname is loopback (localhost / 127.0.0.1 / ::1) — for dev mock IdP tests. */
export { isLoopbackHost as isLoopbackHostForTests };

/**
 * Require HTTPS for outbound OIDC fetches. In non-production, allow http://127.0.0.1 and
 * http://localhost for local mock IdPs and integration tests.
 */
export function assertSafeOidcFetchUrl(urlString: string): void {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error("Invalid OIDC URL");
  }

  const loopback = isLoopbackHost(url.hostname);
  const allowHttpLoopback = process.env["NODE_ENV"] !== "production";

  if (url.protocol !== "https:" && !(allowHttpLoopback && loopback && url.protocol === "http:")) {
    throw new Error("OIDC URL must use HTTPS");
  }

  // Dev-only: http://127.0.0.1 mock IdPs. HTTPS loopback still blocked in production.
  if (loopback && allowHttpLoopback && url.protocol === "http:") return;

  if (loopback || isBlockedPrivateOrMetadataHost(url.hostname)) {
    throw new Error("OIDC URL must not target private or link-local addresses");
  }
}

/** Resolve hostname and reject private/link-local/unspecified targets (used before pinned outbound fetch). */
export function resolveSafeOidcHostname(hostname: string): Promise<LookupAddress[]> {
  return resolveSafeHostname(unbracketHostname(hostname));
}

/**
 * Validation-only SSRF DNS check (does not pin or fetch).
 * For outbound requests use `safeOidcFetch` / `createPinnedRemoteJWKSet` instead —
 * a separate fetch after this call can still rebind DNS (TOCTOU).
 */
export async function assertSafeOidcFetchUrlResolved(urlString: string): Promise<void> {
  assertSafeOidcFetchUrl(urlString);

  const hostname = unbracketHostname(new URL(urlString).hostname);
  const allowHttpLoopback = process.env["NODE_ENV"] !== "production";
  if (allowHttpLoopback && isLoopbackHost(hostname)) return;

  await resolveSafeOidcHostname(hostname);
}
