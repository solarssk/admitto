import { describe, expect, it } from "vitest";
import type { IdentityProvider } from "@admitto/db";
import type { JWTPayload } from "jose";
import { extractClaims, isEmailVerificationDenied, readClaimStrings } from "../src/oidc/claims.js";

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

  it("does not turn malformed group data into an empty revocation assertion", () => {
    expect(extractClaims({ groups: ["operators", 42] } as JWTPayload, provider).groups).toBeUndefined();
    expect(extractClaims({ groups: "   " } as JWTPayload, provider).groups).toBeUndefined();
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

describe("readClaimStrings", () => {
  it("reads a string as one value and an array of strings as its members", () => {
    expect(readClaimStrings({ tid: "tenant-a" } as JWTPayload, "tid")).toEqual(["tenant-a"]);
    expect(readClaimStrings({ roles: ["a", "b"] } as JWTPayload, "roles")).toEqual(["a", "b"]);
  });

  it("is undefined, not an empty list, for a claim that is missing or not strings", () => {
    expect(readClaimStrings({} as JWTPayload, "tid")).toBeUndefined();
    expect(readClaimStrings({ tid: 7 } as JWTPayload, "tid")).toBeUndefined();
    expect(readClaimStrings({ tid: "  " } as JWTPayload, "tid")).toBeUndefined();
    expect(readClaimStrings({ roles: ["a", 3] } as JWTPayload, "roles")).toBeUndefined();
    expect(readClaimStrings({ roles: [{}] } as JWTPayload, "roles")).toBeUndefined();
  });

  it("reads only a claim the token owns", () => {
    const payload = Object.create({ tid: "inherited" }) as JWTPayload;
    expect(readClaimStrings(payload, "tid")).toBeUndefined();
    expect(readClaimStrings({} as JWTPayload, "__proto__")).toBeUndefined();
    expect(readClaimStrings({} as JWTPayload, "constructor")).toBeUndefined();
  });
});

describe("isEmailVerificationDenied", () => {
  it("is not a denial when the provider sends no email_verified (Microsoft Entra ID)", () => {
    expect(isEmailVerificationDenied({} as JWTPayload)).toBe(false);
  });

  it("accepts true and the string true", () => {
    expect(isEmailVerificationDenied({ email_verified: true } as JWTPayload)).toBe(false);
    expect(isEmailVerificationDenied({ email_verified: "true" } as JWTPayload)).toBe(false);
  });

  it("denies false, the string false and anything that is not a yes", () => {
    for (const value of [false, "false", "FALSE", null, 0, 1, "", {}, []]) {
      expect(isEmailVerificationDenied({ email_verified: value } as JWTPayload)).toBe(true);
    }
  });

  it("does not take an inherited claim for the token's own", () => {
    const payload = Object.create({ email_verified: false }) as JWTPayload;
    expect(isEmailVerificationDenied(payload)).toBe(false);
  });
});
