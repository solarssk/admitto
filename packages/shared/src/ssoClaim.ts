/**
 * What an organiser may enter as the restriction of an event's company sign-in to one company (D-C4): the name of ONE claim of the
 * provider's ID token (for example `tid`, the tenant of Microsoft Entra ID) and the values of it that may register. The rules are
 * written once, here, for the server that refuses a save and for the form that tells the person before they send it, so the two
 * cannot drift apart.
 */

/** The longest name of a claim: URIs are used as claim names, and nothing longer is. */
export const SSO_CLAIM_NAME_MAX = 100;
/** The longest value of a claim that is accepted (a GUID is 36, a company name is shorter than this). */
export const SSO_CLAIM_VALUE_MAX = 128;
/** The most values one event lists. A company with several tenants, not a directory. */
export const SSO_CLAIM_VALUES_MAX = 20;

/** The name of a claim: printable ASCII with no space, as a claim name or a URI is. */
const CLAIM_NAME_CHARACTERS = /^[\x21-\x7e]+$/;
const CONTROL_CHARACTER = /\p{Cc}/u;

export type SsoClaimNameProblem = "too_long" | "bad_characters";
export type SsoClaimValueProblem = "too_long" | "control_character";

/** What is wrong with a claim name that is not empty (the spaces around what was typed are cut off first), or null. */
export function ssoClaimNameProblem(name: string): SsoClaimNameProblem | null {
  if (name.length > SSO_CLAIM_NAME_MAX) return "too_long";
  return CLAIM_NAME_CHARACTERS.test(name) ? null : "bad_characters";
}

/** What is wrong with one value of a claim that is not empty (cut off the same way), or null. */
export function ssoClaimValueProblem(value: string): SsoClaimValueProblem | null {
  if (value.length > SSO_CLAIM_VALUE_MAX) return "too_long";
  return CONTROL_CHARACTER.test(value) ? "control_character" : null;
}
