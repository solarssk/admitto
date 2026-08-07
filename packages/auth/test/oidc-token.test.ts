import { afterEach, describe, expect, it, vi } from "vitest";
import type { IdentityProvider } from "@admitto/db";
import { exchangeAuthorizationCode } from "../src/oidc/token.js";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));

vi.mock("../src/oidc/safe-oidc-fetch.js", () => ({
  safeOidcFetch: (url: string, init?: RequestInit) => fetch(url, init),
  createPinnedRemoteJWKSet: vi.fn(),
}));

const baseProvider: IdentityProvider = {
  id: "prov",
  provider_type: "oidc",
  issuer: "https://idp.example.com/",
  client_id: "public-client",
  client_secret_enc: null,
  authorization_endpoint: "https://idp.example.com/authorize",
  token_endpoint: "https://idp.example.com/token",
  jwks_uri: "https://idp.example.com/jwks",
  userinfo_endpoint: null,
  claim_email: "email",
  claim_name: "name",
  claim_groups: "groups",
  claim_given_name: "given_name",
  claim_family_name: "family_name",
  claim_phone: "phone_number",
  enabled: true,
  display_name: "Test",
  created_at: new Date(),
  updated_at: new Date(),
};

describe("exchangeAuthorizationCode", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("omits client_secret for public PKCE clients", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id_token: "eyJ.test" }), { status: 200 }),
    );

    await exchangeAuthorizationCode(baseProvider, "auth-code", "verifier", "https://app/callback");

    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const params = new URLSearchParams(init.body as string);
    expect(params.get("client_id")).toBe("public-client");
    expect(params.get("code_verifier")).toBe("verifier");
    expect(params.has("client_secret")).toBe(false);
  });

  it("includes client_secret when configured", async () => {
    const { encryptClientSecret } = await import("../src/oidc/provider-secret.js");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id_token: "eyJ.test" }), { status: 200 }),
    );

    await exchangeAuthorizationCode(
      { ...baseProvider, client_secret_enc: encryptClientSecret("s3cret") },
      "auth-code",
      "verifier",
      "https://app/callback",
    );

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const params = new URLSearchParams(init.body as string);
    expect(params.get("client_secret")).toBe("s3cret");
  });
});
