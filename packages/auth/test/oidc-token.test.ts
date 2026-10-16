import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as jose from "jose";
import type { IdentityProvider } from "@admitto/db";
import { createPinnedRemoteJWKSet } from "../src/oidc/safe-oidc-fetch.js";
import {
  clearJwksCacheForTests,
  exchangeAuthorizationCode,
  validateIdToken,
} from "../src/oidc/token.js";

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

describe("validateIdToken", () => {
  const NONCE = "expected-nonce";
  const KID = "test-key";
  const CLIENT = baseProvider.client_id;
  const OTHER_CLIENT = "another-client";
  const NOW = Math.floor(Date.now() / 1000);
  let signingKey: CryptoKey;
  let otherKey: CryptoKey;
  let publicJwk: jose.JWK;

  beforeAll(async () => {
    const keys = await jose.generateKeyPair("ES256");
    signingKey = keys.privateKey;
    publicJwk = { ...(await jose.exportJWK(keys.publicKey)), kid: KID, alg: "ES256" };
    otherKey = (await jose.generateKeyPair("ES256")).privateKey;
  });

  beforeEach(() => {
    clearJwksCacheForTests();
    vi.mocked(createPinnedRemoteJWKSet).mockReturnValue(jose.createLocalJWKSet({ keys: [publicJwk] }));
  });

  function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      iss: baseProvider.issuer,
      aud: CLIENT,
      sub: "subject-1",
      iat: NOW,
      exp: NOW + 3600,
      nonce: NONCE,
      ...overrides,
    };
  }

  async function validate(overrides: Record<string, unknown> = {}, key = signingKey) {
    const idToken = await new jose.SignJWT(claims(overrides))
      .setProtectedHeader({ alg: "ES256", kid: KID })
      .sign(key);
    return validateIdToken({ idToken, provider: baseProvider, expectedNonce: NONCE });
  }

  it("accepts a token with the required claims and a matching nonce", async () => {
    await expect(validate()).resolves.toMatchObject({ sub: "subject-1", nonce: NONCE });
  });

  it.each([
    ["exp", /missing required "exp" claim/],
    ["iat", /missing required "iat" claim/],
    ["sub", /missing required "sub" claim/],
    ["iss", /missing required "iss" claim/],
    ["aud", /missing required "aud" claim/],
  ])("rejects a token without %s", async (claim, message) => {
    await expect(validate({ [claim]: undefined })).rejects.toThrow(message);
  });

  it("rejects an expired token", async () => {
    await expect(validate({ iat: NOW - 7200, exp: NOW - 3600 })).rejects.toThrow(/"exp" claim/);
  });

  it("rejects a token for another issuer", async () => {
    await expect(validate({ iss: "https://other.example.com/" })).rejects.toThrow(/"iss" claim/);
  });

  it("rejects a token that is not for this client", async () => {
    await expect(validate({ aud: OTHER_CLIENT })).rejects.toThrow(/"aud" claim/);
  });

  it("rejects a token signed with another key", async () => {
    await expect(validate({}, otherKey)).rejects.toThrow(/signature/);
  });

  it("rejects a token with a different nonce", async () => {
    await expect(validate({ nonce: "another-nonce" })).rejects.toThrow(/nonce mismatch/);
  });

  describe("authorized party", () => {
    it("accepts a single audience without azp", async () => {
      await expect(validate()).resolves.toBeDefined();
    });

    it("accepts a single audience whose azp is this client", async () => {
      await expect(validate({ azp: CLIENT })).resolves.toMatchObject({ azp: CLIENT });
    });

    it("rejects a single audience whose azp is another client", async () => {
      await expect(validate({ azp: OTHER_CLIENT })).rejects.toThrow(/azp mismatch/);
    });

    it("accepts several audiences when azp is this client", async () => {
      await expect(validate({ aud: [CLIENT, OTHER_CLIENT], azp: CLIENT })).resolves.toBeDefined();
    });

    it("rejects several audiences without azp", async () => {
      await expect(validate({ aud: [CLIENT, OTHER_CLIENT] })).rejects.toThrow(
        /several audiences is missing azp/,
      );
    });

    it("rejects several audiences whose azp is another client", async () => {
      await expect(validate({ aud: [CLIENT, OTHER_CLIENT], azp: OTHER_CLIENT })).rejects.toThrow(
        /azp mismatch/,
      );
    });

    it("rejects an azp that is not a string", async () => {
      await expect(validate({ azp: [CLIENT] })).rejects.toThrow(/azp mismatch/);
    });

    it("accepts a single audience given as a one-element array without azp", async () => {
      await expect(validate({ aud: [CLIENT] })).resolves.toBeDefined();
    });
  });
});
