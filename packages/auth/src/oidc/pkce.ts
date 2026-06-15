import { createHash, randomBytes } from "node:crypto";

/** Generate PKCE code_verifier (43–128 chars, RFC 7636). */
export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

/** S256 code_challenge from verifier. */
export function codeChallengeS256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** Generate opaque OAuth state and nonce values. */
export function generateOauthSecret(): string {
  return randomBytes(32).toString("base64url");
}
