/** `tel:` and `mailto:` links for an event's key contacts. The stored value goes into a URL, and
 * anything typed by an editor, or saved before the form and server checked it, must not be able to
 * change what the link does: a `?subject=&body=` tail on an email would prefill a message on the
 * tap, and stray characters in a phone number are not a dial string. React escapes the attribute
 * itself, so this is about URL meaning, not markup. */

/** `tel:` with a dial string: digits, and a leading + when there is one. Separators the person
 * typed for reading (spaces, dashes, parentheses, dots) are dropped, as a phone would ignore them. */
export function telHref(phone: string): string {
  const trimmed = phone.trim();
  const dialString = trimmed.replaceAll(/\D/g, "");
  return `tel:${trimmed.startsWith("+") ? "+" : ""}${dialString}`;
}

/** `mailto:` with the address percent-encoded, so a `?`, `&` or `#` in it stays part of the
 * address instead of becoming a header. The `@` stays literal, as RFC 6068 allows and mail
 * clients expect. */
export function mailtoHref(email: string): string {
  return `mailto:${encodeURIComponent(email.trim()).replaceAll("%40", "@")}`;
}
