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
