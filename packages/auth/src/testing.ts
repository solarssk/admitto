/**
 * @admitto/auth/testing — TOTP helpers for unit/integration tests only.
 * Do not import from application code.
 */
export { generateTotpSecret, encryptTotpSecret, generateTotpCode } from "./mfa/totp.js";
