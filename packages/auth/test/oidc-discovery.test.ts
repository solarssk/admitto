import { describe, expect, it } from "vitest";
import { normalizeIssuerInput } from "../src/oidc/discovery.js";

describe("normalizeIssuerInput", () => {
  it("leaves a bare issuer with no trailing slash unchanged", () => {
    // Regression guard: this must not gain a slash the IdP's own `iss` claim doesn't have -
    // token.ts compares the stored issuer verbatim against every token.
    expect(normalizeIssuerInput("https://idp.example.com")).toBe("https://idp.example.com");
  });

  it("leaves an already-slashed bare issuer unchanged", () => {
    expect(normalizeIssuerInput("https://idp.example.com/")).toBe("https://idp.example.com/");
  });

  it("strips a pasted .well-known/openid-configuration suffix without adding a slash back", () => {
    expect(normalizeIssuerInput("https://idp.example.com/.well-known/openid-configuration")).toBe(
      "https://idp.example.com",
    );
  });

  it("strips the suffix from an issuer with a path segment (e.g. Authentik application slug)", () => {
    expect(
      normalizeIssuerInput("https://idp.example.com/application/o/admitto/.well-known/openid-configuration"),
    ).toBe("https://idp.example.com/application/o/admitto");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeIssuerInput("  https://idp.example.com/.well-known/openid-configuration  ")).toBe(
      "https://idp.example.com",
    );
  });

  it("strips a stray trailing slash after the suffix (an easy extra keystroke when copying)", () => {
    expect(normalizeIssuerInput("https://idp.example.com/.well-known/openid-configuration/")).toBe(
      "https://idp.example.com",
    );
  });
});
