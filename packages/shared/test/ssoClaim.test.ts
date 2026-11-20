import { describe, expect, it } from "vitest";
import {
  SSO_CLAIM_NAME_MAX,
  SSO_CLAIM_VALUE_MAX,
  SSO_CLAIM_VALUES_MAX,
  ssoClaimNameProblem,
  ssoClaimValueProblem,
} from "../src/ssoClaim.js";

describe("the limits of the restriction of a company sign-in", () => {
  it("are the ones the server and the form both keep to", () => {
    expect([SSO_CLAIM_NAME_MAX, SSO_CLAIM_VALUE_MAX, SSO_CLAIM_VALUES_MAX]).toEqual([100, 128, 20]);
  });
});

describe("ssoClaimNameProblem", () => {
  it.each(["tid", "http://schemas.microsoft.com/identity/claims/tenantid", "a", "!", "~", "a".repeat(SSO_CLAIM_NAME_MAX)])(
    "accepts %s",
    (name) => {
      expect(ssoClaimNameProblem(name)).toBeNull();
    },
  );

  it("refuses a name longer than the limit, however plain it is", () => {
    expect(ssoClaimNameProblem("a".repeat(SSO_CLAIM_NAME_MAX + 1))).toBe("too_long");
  });

  it.each([
    ["a space", "my claim"],
    ["a tab", "a\tb"],
    ["a letter outside ASCII", "tiš"],
    ["a delete character", "a\u007fb"],
    ["a line break", "a\nb"],
    ["a name of nothing but a space", " "],
  ])("refuses %s", (_what, name) => {
    expect(ssoClaimNameProblem(name)).toBe("bad_characters");
  });
});

describe("ssoClaimValueProblem", () => {
  it.each(["8c6b1c0e-3f1a-4b8e-9a53-0e4f7c1d2b90", "Northwind Traders", "Zażółć gęślą jaźń", "v".repeat(SSO_CLAIM_VALUE_MAX)])(
    "accepts %s",
    (value) => {
      expect(ssoClaimValueProblem(value)).toBeNull();
    },
  );

  it("refuses a value longer than the limit", () => {
    expect(ssoClaimValueProblem("v".repeat(SSO_CLAIM_VALUE_MAX + 1))).toBe("too_long");
  });

  it.each([
    ["a bell", "aa\u0007bb"],
    ["a null character", "a\u0000b"],
    ["a line break", "a\nb"],
    ["a delete character", "a\u007fb"],
    ["a control character of the second block", "a\u0085b"],
  ])("refuses %s", (_what, value) => {
    expect(ssoClaimValueProblem(value)).toBe("control_character");
  });

  it("says too long when a value is both too long and holds a control character", () => {
    expect(ssoClaimValueProblem(`${"v".repeat(SSO_CLAIM_VALUE_MAX)}\u0007`)).toBe("too_long");
  });
});
