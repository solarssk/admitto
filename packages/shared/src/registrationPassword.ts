/**
 * The shared password of an event whose way in is the password (D-C3): the one rule about its length, kept here because
 * three places apply it. The route that sets it judges a new password by it, the guest route refuses a longer try
 * without computing a hash, and the panel of the Registration page will show it beside the field.
 *
 * Lengths are counted in characters (code points), so an emoji is one. There is no other rule: no mix of letters and
 * digits is asked for, and a space is part of the password, at either end too.
 */

/** The fewest characters an organiser may set. */
export const REGISTRATION_PASSWORD_MIN = 8;

/** The most characters an organiser may set. A guest's try that is longer cannot be the password. */
export const REGISTRATION_PASSWORD_MAX = 128;

/** The length of `value` in characters (code points). */
export function registrationPasswordLength(value: string): number {
  let length = 0;
  let at = 0;
  while (at < value.length) {
    length += 1;
    at += (value.codePointAt(at) ?? 0) > 0xffff ? 2 : 1;
  }
  return length;
}
