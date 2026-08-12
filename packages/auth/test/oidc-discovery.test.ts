import { describe, expect, it } from "vitest";
import { normalizeIssuerInput } from "../src/oidc/discovery.js";

describe("normalizeIssuerInput", () => {
  it("adds a trailing slash to a bare issuer", () => {
    expect(normalizeIssuerInput("https://idp.example.com")).toBe("https://idp.example.com/");
  });

  it("leaves an already-slashed bare issuer unchanged", () => {
    expect(normalizeIssuerInput("https://idp.example.com/")).toBe("https://idp.example.com/");
  });

  it("strips a pasted .well-known/openid-configuration suffix", () => {
    expect(normalizeIssuerInput("https://idp.example.com/.well-known/openid-configuration")).toBe(
      "https://idp.example.com/",
    );
  });

  it("strips the suffix from an issuer with a path segment (e.g. Authentik application slug)", () => {
    expect(
      normalizeIssuerInput("https://idp.example.com/application/o/admitto/.well-known/openid-configuration"),
    ).toBe("https://idp.example.com/application/o/admitto/");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeIssuerInput("  https://idp.example.com/.well-known/openid-configuration  ")).toBe(
      "https://idp.example.com/",
    );
  });
});
