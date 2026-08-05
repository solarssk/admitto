/** Pragmatic format check (not full RFC 5322), mirroring the server-side check in
 * @admitto/auth's isValidEmailFormat - kept as a small local copy rather than a shared package
 * export since apps/admin only ever imports pure browser-safe pieces of @admitto/auth
 * (the /constants subpath), not its main entry, which pulls in server-only session/hashing code. */
export function isValidEmailFormat(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
