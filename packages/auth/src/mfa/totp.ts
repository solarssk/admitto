import { Authenticator } from "@otplib/v12-adapter";
import { encryptToString, decryptFromString } from "@admitto/crypto";

/** Isolated TOTP instance (30s step, ±1 window) — no global otplib singleton mutation. */
const totp = new Authenticator({ step: 30, window: 1 });

/** Generate a new TOTP secret (base32). */
export function generateTotpSecret(): string {
  return totp.generateSecret();
}

/** Build otpauth URI for QR display (shown once at enrollment). */
export function buildTotpOtpauthUri(secret: string, email: string, issuer = "Admitto"): string {
  return totp.keyuri(email, issuer, secret);
}

/** Encrypt TOTP secret for DB storage. */
export function encryptTotpSecret(secret: string): string {
  return encryptToString(secret);
}

/** Decrypt TOTP secret from DB (enrollment resume / tests only). */
export function decryptTotpSecret(secretEnc: string): string {
  return decryptFromString(secretEnc);
}

/** Verify a 6-digit TOTP code against encrypted secret. */
export function verifyTotpCode(secretEnc: string, code: string): boolean {
  try {
    const secret = decryptTotpSecret(secretEnc);
    return totp.verify({ token: code.replace(/\s/g, ""), secret });
  } catch {
    return false;
  }
}

/** @internal Used by @admitto/auth/testing — not part of the public auth API. */
export function verifyTotpCodeWithSecret(secret: string, code: string): boolean {
  return totp.verify({ token: code.replace(/\s/g, ""), secret });
}

/** @internal Used by @admitto/auth/testing — not part of the public auth API. */
export function generateTotpCode(secret: string): string {
  return totp.generate(secret);
}
