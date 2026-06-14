/**
 * @admitto/auth/testing — TOTP helpers for unit/integration tests only.
 * Do not import from application code.
 */
export { generateTotpSecret, encryptTotpSecret } from "./mfa/totp.js";
export { generateTotpCode, verifyTotpCodeWithSecret } from "./mfa/totp.js";
