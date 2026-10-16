import * as jose from "jose";
import type { IdentityProvider } from "@admitto/db";
import type { JWTPayload } from "jose";
import { decryptClientSecret } from "./provider-secret.js";
import { createPinnedRemoteJWKSet, safeOidcFetch } from "./safe-oidc-fetch.js";
import { assertSafeOidcFetchUrl } from "./safe-url.js";

export interface TokenExchangeResult {
  idToken: string;
  payload: JWTPayload;
}

export interface ValidateIdTokenInput {
  idToken: string;
  provider: IdentityProvider;
  expectedNonce: string;
}

let jwksCache = new Map<string, { keys: jose.JWTVerifyGetKey; fetchedAt: number }>();
const JWKS_CACHE_MS = 5 * 60 * 1000;

function getJwksVerifier(jwksUri: string): jose.JWTVerifyGetKey {
  const cached = jwksCache.get(jwksUri);
  if (cached && Date.now() - cached.fetchedAt < JWKS_CACHE_MS) {
    return cached.keys;
  }
  const keys = createPinnedRemoteJWKSet(jwksUri);
  jwksCache.set(jwksUri, { keys, fetchedAt: Date.now() });
  return keys;
}

/** For tests — reset JWKS cache between cases. */
export function clearJwksCacheForTests(): void {
  jwksCache = new Map();
}

/** Exchange authorization code for tokens at the provider token endpoint. */
export async function exchangeAuthorizationCode(
  provider: IdentityProvider,
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<{ id_token: string; access_token?: string }> {
  assertSafeOidcFetchUrl(provider.token_endpoint);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: provider.client_id,
    code_verifier: codeVerifier,
  });
  if (provider.client_secret_enc) {
    body.set("client_secret", decryptClientSecret(provider.client_secret_enc));
  }

  const res = await safeOidcFetch(provider.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`Token exchange failed: HTTP ${res.status}`);
  }

  const json = (await res.json()) as Record<string, unknown>;
  const idToken = json["id_token"];
  if (typeof idToken !== "string" || !idToken) {
    throw new Error("Token response missing id_token");
  }
  const accessToken = json["access_token"];
  return {
    id_token: idToken,
    access_token: typeof accessToken === "string" ? accessToken : undefined,
  };
}

/**
 * OIDC Core 3.1.3.7, steps 4 and 5: a token issued for several audiences must name its
 * authorized party, and a named authorized party must be this client. A single-audience token
 * may omit `azp`.
 */
function assertAuthorizedParty(payload: JWTPayload, clientId: string): void {
  const { aud, azp } = payload;
  if (azp === undefined) {
    if (Array.isArray(aud) && aud.length > 1) {
      throw new Error("ID token with several audiences is missing azp");
    }
    return;
  }
  if (azp !== clientId) {
    throw new Error("ID token azp mismatch");
  }
}

/** Validate ID token signature and standard claims including nonce. */
export async function validateIdToken(input: ValidateIdTokenInput): Promise<JWTPayload> {
  assertSafeOidcFetchUrl(input.provider.jwks_uri);
  const verifier = getJwksVerifier(input.provider.jwks_uri);
  const { payload } = await jose.jwtVerify(input.idToken, verifier, {
    issuer: input.provider.issuer,
    audience: input.provider.client_id,
    algorithms: ["RS256", "RS384", "RS512", "ES256", "ES384", "ES512", "PS256"],
    // The issuer and audience options already require `iss` and `aud`; OIDC Core 2 also makes
    // `exp`, `iat` and `sub` mandatory in an ID token.
    requiredClaims: ["exp", "iat", "sub"],
  });

  assertAuthorizedParty(payload, input.provider.client_id);

  if (payload.nonce !== input.expectedNonce) {
    throw new Error("ID token nonce mismatch");
  }

  return payload;
}

export async function exchangeAndValidateIdToken(
  provider: IdentityProvider,
  code: string,
  codeVerifier: string,
  redirectUri: string,
  expectedNonce: string,
): Promise<TokenExchangeResult> {
  const tokens = await exchangeAuthorizationCode(provider, code, codeVerifier, redirectUri);
  const payload = await validateIdToken({
    idToken: tokens.id_token,
    provider,
    expectedNonce,
  });
  return { idToken: tokens.id_token, payload };
}
