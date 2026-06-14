import { randomBytes } from "node:crypto";
import { hashPassword, verifyPassword } from "../password.js";

/** Generate a human-readable backup code (shown once). */
export function generateRecoveryCodePlaintext(): string {
  const bytes = randomBytes(5);
  const hex = bytes.toString("hex").toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
}

/** Hash a recovery code for storage (argon2id). */
export async function hashRecoveryCode(plaintext: string): Promise<string> {
  const normalized = normalizeRecoveryCode(plaintext);
  return hashPassword(normalized);
}

/** Verify plaintext recovery code against stored hash. */
export async function verifyRecoveryCode(
  plaintext: string,
  credentialHash: string,
): Promise<boolean> {
  const normalized = normalizeRecoveryCode(plaintext);
  return verifyPassword(normalized, credentialHash);
}

/** Normalize user input: strip dashes/spaces, uppercase. */
export function normalizeRecoveryCode(input: string): string {
  return input.replace(/[\s-]/g, "").toUpperCase();
}
