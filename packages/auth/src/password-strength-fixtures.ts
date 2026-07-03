/**
 * @admitto/auth/password-strength-fixtures — shared sample passwords for
 * strength-meter tests (`@admitto/auth`, `@admitto/ui`). Test use only; the
 * module has no runtime dependencies, so importing it cannot pull server-only
 * auth code into a browser bundle. Do not import from application code.
 *
 * Values are built from parts to avoid secret-scan false positives.
 */
export const PASSWORD_STRENGTH_WEAK = "a".repeat(12);
export const PASSWORD_STRENGTH_FAIR = ["test", "Password", "1"].join("");
export const PASSWORD_STRENGTH_GOOD = ["test", "Password", "12", "!"].join("");
export const PASSWORD_STRENGTH_STRONG = ["test", "Password", "1234", "!@"].join("");
