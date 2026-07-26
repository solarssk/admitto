import { describe, expect, it } from "vitest";
import type { IdentityProvider } from "@prisma/client";
import type { JWTPayload } from "jose";
import { extractClaims } from "../src/oidc/claims.js";

const provider = {
  claim_email: "email",
  claim_name: "name",
  claim_groups: "groups",
} satisfies Pick<IdentityProvider, "claim_email" | "claim_name" | "claim_groups">;

describe("extractClaims", () => {
  it("reads only claims owned by the validated JWT payload", () => {
    const payload = Object.create({ email: "inherited@example.com" }) as JWTPayload;
    Object.defineProperty(payload, "name", { value: "Verified Staff", enumerable: true });
    Object.defineProperty(payload, "groups", { value: ["operators"], enumerable: true });

    expect(extractClaims(payload, provider)).toEqual({
      name: "Verified Staff",
      groups: ["operators"],
    });
  });
});
