import { PASSWORD_MIN_LENGTH } from "./constants.js";

export type PasswordStrengthLevel = "empty" | "tooShort" | "weak" | "fair" | "good" | "strong";

export interface PasswordStrengthResult {
  level: PasswordStrengthLevel;
  /** Filled segments in the 4-segment meter (0 when empty or too short). */
  score: number;
  /** Short text label for screen readers and visible copy. */
  label: string;
}

/**
 * Browser-safe scorer embedded in auth HTML via `passwordStrengthAuthScript()`.
 * Keep algorithm in sync with `scorePasswordStrength`.
 */
/** Filled segments while password is below min length (1–4, never 0 when length > 0). */
export function tooShortProgressScore(length: number, minLength: number): number {
  if (length <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((length / minLength) * 4)));
}

/** True when a password has very low character variety or is a simple ascending/descending run. */
export function hasNearZeroEntropy(password: string): boolean {
  const lower = password.toLowerCase();
  const uniqueRatio = new Set(lower).size / lower.length;
  if (uniqueRatio <= 0.25) return true;
  return isSimpleAsciiRun(lower);
}

export function isSimpleAsciiRun(lower: string): boolean {
  if (lower.length < 6) return false;
  let ascending = true;
  let descending = true;
  for (let i = 1; i < lower.length; i++) {
    const step = lower.charCodeAt(i) - lower.charCodeAt(i - 1);
    if (step !== 1) ascending = false;
    if (step !== -1) descending = false;
    if (!ascending && !descending) return false;
  }
  return ascending || descending;
}

export function strengthPoints(password: string): number {
  const lower = password.toLowerCase();
  const uniqueRatio = new Set(lower).size / lower.length;
  let points = 1;
  if (password.length >= 16) points += 1;
  if (password.length >= 20) points += 1;
  if (uniqueRatio >= 0.6) points += 1;
  return points;
}

/**
 * NIST SP 800-63B-4 §3.1.1.2 recommends scoring length and unpredictability
 * over character-composition rules — requiring "upper + lower + digit +
 * symbol" nudges users toward predictable substitutions ("P@ssw0rd1")
 * without meaningfully raising guessing resistance. This scorer rewards
 * length and character variety instead, and floors near-zero-entropy
 * passwords (a single repeated character, e.g. "aaaaaaaaaaaa", or a simple
 * ascending/descending run, e.g. "abcdefghijkl") to "Weak" regardless of
 * length, since padding a trivial pattern with more of the same characters
 * does not add real guessing resistance.
 *
 * Self-contained by design: embedded in the browser via `.toString()` (see
 * `passwordStrengthAuthScript()`), so it cannot import
 * `password-blocklist.ts` or anything else. The near-zero-entropy check
 * below is a small, deliberate, inlined duplicate of that module's
 * `hasTrivialCharacterPattern` (same reasoning, kept independent) — see
 * that module's doc comment for why the strength meter does not share code
 * with it, and `password-strength.test.ts` for the parity test that keeps
 * both scorers producing the same verdicts.
 */
export function scorePasswordStrengthInline(
  password: string,
  minLength: number,
): { score: number; label: string; level: PasswordStrengthLevel } {
  if (!password) return { score: 0, label: "", level: "empty" };
  if (password.length < minLength) {
    return {
      score: tooShortProgressScore(password.length, minLength),
      label: "Too short",
      // Distinct from a genuine post-minlength "weak" verdict: incomplete
      // progress should read as neutral, not an alarming red warning.
      level: "tooShort",
    };
  }

  if (hasNearZeroEntropy(password)) {
    return { score: 1, label: "Weak", level: "weak" };
  }

  const points = strengthPoints(password);
  if (points <= 1) return { score: 1, label: "Weak", level: "weak" };
  if (points === 2) return { score: 2, label: "Fair", level: "fair" };
  if (points === 3) return { score: 3, label: "Good", level: "good" };
  return { score: 4, label: "Strong", level: "strong" };
}

/** Score a candidate password for UI feedback (does not gate server validation). */
export function scorePasswordStrength(password: string): PasswordStrengthResult {
  const result = scorePasswordStrengthInline(password, PASSWORD_MIN_LENGTH);
  return {
    level: result.level,
    score: result.score,
    label: result.label,
  };
}

/**
 * Actionable next step to raise the score once minlength is met (empty once
 * already Strong, or while below minlength — "Too short" already says enough).
 * Names only the single highest-impact missing ingredient — guarantees a
 * short, one-line message instead of a long list that could wrap and
 * overlap the next field. Browser-safe — embedded into auth HTML via
 * `.toString()`, so (like `scorePasswordStrengthInline`) it inlines its own
 * near-zero-entropy check rather than importing one — see that function's
 * doc comment for why.
 */
export function passwordStrengthTip(password: string, minLength: number): string {
  if (!password || password.length < minLength) return "";

  if (hasNearZeroEntropy(password)) {
    return "Avoid repeated or sequential characters for a stronger score.";
  }

  const lower = password.toLowerCase();
  const uniqueRatio = new Set(lower).size / lower.length;

  let missing = "";
  if (password.length < 16) missing = "16+ characters";
  else if (password.length < 20) missing = "20+ characters";
  else if (uniqueRatio < 0.6) missing = "more variety of characters";
  if (!missing) return "";
  return "Add " + missing + " for a stronger score.";
}
