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
  /** Other recently-accepted time steps, besides afterTimeStep itself, to also check a rejected
   * code's matched step against when classifying replay - see verifyTotpCodeDetailed's own doc
   * comment for why afterTimeStep alone isn't enough once a later step has been accepted. */
  recentlyConsumedTimeSteps?: readonly number[];
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
    //
    // The unconstrained check's own epochTolerance window (±1 step) can validate a code for ANY
    // step near "now", not only the exact step afterTimeStep represents - e.g. once step t is
    // accepted, a never-used code from t-1 fails the constrained check (t-1 is not after t) but
    // still passes this unconstrained one, since t-1 is within tolerance of "now" too. That code
    // was never actually used, so it must not be reported as a replay - comparing the matched step
    // against afterTimeStep (the single latest-accepted step) rules that false positive out.
    //
    // But afterTimeStep alone isn't enough either: accept t-1, then accept t (afterTimeStep is now
    // t), then replay t-1's own code - it's a genuine reuse, but t-1 no longer equals the *latest*
    // watermark, so an exact-match-against-afterTimeStep-only check would miss it (bot review
    // finding, PR #1316). recentlyConsumedTimeSteps carries the caller's own short history of
    // recently-accepted steps (not just the single latest) so a match against ANY of them, not
    // only the current watermark, is still correctly classified as reuse.
    const unconstrained = totp.verifySync(baseOptions);
    const replay =
      options.afterTimeStep != null &&
      unconstrained.valid &&
      "timeStep" in unconstrained &&
      (unconstrained.timeStep === options.afterTimeStep ||
        (options.recentlyConsumedTimeSteps?.includes(unconstrained.timeStep) ?? false));
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

/** @internal Used by @admitto/auth/testing — not part of the public auth API. `epoch` (Unix
 * seconds) lets a test generate a code for a specific past/future time step instead of "now",
 * e.g. to construct an old-but-never-used code adjacent to one already accepted. */
export function generateTotpCode(secret: string, epoch?: number): string {
  return totp.generateSync({ secret, period: TOTP_PERIOD_SEC, ...(epoch != null ? { epoch } : {}) });
}
