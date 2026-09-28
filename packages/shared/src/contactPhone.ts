/** Phone numbers on an event's key contacts. Staff read these on the day and tap them as `tel:`
 * links, so the field accepts what a person actually types (digits, spaces, dashes, dots,
 * parentheses, one leading +) and nothing else: no letters. The digit count follows E.164 (at most
 * 15, country code included). The floor is low on purpose: an on-site contact is often a hotel desk
 * or venue extension of three or four digits, and only a stray "1" should be turned away. */
export const CONTACT_PHONE_MIN_DIGITS = 3;
export const CONTACT_PHONE_MAX_DIGITS = 15;
export const CONTACT_PHONE_MAX_LENGTH = 40;

/** Strips everything a contact phone can never contain, for a field that should not let the user
 * type it at all (a paste of "call 555 0100" keeps "555 0100"). Any kind of whitespace (a tab, a
 * non-breaking space from a web page) becomes a plain space. A `+` is kept only as the very first
 * character, and only when `allowLeadingPlus` is set: the country picker already supplies the
 * code, so its national-number field has no use for one. */
export function sanitizeContactPhoneInput(value: string, allowLeadingPlus = false): string {
  const cleaned = value.replaceAll(/\s/g, " ").replaceAll(/[^\d ().+-]/g, "");
  const withoutPlus = cleaned.replaceAll("+", "");
  return allowLeadingPlus && cleaned.trimStart().startsWith("+") ? `+${withoutPlus}` : withoutPlus;
}

/** True for a letter-free number of 3 to 15 digits in total, made only of digits, plain spaces,
 * dashes, dots, parentheses and an optional leading +. Callers treat an empty value as "no phone"
 * before asking. The pattern is one character class under a single `+`, and the length is capped
 * first, so it is linear, not a backtracking risk, on operator-submitted input. */
export function isValidContactPhone(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length > CONTACT_PHONE_MAX_LENGTH || !/^\+?[\d ().-]+$/.test(trimmed)) return false;
  const digits = trimmed.replaceAll(/\D/g, "").length;
  return digits >= CONTACT_PHONE_MIN_DIGITS && digits <= CONTACT_PHONE_MAX_DIGITS;
}
