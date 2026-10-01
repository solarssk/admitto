/**
 * Bitwarden's own test for "this is a search box, not a login or email field" (`isSearchField` in
 * `apps/browser/src/autofill/services/inline-menu-field-qualification.service.ts` of bitwarden/clients,
 * checked 2026-10): the field's `type`, `name`, `id` and `placeholder` are split into words, and one of
 * "search", "query", "find" or "go" among them takes the field out of its inline menu.
 *
 * The check-in search fields must pass it. A page's own `data-bwignore` is honoured only when the user has
 * switched on "Allow websites to exclude fields to autofill" in the extension (it is off by default), and a
 * placeholder such as "type name/email" is otherwise enough for it to offer to fill an email address.
 */
const SEARCH_WORDS = new Set(["search", "query", "find", "go"]);

export function bitwardenTreatsAsSearchField(input: HTMLInputElement): boolean {
  const values = [input.type, input.getAttribute("name"), input.id, input.placeholder];
  return values.some((value) => {
    if (!value) return false;
    const words = value
      .replaceAll(/([a-z])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .split(/[^a-z]/i);
    return words.some((word) => SEARCH_WORDS.has(word));
  });
}
