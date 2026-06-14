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
  const url = new URL(".well-known/openid-configuration", base).toString();
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
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
    throw new Error("OIDC discovery document missing required fields");
  }
  const userinfo = doc["userinfo_endpoint"];
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
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const discovery = await fetchOidcDiscovery(input.issuer);
    const jwksUri = input.jwks_uri ?? discovery.jwks_uri;
    const res = await fetch(jwksUri, { signal: AbortSignal.timeout(15_000) });
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
