import { describe, expect, it } from "vitest";
import type { IdentityProvider } from "@admitto/db";
import type { JWTPayload } from "jose";
import { extractClaims } from "../src/oidc/claims.js";

const provider = {
  claim_email: "email",
  claim_name: "name",
  claim_groups: "groups",
  claim_given_name: "given_name",
  claim_family_name: "family_name",
  claim_phone: "phone_number",
} satisfies Pick<
  IdentityProvider,
  "claim_email" | "claim_name" | "claim_groups" | "claim_given_name" | "claim_family_name" | "claim_phone"
>;

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

  it("reads the phone claim", () => {
    const payload = { phone_number: "+14155552671" } as JWTPayload;

    expect(extractClaims(payload, provider).phone).toBe("+14155552671");
  });

  it("distinguishes an omitted groups claim from an explicit empty assertion", () => {
    expect(extractClaims({} as JWTPayload, provider).groups).toBeUndefined();
    expect(extractClaims({ groups: [] } as JWTPayload, provider).groups).toEqual([]);
  });

  it("composes name from given_name + family_name when the combined name claim is absent", () => {
    const payload = { given_name: "Ada", family_name: "Lovelace" } as JWTPayload;

    expect(extractClaims(payload, provider).name).toBe("Ada Lovelace");
  });

  it("prefers the combined name claim over given_name/family_name when both are present", () => {
    const payload = { name: "Ada L.", given_name: "Ada", family_name: "Lovelace" } as JWTPayload;

    expect(extractClaims(payload, provider).name).toBe("Ada L.");
  });

  it("leaves name undefined when neither the combined nor given/family name claims are present", () => {
    const payload = {} as JWTPayload;

    expect(extractClaims(payload, provider).name).toBeUndefined();
  });
});
