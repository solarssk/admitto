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

/** For a field that holds the details of somebody else, which a member of staff types in (the email, the name, the company and the phone
 * number of an attendee): the opt-out above, and a `name` that reads as a search box to Bitwarden's own test (see
 * `test/checkin/bitwardenSearchField.ts`). Bitwarden honours the opt-out only for a user who switched that on, and otherwise offers to
 * fill in the staff member's own email, name or phone. `key` tells the fields of one form apart. The word "email" is kept out of the name:
 * Safari's "Hide My Email" reads it. */
export function attendeeFieldAttrs(key: string) {
  return { ...NO_AUTOFILL_PROPS, name: `${key}-search` } as const;
}
