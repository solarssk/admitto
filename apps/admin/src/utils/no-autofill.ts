/** Every field that takes one of these (SMTP username/password, Graph/Power Automate secrets, email-typed
 * settings, the attendee forms, the check-in search fields) is something the operator types once and reuses,
 * never their own account's email or password, so browser-vendor and extension autofill (1Password,
 * LastPass, Bitwarden, iCloud Hide My Email, etc.) only gets in the way: wrong suggestions, and some
 * extensions inject an overlay button that shifts layout. These are the conventional opt-out signals each
 * of those checks for.
 *
 * Bitwarden honours `data-bwignore` only for users who have switched on "Allow websites to exclude fields to
 * autofill" (off by default), so for it the field's own name, id or placeholder has to say "search" as well
 * where that makes sense (see `checkin/searchFieldAttrs.ts`). */
export const NO_AUTOFILL_PROPS = {
  autoComplete: "off",
  "data-1p-ignore": "true",
  "data-lpignore": "true",
  "data-bwignore": "true",
  "data-form-type": "other",
} as const;
