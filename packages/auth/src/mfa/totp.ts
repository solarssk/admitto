import { authenticator } from "otplib";
import { encryptToString, decryptFromString } from "@admitto/crypto";

authenticator.options = {
  step: 30,
  window: 1,
};

/** Generate a new TOTP secret (base32). */
export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

/** Build otpauth URI for QR display (shown once at enrollment). */
export function buildTotpOtpauthUri(secret: string, email: string, issuer = "Admitto"): string {
  return authenticator.keyuri(email, issuer, secret);
}

/** Encrypt TOTP secret for DB storage. */
export function encryptTotpSecret(secret: string): string {
  return encryptToString(secret);
}

/** Decrypt TOTP secret from DB. */
export function decryptTotpSecret(secretEnc: string): string {
  return decryptFromString(secretEnc);
}

/** Verify a 6-digit TOTP code against encrypted secret. */
export function verifyTotpCode(secretEnc: string, code: string): boolean {
  try {
    const secret = decryptTotpSecret(secretEnc);
    return authenticator.verify({ token: code.replace(/\s/g, ""), secret });
  } catch {
    return false;
  }
}

/** Verify against raw secret (tests). */
export function verifyTotpCodeWithSecret(secret: string, code: string): boolean {
  return authenticator.verify({ token: code.replace(/\s/g, ""), secret });
}

/** Current TOTP for tests. */
export function generateTotpCode(secret: string): string {
  return authenticator.generate(secret);
}
