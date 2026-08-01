/**
 * @admitto/auth/password-blocklist — local, static rejection list for
 * password-setting flows (setup, change-password, admin create/reset user).
 *
 * NIST SP 800-63B-4 §3.1.1.2 requires (SHALL) comparing candidate passwords
 * against a blocklist of values known to be commonly used, expected, or
 * compromised, instead of enforcing character-composition rules. This module
 * covers that requirement with:
 *
 * 1. `isPasswordBlocklisted` — exact (case-insensitive) match against a list
 *    of the most common passwords, compiled from long-published, widely
 *    cited "worst passwords" rankings (NCSC UK "Most Hacked Passwords",
 *    annual NordPass/SplashData top-lists). These are public frequency
 *    statistics, not copyrighted expression, so the list is reproduced here
 *    directly — no network call and no third-party dependency for what is a
 *    short, static wordlist (consistent with this repo's no-external-service
 *    stance for security-critical checks).
 * 2. `hasTrivialCharacterPattern` — catches passwords that dodge the exact
 *    list but are still near-zero guessing resistance: a single character
 *    repeated (e.g. "aaaaaaaaaaaa") or a simple ascending/descending run
 *    (e.g. "abcdefghijkl", "23456789"). Note the run check is per-character-code,
 *    so a digit sequence that wraps past "9" back to "0" (e.g. "1234567890")
 *    is not itself a "run" in ASCII terms — it's covered by the exact
 *    blocklist match instead (see `COMMON_PASSWORDS` above).
 *
 * This is intentionally a small, high-frequency list, not a substitute for a
 * full breach corpus (e.g. HaveIBeenPwned's k-anonymity range API) — it
 * rejects the handful of passwords an online guessing attack tries first.
 * Server-side callers SHALL reject a match; the strength meter
 * (`password-strength.ts`) is UI-only guidance and does not need to
 * duplicate this list (see the module doc there for why it stays
 * self-contained).
 */

// Grouped by pattern family for readability; values are lowercase already so
// the exported check needs no per-call normalization of the list itself.
const COMMON_PASSWORDS: readonly string[] = [
  // Sequential / repeated digits
  "123456",
  "1234567",
  "12345678",
  "123456789",
  "1234567890",
  "12345",
  "1234",
  "123123",
  "123321",
  "111111",
  "000000",
  "666666",
  "121212",
  "112233",
  "654321",
  "987654321",
  "159753",
  "102030",
  "112358",

  // Keyboard-walk patterns
  "qwerty",
  "qwerty123",
  "qwertyuiop",
  "qwertzuiop",
  "asdfghjkl",
  "asdfghjk",
  "zxcvbnm",
  "1qaz2wsx",
  "qazwsx",
  "qazwsxedc",
  "1q2w3e4r",
  "1q2w3e4r5t",
  "1qazxsw2",
  "aszxdcfv",
  "asdf1234",
  "zaq12wsx",
  "qwerasdf",
  "123qwe",
  "qwe123",

  // "password" family
  "password",
  "password1",
  "password12",
  "password123",
  "password!",
  "passw0rd",
  "passw0rd1",
  "p@ssword",
  "p@ssw0rd",
  "pass1234",
  "passwords",
  "mypassword",
  "iloveyou",
  "iloveyou1",
  "iloveyou2",

  // Generic admin / access words
  "admin",
  "administrator",
  "admin123",
  "adminadmin",
  "root",
  "toor",
  "letmein",
  "letmein1",
  "letmein123",
  "access",
  "access14",
  "master",
  "master1",
  "login",
  "changeme",
  "changeit",
  "welcome",
  "welcome1",
  "welcome123",
  "guest",
  "guest123",
  "test123",
  "temp1234",
  "temppass",
  "default",

  // Well-known "worst passwords" list entries
  "monkey",
  "monkey123",
  "dragon",
  "dragon123",
  "baseball",
  "football",
  "football1",
  "shadow",
  "superman",
  "batman",
  "trustno1",
  "sunshine",
  "sunshine1",
  "princess",
  "princess1",
  "flower",
  "hunter",
  "hunter2",
  "freedom",
  "whatever",
  "ninja",
  "mustang",
  "michael",
  "jennifer",
  "jordan23",
  "harley",
  "hockey",
  "killer",
  "george",
  "andrew",
  "charlie",
  "computer",
  "internet",
  "starwars",
  "cheese",
  "summer",
  "summer2023",
  "summer2024",
  "winter",
  "winter2023",
  "winter2024",
  "autumn",
  "december",
  "january",

  // Numeric-alpha combos frequent in breach corpora
  "abc123",
  "abcd1234",
  "abc12345",
  "a1b2c3",
  "1a2b3c4d",
  "q1w2e3r4",
  "1qaz2wsx3edc",
  "111222",
  "222222",
  "333333",
  "444444",
  "555555",
  "777777",
  "888888",
  "999999",

  // Generic org-agnostic filler often chosen when a value is "required"
  "changeme123",
  "temporary",
  "temporary1",
  "notreal123",
  "unknown123",
  "asdasd123",
];

// Normalized once at module load: case-insensitive comparison, since
// attackers (and the humans they're guessing) try "Password1" as readily as
// "password1".
const BLOCKLIST: ReadonlySet<string> = new Set(COMMON_PASSWORDS.map((entry) => entry.toLowerCase()));

/** Whether `password` exactly matches (case-insensitive) a known common/breached password. */
export function isPasswordBlocklisted(password: string): boolean {
  return BLOCKLIST.has(password.toLowerCase());
}

/**
 * Whether `password` is almost entirely a single repeated character (e.g.
 * "aaaaaaaaaaaa", "ababababab") or a simple ascending/descending run of
 * character codes (e.g. "abcdefghijkl", "23456789"). Both pass a naive
 * length check yet contribute close to zero guessing resistance, so NIST SP
 * 800-63B-4 treats them alongside blocklist matches rather than relying on
 * character-composition rules.
 */
export function hasTrivialCharacterPattern(password: string): boolean {
  if (password.length === 0) return false;
  const lower = password.toLowerCase();
  const uniqueRatio = new Set(lower).size / lower.length;
  if (uniqueRatio <= 0.25) return true;
  return isSimpleCharacterRun(lower);
}

/** True when every step between consecutive characters is +1 (or every step is -1). */
function isSimpleCharacterRun(lower: string): boolean {
  if (lower.length < 6) return false;
  let ascending = true;
  let descending = true;
  for (let i = 1; i < lower.length; i++) {
    const step = lower.charCodeAt(i) - lower.charCodeAt(i - 1);
    if (step !== 1) ascending = false;
    if (step !== -1) descending = false;
    if (!ascending && !descending) return false;
  }
  return true;
}

/** Combined SHALL-level check used by password-setting routes (setup, change, admin create/reset). */
export function isPasswordTooCommon(password: string): boolean {
  return isPasswordBlocklisted(password) || hasTrivialCharacterPattern(password);
}

/** Stable API error code returned when a candidate password fails the blocklist check. */
export const PASSWORD_TOO_COMMON_CODE = "password_too_common" as const;

/** JSON body shape shared by every password-setting route that rejects a common password. */
export function passwordTooCommonJsonBody(): {
  code: typeof PASSWORD_TOO_COMMON_CODE;
  error: typeof PASSWORD_TOO_COMMON_CODE;
} {
  return { code: PASSWORD_TOO_COMMON_CODE, error: PASSWORD_TOO_COMMON_CODE };
}
