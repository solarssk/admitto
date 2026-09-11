import { OTP, generateSecret, generateURI } from "otplib";
import { encryptToString, decryptFromString } from "@admitto/crypto";

export const TOTP_PERIOD_SEC = 30;
/** v12 `window: 1` = ±1 time step = ±30 seconds. */
export const TOTP_EPOCH_TOLERANCE_SEC = 30;

/** Isolated TOTP instance — no global singleton. */
const totp = new OTP({ strategy: "totp" });

export type TotpVerifyResult =
  | { valid: true; timeStep: number }
  | { valid: false; replay: boolean };

/** Generate a new TOTP secret (base32). */
export function generateTotpSecret(): string {
  return generateSecret();
}

/** Build otpauth URI for QR display (shown once at enrollment). */
export function buildTotpOtpauthUri(secret: string, email: string, issuer = "Admitto"): string {
  return generateURI({ issuer, label: email, secret });
}

/** Extract base32 setup key from an otpauth://totp URI (manual entry / copy). */
export function parseTotpSecretFromOtpauthUri(uri: string): string | null {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== "otpauth:") return null;
    const secret = parsed.searchParams.get("secret")?.trim();
    return secret || null;
  } catch {
    return null;
  }
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

export interface VerifyTotpCodeOptions {
  /** Reject matches at or before this time step (otplib replay protection). */
  afterTimeStep?: number | null;
}

/** Verify a 6-digit TOTP code; returns matched time step when valid. */
export function verifyTotpCodeDetailed(
  secretEnc: string,
  code: string,
  options: VerifyTotpCodeOptions = {},
): TotpVerifyResult {
  try {
    const secret = decryptTotpSecret(secretEnc);
    const baseOptions = {
      token: normalizeToken(code),
      secret,
      period: TOTP_PERIOD_SEC,
      epochTolerance: TOTP_EPOCH_TOLERANCE_SEC,
    };
    const verifyOptions: typeof baseOptions & { afterTimeStep?: number } =
      options.afterTimeStep != null ? { ...baseOptions, afterTimeStep: options.afterTimeStep } : baseOptions;

    const result = totp.verifySync(verifyOptions);
    if (result.valid && "timeStep" in result) {
      return { valid: true, timeStep: result.timeStep };
    }
    // A code rejected only because of the afterTimeStep replay-protection constraint - not
    // because it's actually wrong - would otherwise have verified successfully without it. That
    // specific case is a genuine replay of an already-used, cryptographically valid code (ASVS
    // V2.8.5, CWE-287): a signal worth alerting the account owner about, distinct from an
    // ordinary wrong guess. Only recomputed when a constraint was actually supplied to begin
    // with - no watermark, nothing to have been replayed against.
    const replay = options.afterTimeStep != null && totp.verifySync(baseOptions).valid;
    return { valid: false, replay };
  } catch {
    return { valid: false, replay: false };
  }
}

/** Verify a 6-digit TOTP code against encrypted secret. */
export function verifyTotpCode(
  secretEnc: string,
  code: string,
  options: VerifyTotpCodeOptions = {},
): boolean {
  return verifyTotpCodeDetailed(secretEnc, code, options).valid;
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
