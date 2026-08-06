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

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  }
  return [];
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

/** Extract mapped claims from a validated ID token payload. */
export function extractClaims(
  payload: JWTPayload,
  provider: Pick<
    IdentityProvider,
    "claim_email" | "claim_name" | "claim_groups" | "claim_given_name" | "claim_family_name" | "claim_phone"
  >,
): ExternalIdentityClaims {
  return {
    email: asString(claimValue(payload, provider.claim_email)),
    name: asString(claimValue(payload, provider.claim_name)) ?? fallbackName(payload, provider),
    groups: asStringArray(claimValue(payload, provider.claim_groups)),
    phone: asString(claimValue(payload, provider.claim_phone)),
  };
}
