import type { LookupAddress } from "node:dns";
import {
  isBlockedPrivateOrMetadataHost,
  isLoopbackHost,
  resolveSafeHostname,
  unbracketHostname,
} from "@admitto/shared/ssrf-guard";

/**
 * Block server-side identity/SSO fetches to private/link-local targets (SSRF mitigation).
 * Today used for OIDC Issuer/endpoints/JWKS and Cloudflare Access JWKS; the same allowlist
 * is intended for future SAML metadata/ACS outbound fetches that share this guard.
 */

export { unbracketHostname };

/** Whether the hostname is loopback (localhost / 127.0.0.1 / ::1) — for dev mock IdP tests. */
export { isLoopbackHost as isLoopbackHostForTests };

/**
 * Comma-separated exact hostnames or IP literals (case-insensitive) that may be private /
 * loopback for identity provider destinations (any protocol using this guard). Honored in
 * production. Ops-controlled only (env), not UI. Covers all configured providers that share
 * a hostname — list each distinct host once. Typically set on `app`.
 */
function parseSsoPrivateDestinationAllowlist(): Set<string> {
  const raw = process.env["SSO_PRIVATE_DESTINATION_ALLOWLIST"]?.trim() ?? "";
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((entry) => unbracketHostname(entry.trim().toLowerCase()))
      .filter((entry) => entry.length > 0),
  );
}

function isAllowlistedSsoHost(hostname: string): boolean {
  return parseSsoPrivateDestinationAllowlist().has(unbracketHostname(hostname).toLowerCase());
}

/** Exact allowlist match (any NODE_ENV). Used when skipping private DNS filters for pinning. */
export function isSsoPrivateDestinationAllowlisted(hostname: string): boolean {
  return isAllowlistedSsoHost(hostname);
}

async function lookupSsoHostnameUnrestricted(host: string): Promise<LookupAddress[]> {
  const { lookup } = await import("node:dns/promises");
  try {
    return await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error("OIDC URL hostname could not be resolved");
  }
}

/**
 * Require HTTPS for outbound OIDC fetches. In non-production, allow http://127.0.0.1 and
 * http://localhost for local mock IdPs and integration tests.
 *
 * Production private/LAN identity providers: list the exact hostname (or IP literal) in
 * `SSO_PRIVATE_DESTINATION_ALLOWLIST`. HTTPS is still required.
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
  const allowlisted = isAllowlistedSsoHost(url.hostname);

  if (url.protocol !== "https:" && !(allowHttpLoopback && loopback && url.protocol === "http:")) {
    throw new Error("OIDC URL must use HTTPS");
  }

  // Dev-only: http://127.0.0.1 mock IdPs. HTTPS loopback still blocked in production unless allowlisted.
  if (loopback && allowHttpLoopback && url.protocol === "http:") return;

  if (allowlisted) return;

  if (loopback || isBlockedPrivateOrMetadataHost(url.hostname)) {
    throw new Error("OIDC URL must not target private or link-local addresses");
  }
}

/** Resolve hostname and reject private/link-local/unspecified targets (used before pinned outbound fetch). */
export async function resolveSafeOidcHostname(hostname: string): Promise<LookupAddress[]> {
  const host = unbracketHostname(hostname);
  if (isAllowlistedSsoHost(host)) {
    return lookupSsoHostnameUnrestricted(host);
  }
  return resolveSafeHostname(host);
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
