/**
 * @admitto/auth/password-strength-fixtures — shared sample passwords for
 * strength-meter tests (`@admitto/auth`, `@admitto/ui`). Test use only; the
 * module has no runtime dependencies, so importing it cannot pull server-only
 * auth code into a browser bundle. Do not import from application code.
 *
 * Values are built from parts to avoid secret-scan false positives.
 *
 * Chosen to land on each of the 4 post-minlength levels of the length +
 * variety scorer in `password-strength.ts` (12 chars = PASSWORD_MIN_LENGTH):
 * WEAK is a single repeated character (near-zero entropy, floored to Weak
 * regardless of length); FAIR is 12–15 chars with good variety; GOOD is
 * 16–19 chars with good variety; STRONG is 20+ chars with good variety.
 */
export const PASSWORD_STRENGTH_WEAK = "a".repeat(12);
export const PASSWORD_STRENGTH_FAIR = ["test", "Password", "1"].join("");
export const PASSWORD_STRENGTH_GOOD = ["test", "Password", "123", "!"].join("");
export const PASSWORD_STRENGTH_STRONG = ["test", "Password", "123456", "!@"].join("");
