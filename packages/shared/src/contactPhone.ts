/** Phone numbers on an event's key contacts. Staff read these on the day and tap them as `tel:`
 * links, so the field accepts what a person actually types (digits, spaces, dashes, dots,
 * parentheses, one leading +) and nothing else: no letters. The digit count follows E.164 (at most
 * 15, country code included), with a floor so a stray "12" is not saved as a contact number. */
export const CONTACT_PHONE_MIN_DIGITS = 6;
export const CONTACT_PHONE_MAX_DIGITS = 15;
const CONTACT_PHONE_MAX_LENGTH = 40;

/** Strips everything a contact phone can never contain, for a field that should not let the user
 * type it at all (a paste of "call 555 0100" keeps "555 0100"). A `+` is kept only as the very
 * first character, and only when `allowLeadingPlus` is set: the country picker already supplies the
 * code, so its national-number field has no use for one. */
export function sanitizeContactPhoneInput(value: string, allowLeadingPlus = false): string {
  const withoutPlus = value.replace(/[^\d\s().+-]/g, "").replace(/\+/g, "");
  return allowLeadingPlus && value.trimStart().startsWith("+") ? `+${withoutPlus}` : withoutPlus;
}

/** True for an empty-free, letter-free number with 6 to 15 digits in total. Callers treat an empty
 * value as "no phone" before asking. The pattern is one character class under a single `+`, so it
 * is linear, not a backtracking risk, on operator-submitted input. */
export function isValidContactPhone(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length > CONTACT_PHONE_MAX_LENGTH || !/^\+?[\d\s().-]+$/.test(trimmed)) return false;
  const digits = trimmed.replace(/\D/g, "").length;
  return digits >= CONTACT_PHONE_MIN_DIGITS && digits <= CONTACT_PHONE_MAX_DIGITS;
}
