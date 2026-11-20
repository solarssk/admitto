import { randomBytes } from "node:crypto";

/**
 * Generate a 256-bit CSPRNG token, base64url-encoded (~43 chars).
 * Shared primitive for internal ticket tokens, session cookies, and Mode B `public_ref`.
 */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

/** RFC 4648 base32 in lowercase, without padding. */
export function encodeBase32Lower(bytes: Uint8Array): string {
  let bits = 0;
  let acc = 0;
  let out = "";
  for (const byte of bytes) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32_ALPHABET.charAt((acc >>> bits) & 31);
    }
    acc &= (1 << bits) - 1;
  }
  if (bits > 0) out += BASE32_ALPHABET.charAt((acc << (5 - bits)) & 31);
  return out;
}

/**
 * Generate an event slug: 128 bits from the CSPRNG as 26 lowercase base32 characters (a-z, 2-7).
 * Nothing in it comes from the event title, and it matches the slug rule `^[a-z0-9_-]+$`.
 */
export function generateEventSlug(): string {
  return encodeBase32Lower(randomBytes(16));
}
