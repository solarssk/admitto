import { PASSWORD_MIN_LENGTH } from "./constants.js";
import { isPasswordTooCommon } from "./password-blocklist.js";

export type PasswordPolicyFailureCode = "password_too_short" | "password_too_common";

/** Thrown when a candidate password fails shared server-side policy checks. */
export class PasswordPolicyError extends Error {
  constructor(public readonly code: PasswordPolicyFailureCode) {
    super(code);
    this.name = "PasswordPolicyError";
  }
}

/** Enforce minimum length and blocklist policy before persisting a password. */
export function assertPasswordMeetsPolicy(password: string): void {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new PasswordPolicyError("password_too_short");
  }
  if (isPasswordTooCommon(password)) {
    throw new PasswordPolicyError("password_too_common");
  }
}
