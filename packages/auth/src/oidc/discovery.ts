import { safeOidcFetch } from "./safe-oidc-fetch.js";
import { assertSafeOidcFetchUrl } from "./safe-url.js";

export interface OidcDiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
}

function normalizeIssuer(issuer: string): string {
  return issuer.endsWith("/") ? issuer : `${issuer}/`;
}

/** Fetch and parse OIDC discovery document. */
export async function fetchOidcDiscovery(issuer: string): Promise<OidcDiscoveryDocument> {
  const base = normalizeIssuer(issuer);
  assertSafeOidcFetchUrl(base);
  const url = new URL(".well-known/openid-configuration", base).toString();
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
  assertSafeOidcFetchUrl(authorization_endpoint);
  assertSafeOidcFetchUrl(token_endpoint);
  assertSafeOidcFetchUrl(jwks_uri);
  if (typeof userinfo === "string") {
    assertSafeOidcFetchUrl(userinfo);
  }
  return {
    issuer: docIssuer,
    authorization_endpoint,
    token_endpoint,
    jwks_uri,
    userinfo_endpoint: typeof userinfo === "string" ? userinfo : undefined,
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
