import { describe, expect, it, beforeAll, afterAll } from "vitest";
import * as jose from "jose";
import { validateIdToken, clearJwksCacheForTests } from "../src/oidc/token.js";
import type { IdentityProvider } from "@prisma/client";
import { createServer, type Server } from "node:http";

let server: Server;
let jwksUri: string;
let privateKey: Awaited<ReturnType<typeof jose.generateKeyPair>>["privateKey"];
let publicJwk: jose.JWK;
const issuer = "https://unit-test-idp.example.com/";
const clientId = "unit-test-client";

const provider = {
  issuer,
  client_id: clientId,
  jwks_uri: "",
} as IdentityProvider;

beforeAll(async () => {
  const keys = await jose.generateKeyPair("RS256");
  privateKey = keys.privateKey;
  publicJwk = await jose.exportJWK(keys.publicKey);
  publicJwk.kid = "u1";
  publicJwk.alg = "RS256";

  server = createServer((req, res) => {
    if (req.url === "/jwks") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ keys: [publicJwk] }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("bind failed");
  jwksUri = `http://127.0.0.1:${addr.port}/jwks`;
  provider.jwks_uri = jwksUri;
});

afterAll(async () => {
  clearJwksCacheForTests();
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
});

async function signToken(claims: Record<string, unknown>, overrides: { aud?: string; iss?: string } = {}) {
  return new jose.SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "u1" })
    .setIssuer(overrides.iss ?? issuer)
    .setAudience(overrides.aud ?? clientId)
    .setSubject("sub-1")
    .setExpirationTime("1h")
    .sign(privateKey);
}

describe("validateIdToken", () => {
  it("accepts valid token with matching nonce", async () => {
    const token = await signToken({ nonce: "n1" });
    const payload = await validateIdToken({ idToken: token, provider, expectedNonce: "n1" });
    expect(payload.sub).toBe("sub-1");
  });

  it("rejects wrong nonce", async () => {
    const token = await signToken({ nonce: "n1" });
    await expect(
      validateIdToken({ idToken: token, provider, expectedNonce: "wrong" }),
    ).rejects.toThrow(/nonce/i);
  });

  it("rejects wrong audience", async () => {
    const token = await signToken({ nonce: "n1" }, { aud: "other-client" });
    await expect(
      validateIdToken({ idToken: token, provider, expectedNonce: "n1" }),
    ).rejects.toThrow();
  });
});
