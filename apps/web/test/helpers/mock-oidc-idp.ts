import { createServer, type Server } from "node:http";
import * as jose from "jose";

export interface MockOidcIdp {
  issuer: string;
  baseUrl: string;
  jwksUri: string;
  tokenEndpoint: string;
  authorizeEndpoint: string;
  publicJwk: jose.JWK;
  server: Server;
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
  const nonceByState = new Map<string, string>();

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
      const code = body.get("code") ?? "mock-auth-code";
      const nonce = nonceByState.get(code) ?? "missing-nonce";
      const idToken = await new jose.SignJWT({ nonce, email: "oidc-flow@example.com", groups: [] })
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
      const state = url.searchParams.get("state")!;
      const nonce = url.searchParams.get("nonce") ?? "";
      const code = "mock-auth-code";
      nonceByState.set(code, nonce);
      const target = new URL(redirectUri);
      target.searchParams.set("code", code);
      target.searchParams.set("state", state);
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
  };
}

export function stopMockOidcIdp(mock: MockOidcIdp): Promise<void> {
  return new Promise((resolve, reject) => {
    mock.server.close((err) => (err ? reject(err) : resolve()));
  });
}
