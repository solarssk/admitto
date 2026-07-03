import { PASSWORD_MIN_LENGTH } from "./constants.js";

export type PasswordStrengthLevel = "empty" | "weak" | "fair" | "good" | "strong";

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
export function scorePasswordStrengthInline(
  password: string,
  minLength: number,
): { score: number; label: string; level: PasswordStrengthLevel } {
  if (!password) return { score: 0, label: "", level: "empty" };
  if (password.length < minLength) return { score: 0, label: "Too short", level: "weak" };

  let points = 0;
  if (password.length >= minLength) points += 1;
  if (password.length >= 16) points += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) points += 1;
  if (/\d/.test(password)) points += 1;
  if (/[^a-zA-Z0-9]/.test(password)) points += 1;

  if (points <= 2) return { score: 1, label: "Weak", level: "weak" };
  if (points === 3) return { score: 2, label: "Fair", level: "fair" };
  if (points === 4) return { score: 3, label: "Good", level: "good" };
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
