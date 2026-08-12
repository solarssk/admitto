import { safeOidcFetch } from "./safe-oidc-fetch.js";
import { assertSafeOidcFetchUrl } from "./safe-url.js";

export interface OidcDiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
  end_session_endpoint?: string;
}

// Optional trailing slash after the suffix - a plausible extra keystroke when copying a
// discovery URL - is stripped too, so it doesn't survive as a literal tail that fails the
// exact-suffix match below.
const WELL_KNOWN_SUFFIX_RE = /\/\.well-known\/openid-configuration\/?$/;

/**
 * Strip an accidentally-pasted discovery document URL down to the bare issuer. Many other apps'
 * OIDC setup docs have operators copy the full `.well-known/openid-configuration` URL; Admitto's
 * issuer must be the bare value (it's compared verbatim against every token's `iss` claim -
 * token.ts), and appending `.well-known/...` to an already-suffixed issuer 404s instead of
 * discovering anything. Does NOT add a trailing slash: a slash the IdP's own issuer doesn't have
 * would make every future token fail that verbatim comparison. See fetchOidcDiscovery for the
 * separate trailing slash needed only to build the discovery document's URL.
 */
export function normalizeIssuerInput(issuer: string): string {
  return issuer.trim().replace(WELL_KNOWN_SUFFIX_RE, "");
}

/** Fetch and parse OIDC discovery document. */
export async function fetchOidcDiscovery(issuer: string): Promise<OidcDiscoveryDocument> {
  const base = normalizeIssuerInput(issuer);
  assertSafeOidcFetchUrl(base);
  // new URL(relative, base) only treats `base` as a directory when it ends in "/" - otherwise
  // its last path segment is replaced instead of kept. This trailing slash is purely local to
  // resolving the discovery URL and must never leak into a stored/returned issuer value.
  const discoveryBase = base.endsWith("/") ? base : `${base}/`;
  const url = new URL(".well-known/openid-configuration", discoveryBase).toString();
  assertSafeOidcFetchUrl(url);
  const res = await safeOidcFetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    throw new Error(`OIDC discovery failed: HTTP ${res.status}`);
  }
  const doc = (await res.json()) as Record<string, unknown>;
  const authorization_endpoint = doc["authorization_endpoint"];
  const token_endpoint = doc["token_endpoint"];
  const jwks_uri = doc["jwks_uri"];
  const docIssuer = doc["issuer"];
  if (
    typeof authorization_endpoint !== "string" ||
    typeof token_endpoint !== "string" ||
    typeof jwks_uri !== "string" ||
    typeof docIssuer !== "string"
  ) {
    throw new TypeError("OIDC discovery document missing required fields");
  }
  const userinfo = doc["userinfo_endpoint"];
  const endSession = doc["end_session_endpoint"];
  assertSafeOidcFetchUrl(authorization_endpoint);
  assertSafeOidcFetchUrl(token_endpoint);
  assertSafeOidcFetchUrl(jwks_uri);
  if (typeof userinfo === "string") {
    assertSafeOidcFetchUrl(userinfo);
  }
  if (typeof endSession === "string") {
    assertSafeOidcFetchUrl(endSession);
  }
  return {
    issuer: docIssuer,
    authorization_endpoint,
    token_endpoint,
    jwks_uri,
    userinfo_endpoint: typeof userinfo === "string" ? userinfo : undefined,
    end_session_endpoint: typeof endSession === "string" ? endSession : undefined,
  };
}

/** Verify discovery + JWKS endpoints respond (no secret in result). */
export async function testOidcConnection(input: {
  issuer: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  jwks_uri?: string;
  userinfo_endpoint?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (input.userinfo_endpoint) assertSafeOidcFetchUrl(input.userinfo_endpoint);
    let jwksUri = input.jwks_uri;
    if (input.authorization_endpoint && input.token_endpoint && input.jwks_uri) {
      assertSafeOidcFetchUrl(input.authorization_endpoint);
      assertSafeOidcFetchUrl(input.token_endpoint);
      assertSafeOidcFetchUrl(input.jwks_uri);
    } else {
      const discovery = await fetchOidcDiscovery(input.issuer);
      jwksUri = input.jwks_uri ?? discovery.jwks_uri;
    }
    if (!jwksUri) {
      return { ok: false, error: "JWKS URI is required" };
    }
    assertSafeOidcFetchUrl(jwksUri);
    const res = await safeOidcFetch(jwksUri, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      return { ok: false, error: `JWKS endpoint returned HTTP ${res.status}` };
    }
    const body = (await res.json()) as { keys?: unknown };
    if (!Array.isArray(body.keys) || body.keys.length === 0) {
      return { ok: false, error: "JWKS document has no keys" };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Connection test failed";
    return { ok: false, error: message };
  }
}
