import { createHash } from "node:crypto";

/**
 * SHA-256 hex digest of a token. Only the hash is persisted — never the raw token.
 *
 * `token` is always a CSPRNG-generated value from `generateToken()` (256 bits of entropy:
 * ticket/session/public_ref tokens), never a user-chosen password - a slow, salted hash
 * (argon2/bcrypt) would be both unnecessary (nothing to brute-force in a random 256-bit
 * space) and wrong here: this hash doubles as a deterministic DB lookup key
 * (`Session.token_hash`/`Attendee.token_hash`), which a salted algorithm cannot serve.
 */
export function hashToken(token: string): string {
  // codeql[js/insufficient-password-hash]: not a password, see doc comment above
  return createHash("sha256").update(token).digest("hex");
}
