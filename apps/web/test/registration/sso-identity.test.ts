/**
 * What a validated ID token makes of a guest (D-C4): the person, the restriction to one company, the address. One pure
 * function, so each rule is tried alone. The token has been verified before it gets here.
 */
import type { JWTPayload } from "jose";
import { describe, expect, it } from "vitest";
import { SSO_SUBJECT_MAX, identityFromToken, noticeFor, noticeFromQuery, type SsoRefusal } from "../../src/registration/sso-identity.js";
import { matchClaim, proofSatisfies, restrictionOf, type ClaimRestriction } from "../../src/registration/sso-claim.js";

const standard = {
  claim_email: "email",
  claim_name: "name",
  claim_groups: "groups",
  claim_given_name: "given_name",
  claim_family_name: "family_name",
  claim_phone: "phone_number",
};
const token = (claims: Record<string, unknown> = {}): JWTPayload => ({ sub: "00uabc123", email: "ada@example.com", ...claims });
const tenant: ClaimRestriction = { name: "tid", values: ["tenant-a", "tenant-b"] };

describe("the person", () => {
  it("is the provider's sub, with the address as contact data", () => {
    expect(identityFromToken(token(), standard, null)).toEqual({ ok: true, subject: "00uabc123", email: "ada@example.com", proof: null });
  });

  it("is refused without a sub, with an empty one, a number, or one longer than OIDC allows", () => {
    for (const sub of [undefined, "", 7, ["a"], "s".repeat(SSO_SUBJECT_MAX + 1)]) {
      expect(identityFromToken(token({ sub }), standard, null), String(sub)).toEqual({ ok: false, reason: "no_subject" });
    }
    expect(identityFromToken(token({ sub: "s".repeat(SSO_SUBJECT_MAX) }), standard, null).ok).toBe(true);
  });
});

describe("the address", () => {
  it("is the one the provider's mapping names, as for staff: Entra ID sends none and the administrator maps it to preferred_username", () => {
    const entra = { ...standard, claim_email: "preferred_username" };

    expect(identityFromToken(token({ email: undefined, preferred_username: "ada@contoso.example" }), entra, null)).toMatchObject({
      ok: true,
      email: "ada@contoso.example",
    });
    // Not a fallback of ours: an `email` claim the mapping does not name is not read.
    expect(identityFromToken(token({ email: "other@example.com" }), entra, null)).toEqual({ ok: false, reason: "no_email" });
  });

  it("is normalised as the form would take it: trimmed, lower case", () => {
    expect(identityFromToken(token({ email: "  Ada.Lovelace@Example.COM " }), standard, null)).toMatchObject({ email: "ada.lovelace@example.com" });
  });

  it("is refused when it is missing, blank, not an address, or in the namespace of erased attendees", () => {
    for (const email of [undefined, "", "   ", "not an address", "a@b", 12, ["ada@example.com"], "erased-1@erased.invalid"]) {
      expect(identityFromToken(token({ email }), standard, null), String(email)).toEqual({ ok: false, reason: "no_email" });
    }
  });

  it("is not believed when the provider says it is not verified, and is when it says so or says nothing", () => {
    for (const email_verified of [false, "false", "FALSE", null, 0, "", {}]) {
      expect(identityFromToken(token({ email_verified }), standard, null), String(email_verified)).toEqual({ ok: false, reason: "email_unverified" });
    }
    for (const email_verified of [true, "true"]) {
      expect(identityFromToken(token({ email_verified }), standard, null).ok, String(email_verified)).toBe(true);
    }
    expect(identityFromToken(token(), standard, null).ok).toBe(true);
  });
});

describe("the restriction to one company", () => {
  it("lets in a person whose claim holds one of the values, and keeps which", () => {
    expect(identityFromToken(token({ tid: "tenant-b" }), standard, tenant)).toMatchObject({ ok: true, proof: { name: "tid", value: "tenant-b" } });
  });

  it("reads a claim that is a list as its members, and takes the first member that is listed", () => {
    expect(identityFromToken(token({ tid: ["other", "tenant-b", "tenant-a"] }), standard, tenant)).toMatchObject({
      ok: true,
      proof: { name: "tid", value: "tenant-b" },
    });
  });

  it("refuses a person whose claim holds none of the values, holds nothing, or is not strings", () => {
    for (const tid of ["tenant-c", [], ["other"], undefined, 7, null, { id: "tenant-a" }, ["tenant-a", 7]]) {
      expect(identityFromToken(token({ tid }), standard, tenant), JSON.stringify(tid)).toEqual({ ok: false, reason: "not_allowed" });
    }
  });

  it("compares exactly, not by case and not by part", () => {
    for (const tid of ["Tenant-A", "TENANT-A", "tenant-a-and-more", "enant-a", "tenant"]) {
      expect(identityFromToken(token({ tid }), standard, tenant), tid).toEqual({ ok: false, reason: "not_allowed" });
    }
  });

  it("reads the claim the token owns, and never one it inherits or a name that is on every object", () => {
    const inherited = Object.assign(Object.create({ tid: "tenant-a" }) as JWTPayload, { sub: "00uabc123", email: "ada@example.com" });

    expect(identityFromToken(inherited, standard, tenant)).toEqual({ ok: false, reason: "not_allowed" });
    expect(identityFromToken(token(), standard, { name: "constructor", values: ["Object"] })).toEqual({ ok: false, reason: "not_allowed" });
    expect(identityFromToken(token(), standard, { name: "__proto__", values: ["x"] })).toEqual({ ok: false, reason: "not_allowed" });
  });

  it("is not made up from the end of the address: a person whose address ends as the company's does is not let in by it", () => {
    expect(identityFromToken(token({ email: "ada@tenant-a" }), standard, tenant)).toEqual({ ok: false, reason: "not_allowed" });
    expect(identityFromToken(token({ email: "ada@tenant-a.example", tid: undefined }), standard, tenant)).toEqual({ ok: false, reason: "not_allowed" });
  });

  it("judges the restriction before the address, so a person the event does not take learns nothing about their address", () => {
    expect(identityFromToken(token({ email: undefined, tid: "tenant-c" }), standard, tenant)).toEqual({ ok: false, reason: "not_allowed" });
    expect(identityFromToken(token({ email_verified: false, tid: "tenant-c" }), standard, tenant)).toEqual({ ok: false, reason: "not_allowed" });
    expect(identityFromToken(token({ email_verified: false, tid: "tenant-a" }), standard, tenant)).toEqual({ ok: false, reason: "email_unverified" });
  });

  it("asks nothing of the token when the event has none", () => {
    expect(identityFromToken(token({ tid: undefined }), standard, null).ok).toBe(true);
  });
});

describe("the words a refusal comes back with", () => {
  it("are a closed set: three words for the five reasons, and the general one for what the guest cannot mend", () => {
    const words: Record<SsoRefusal, string> = {
      no_subject: "failed",
      not_allowed: "not_allowed",
      email_unverified: "no_email",
      no_email: "no_email",
    };
    for (const [reason, word] of Object.entries(words)) expect(noticeFor(reason as SsoRefusal), reason).toBe(word);
  });

  it("are believed when they come back in the address of the page only if they are exactly one of them", () => {
    expect(noticeFromQuery("failed")).toBe("failed");
    expect(noticeFromQuery("no_email")).toBe("no_email");
    expect(noticeFromQuery("not_allowed")).toBe("not_allowed");
    for (const value of [undefined, "", "FAILED", "failed ", " failed", "failed&x=1", "<script>", "__proto__", "constructor", "toString", "1"]) {
      expect(noticeFromQuery(value), String(value)).toBeNull();
    }
  });
});

describe("the restriction as the columns of an event hold it", () => {
  it("is a claim with values, or none: half a pair is none", () => {
    expect(restrictionOf("tid", ["a"])).toEqual({ name: "tid", values: ["a"] });
    expect(restrictionOf(null, [])).toBeNull();
    expect(restrictionOf("tid", [])).toBeNull();
    expect(restrictionOf(null, ["a"])).toBeNull();
  });

  it("is met by a proof of the same claim with a value that is listed now, and by any proof when there is none", () => {
    expect(proofSatisfies(null, null)).toBe(true);
    expect(proofSatisfies(null, { name: "tid", value: "x" })).toBe(true);
    expect(proofSatisfies(tenant, { name: "tid", value: "tenant-a" })).toBe(true);
  });

  it("is not met by no proof, a proof of another claim, or a value the event has since taken off its list", () => {
    expect(proofSatisfies(tenant, null)).toBe(false);
    expect(proofSatisfies(tenant, { name: "groups", value: "tenant-a" })).toBe(false);
    expect(proofSatisfies(tenant, { name: "tid", value: "tenant-c" })).toBe(false);
    expect(proofSatisfies({ name: "tid", values: ["tenant-b"] }, { name: "tid", value: "tenant-a" })).toBe(false);
  });

  it("finds the listed value of a claim, and nothing when it is not asserted", () => {
    expect(matchClaim(tenant, ["tenant-b"])).toEqual({ name: "tid", value: "tenant-b" });
    expect(matchClaim(tenant, [])).toBeNull();
    expect(matchClaim(tenant, undefined)).toBeNull();
  });
});
