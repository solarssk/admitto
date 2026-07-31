import type { IdentityProvider } from "@admitto/db";
import type { JWTPayload } from "jose";

export interface ExternalIdentityClaims {
  email?: string;
  name?: string;
  groups?: string[];
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

/** Extract mapped claims from a validated ID token payload. */
export function extractClaims(
  payload: JWTPayload,
  provider: Pick<IdentityProvider, "claim_email" | "claim_name" | "claim_groups">,
): ExternalIdentityClaims {
  return {
    email: asString(claimValue(payload, provider.claim_email)),
    name: asString(claimValue(payload, provider.claim_name)),
    groups: asStringArray(claimValue(payload, provider.claim_groups)),
  };
}
