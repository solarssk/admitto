/** Pragmatic format check (not full RFC 5322), mirroring the server-side check in
 * @admitto/auth's isValidEmailFormat - kept as a small local copy rather than a shared package
 * export since apps/admin only ever imports pure browser-safe pieces of @admitto/auth
 * (the /constants subpath), not its main entry, which pulls in server-only session/hashing code. */
export function isValidEmailFormat(email: string): boolean {
  const at = email.indexOf("@");
  if (at < 1 || email.includes("@", at + 1)) return false;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  // Plain substring checks instead of a single backtracking regex - see the server-side copy in
  // @admitto/auth's user.ts for why (CodeQL polynomial ReDoS on operator-submitted input).
  if (/\s/.test(local) || /\s/.test(domain)) return false;
  return domain.length >= 3 && domain.slice(1, -1).includes(".");
}
