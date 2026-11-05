import type { IdentityProvider } from "@admitto/db";
import type { JWTPayload } from "jose";

export interface ExternalIdentityClaims {
  email?: string;
  name?: string;
  groups?: string[];
  phone?: string;
}

function claimValue(payload: JWTPayload, claimName: string): unknown {
  return Object.getOwnPropertyDescriptor(payload, claimName)?.value;
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

/**
 * Parse a claim that must be a string or an all-string array.
 *
 * A malformed value is deliberately `undefined`, not an empty assertion: treating a
 * partially malformed token as `[]` would revoke role grants based on data the IdP did not
 * actually assert. Callers can still distinguish an explicit empty array from a missing or
 * invalid claim.
 */
export function parseStringArrayClaim(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const values = value.map(asString);
    return values.every((entry): entry is string => entry !== undefined) ? values : undefined;
  }
  const entry = asString(value);
  return entry === undefined ? undefined : [entry];
}

/** Composes "given family" from separate claims, for IdPs that omit a combined name claim. */
function fallbackName(
  payload: JWTPayload,
  provider: Pick<IdentityProvider, "claim_given_name" | "claim_family_name">,
): string | undefined {
  const givenName = asString(claimValue(payload, provider.claim_given_name));
  const familyName = asString(claimValue(payload, provider.claim_family_name));
  return asString([givenName, familyName].filter(Boolean).join(" "));
}

/**
 * Extract mapped claims from a validated ID token payload.
 *
 * Reads only the ID token - never calls the provider's `userinfo_endpoint`. This was already
 * true for claim_email/claim_name/claim_groups; claim_phone/claim_given_name/claim_family_name
 * inherit the same limitation. Some IdPs only return `phone_number`/`address`-scope claims from
 * UserInfo, not embedded in the ID token (OIDC Core 5.4), so phone sync stays inactive for those
 * providers until UserInfo fetching (with its own `sub` verification) is added.
 */
export function extractClaims(
  payload: JWTPayload,
  provider: Pick<
    IdentityProvider,
    "claim_email" | "claim_name" | "claim_groups" | "claim_given_name" | "claim_family_name" | "claim_phone"
  >,
): ExternalIdentityClaims {
  const groups = parseStringArrayClaim(claimValue(payload, provider.claim_groups));
  return {
    email: asString(claimValue(payload, provider.claim_email)),
    name: asString(claimValue(payload, provider.claim_name)) ?? fallbackName(payload, provider),
    // Absence (or an invalid shape) is deliberately not the same as an explicit empty group
    // list. Login-time group synchronisation must not revoke prior OIDC grants merely because
    // an IdP omitted a claim in this particular token.
    ...(groups === undefined ? {} : { groups }),
    phone: asString(claimValue(payload, provider.claim_phone)),
  };
}

/**
 * The values of ONE claim of a validated ID token, for a check that compares them with a list (the restriction of a guest
 * event to the people of one company, which reads a claim such as `tid`). A string is one value and an array of strings is
 * its members; a claim that is missing, of another type, or an array with a member that is not a string is `undefined`:
 * not asserted, never an empty list that would match a list of nothing. Only a claim the token owns is read, so a name such
 * as `__proto__` or `constructor` finds nothing.
 */
export function readClaimStrings(payload: JWTPayload, claimName: string): string[] | undefined {
  return parseStringArrayClaim(claimValue(payload, claimName));
}

/**
 * Whether the provider says it did NOT verify the address in the token. `email_verified` that is missing is not a denial
 * (Microsoft Entra ID never sends it, and an administrator maps `claim_email` to what the directory holds). One that is
 * `true`, or the string "true" that Amazon Cognito sends, is a yes. Anything else is a denial: `false`, "false", `null`, a
 * number, an object. Reads the token's own claim, not an inherited one.
 */
export function isEmailVerificationDenied(payload: JWTPayload): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(payload, "email_verified");
  if (descriptor === undefined) return false;
  const value: unknown = descriptor.value;
  return value !== true && value !== "true";
}
