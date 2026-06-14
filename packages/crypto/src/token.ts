import { randomBytes } from "node:crypto";

/**
 * Generate a 256-bit CSPRNG token, base64url-encoded (~43 chars).
 * Shared primitive for internal ticket tokens, session cookies, and Mode B `public_ref`.
 */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}
