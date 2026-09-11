import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import * as jose from "jose";

export interface MockOidcIdp {
  issuer: string;
  baseUrl: string;
  jwksUri: string;
  tokenEndpoint: string;
  authorizeEndpoint: string;
  publicJwk: jose.JWK;
  server: Server;
  /** Sets the `groups` claim the NEXT issued ID token will carry, then reverts to `[]` - a test
   * calls this immediately before driving one callback through runOidcCallback. Not part of the
   * real OIDC protocol: this mock IdP is a standalone server the test already controls directly,
   * so a simple stateful setter is the only way a test can choose what claim it issues. */
  setNextGroups(groups: string[]): void;
}

export async function startMockOidcIdp(): Promise<MockOidcIdp> {
  const { publicKey, privateKey } = await jose.generateKeyPair("RS256");
  const publicJwk = await jose.exportJWK(publicKey);
  publicJwk.kid = "test-key";
  publicJwk.alg = "RS256";

  let issuer = "";
  let jwksUri = "";
  let tokenEndpoint = "";
  let authorizeEndpoint = "";
  const codeState = new Map<string, { nonce: string; groups: string[] }>();
  let nextGroups: string[] = [];

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", issuer || "http://127.0.0.1");
    if (url.pathname === "/.well-known/openid-configuration") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          issuer,
          authorization_endpoint: authorizeEndpoint,
          token_endpoint: tokenEndpoint,
          jwks_uri: jwksUri,
        }),
      );
      return;
    }
    if (url.pathname === "/jwks") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ keys: [publicJwk] }));
      return;
    }
    if (url.pathname === "/token" && req.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = new URLSearchParams(Buffer.concat(chunks).toString());
      const code = body.get("code");
      const state = code ? codeState.get(code) : undefined;
      if (!code || !state) {
        res.writeHead(400);
        res.end("invalid code");
        return;
      }
      codeState.delete(code);
      const idToken = await new jose.SignJWT({
        nonce: state.nonce,
        email: "oidc-flow@example.com",
        groups: state.groups,
      })
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setIssuer(issuer)
        .setAudience("test-oidc-client")
        .setSubject("mock-subject-oidc")
        .setExpirationTime("2h")
        .sign(privateKey);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id_token: idToken, access_token: "at" }));
      return;
    }
    if (url.pathname === "/authorize") {
      const redirectUri = url.searchParams.get("redirect_uri")!;
      const authState = url.searchParams.get("state")!;
      const nonce = url.searchParams.get("nonce") ?? "";
      const code = randomUUID();
      codeState.set(code, { nonce, groups: nextGroups });
      nextGroups = [];
      const target = new URL(redirectUri);
      target.searchParams.set("code", code);
      target.searchParams.set("state", authState);
      res.writeHead(302, { Location: target.toString() });
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("mock idp bind failed");
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  issuer = `${baseUrl}/`;
  jwksUri = `${baseUrl}/jwks`;
  tokenEndpoint = `${baseUrl}/token`;
  authorizeEndpoint = `${baseUrl}/authorize`;

  return {
    issuer,
    baseUrl,
    jwksUri,
    tokenEndpoint,
    authorizeEndpoint,
    publicJwk,
    server,
    setNextGroups: (groups: string[]) => {
      nextGroups = groups;
    },
  };
}

export function stopMockOidcIdp(mock: MockOidcIdp): Promise<void> {
  return new Promise((resolve, reject) => {
    mock.server.close((err) => (err ? reject(err) : resolve()));
  });
}
