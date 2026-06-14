import { OTP, generateSecret, generateURI } from "otplib";
import { encryptToString, decryptFromString } from "@admitto/crypto";

const TOTP_PERIOD_SEC = 30;
/** v12 `window: 1` = ±1 time step = ±30 seconds. */
const TOTP_EPOCH_TOLERANCE_SEC = 30;

/** Isolated TOTP instance — no global singleton. */
const totp = new OTP({ strategy: "totp" });

/** Generate a new TOTP secret (base32). */
export function generateTotpSecret(): string {
  return generateSecret();
}

/** Build otpauth URI for QR display (shown once at enrollment). */
export function buildTotpOtpauthUri(secret: string, email: string, issuer = "Admitto"): string {
  return generateURI({ issuer, label: email, secret });
}

/** Encrypt TOTP secret for DB storage. */
export function encryptTotpSecret(secret: string): string {
  return encryptToString(secret);
}

/** Decrypt TOTP secret from DB (enrollment resume / tests only). */
export function decryptTotpSecret(secretEnc: string): string {
  return decryptFromString(secretEnc);
}

function normalizeToken(code: string): string {
  return code.replace(/\s/g, "");
}

/** Verify a 6-digit TOTP code against encrypted secret. */
export function verifyTotpCode(secretEnc: string, code: string): boolean {
  try {
    const secret = decryptTotpSecret(secretEnc);
    return totp.verifySync({
      token: normalizeToken(code),
      secret,
      period: TOTP_PERIOD_SEC,
      epochTolerance: TOTP_EPOCH_TOLERANCE_SEC,
    }).valid;
  } catch {
    return false;
  }
}

/** @internal Used by @admitto/auth/testing — not part of the public auth API. */
export function verifyTotpCodeWithSecret(secret: string, code: string): boolean {
  return totp.verifySync({
    token: normalizeToken(code),
    secret,
    period: TOTP_PERIOD_SEC,
    epochTolerance: TOTP_EPOCH_TOLERANCE_SEC,
  }).valid;
}

/** @internal Used by @admitto/auth/testing — not part of the public auth API. */
export function generateTotpCode(secret: string): string {
  return totp.generateSync({ secret, period: TOTP_PERIOD_SEC });
}
