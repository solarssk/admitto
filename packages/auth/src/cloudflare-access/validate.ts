import * as jose from "jose";
import type { JWTPayload } from "jose";
import { createPinnedRemoteJWKSet } from "../oidc/safe-oidc-fetch.js";
import { assertSafeOidcFetchUrl } from "../oidc/safe-url.js";
import type { CfAccessConfig } from "./config.js";

const jwksVerifiers = new Map<string, jose.JWTVerifyGetKey>();

/** For tests — reset JWKS verifiers between cases. */
export function clearCfAccessJwksCacheForTests(): void {
  jwksVerifiers.clear();
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

/** Reject Cloudflare service-token JWT shape (type app but no human identity). */
export function isServiceTokenShape(payload: JWTPayload): boolean {
  const sub = asNonEmptyString(payload.sub);
  const email = asNonEmptyString(payload.email);
  const commonName = asNonEmptyString(payload.common_name);
  if (email) return false;
  if (!sub && !commonName) return true;
  if (sub && !email) return true;
  return false;
}

export class CfAccessJwtError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "CfAccessJwtError";
  }
}

/** Validate Cloudflare Access JWT signature and claims. */
export async function validateAccessJwt(
  token: string,
  config: Pick<CfAccessConfig, "teamDomain" | "audience" | "jwksUri">,
): Promise<JWTPayload> {
  if (!config.teamDomain || config.audience.length === 0) {
    throw new CfAccessJwtError("CF Access is not configured", "misconfigured");
  }

  assertSafeOidcFetchUrl(config.jwksUri);

  let verifier = jwksVerifiers.get(config.jwksUri);
  if (!verifier) {
    verifier = createPinnedRemoteJWKSet(config.jwksUri);
    jwksVerifiers.set(config.jwksUri, verifier);
  }

  let payload: JWTPayload;
  try {
    const result = await jose.jwtVerify(token, verifier, {
      issuer: config.teamDomain,
      audience: config.audience,
      algorithms: ["RS256"],
    });
    payload = result.payload;
  } catch (err) {
    const message = err instanceof Error ? err.message : "JWT verification failed";
    throw new CfAccessJwtError(message, "invalid_jwt");
  }

  if (payload.type !== "app") {
    throw new CfAccessJwtError("JWT type must be app", "invalid_type");
  }

  if (isServiceTokenShape(payload)) {
    throw new CfAccessJwtError("Service token authentication rejected", "service_token");
  }

  const sub = asNonEmptyString(payload.sub);
  const email = asNonEmptyString(payload.email);
  if (!sub || !email) {
    throw new CfAccessJwtError("JWT missing sub or email", "missing_identity");
  }

  return payload;
}
