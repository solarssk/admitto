import { describe, expect, it } from "vitest";
import { buildOidcRedirectUri } from "../../src/identity/oidcRedirectUri.js";

describe("buildOidcRedirectUri", () => {
  it("builds the callback path for a provider id", () => {
    expect(buildOidcRedirectUri("https://tickets.example.com", "clxyz123")).toBe(
      "https://tickets.example.com/api/auth/oidc/clxyz123/callback",
    );
  });

  it("strips a trailing slash from the instance base URL", () => {
    expect(buildOidcRedirectUri("https://tickets.example.com/", "p1")).toBe(
      "https://tickets.example.com/api/auth/oidc/p1/callback",
    );
  });
});
