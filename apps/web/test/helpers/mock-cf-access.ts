import { createServer, type Server } from "node:http";
import * as jose from "jose";

export interface MockCfAccess {
  teamDomain: string;
  jwksUri: string;
  audience: string;
  privateKey: Awaited<ReturnType<typeof jose.generateKeyPair>>["privateKey"];
  publicJwk: jose.JWK;
  server: Server;
}

export interface SignCfAccessJwtInput {
  sub?: string;
  email?: string;
  groups?: string[];
  type?: string;
  aud?: string | string[];
  iss?: string;
  exp?: string;
  nbf?: string;
  common_name?: string;
}

export async function startMockCfAccess(options?: {
  audience?: string;
  teamDomain?: string;
}): Promise<MockCfAccess> {
  const { publicKey, privateKey } = await jose.generateKeyPair("RS256");
  const publicJwk = await jose.exportJWK(publicKey);
  publicJwk.kid = "cf-test-key";
  publicJwk.alg = "RS256";

  const audience = options?.audience ?? "test-cf-aud-tag";

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/cdn-cgi/access/certs") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ keys: [publicJwk] }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("mock cf access bind failed");
  const teamDomain = `http://127.0.0.1:${addr.port}`;
  const jwksUri = `${teamDomain}/cdn-cgi/access/certs`;

  return {
    teamDomain,
    jwksUri,
    audience,
    privateKey,
    publicJwk,
    server,
  };
}

export async function signCfAccessJwt(
  mock: MockCfAccess,
  input: SignCfAccessJwtInput = {},
): Promise<string> {
  const payload: Record<string, unknown> = {
    type: input.type ?? "app",
    groups: input.groups ?? [],
  };
  if (input.email !== undefined) payload.email = input.email;
  if (input.common_name !== undefined) payload.common_name = input.common_name;

  const builder = new jose.SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: "cf-test-key" })
    .setIssuer(input.iss ?? mock.teamDomain)
    .setAudience(input.aud ?? mock.audience)
    .setSubject(input.sub ?? "cf-subject-123")
    .setExpirationTime(input.exp ?? "2h");

  if (input.nbf) {
    builder.setNotBefore(input.nbf);
  }

  return builder.sign(mock.privateKey);
}

export function stopMockCfAccess(mock: MockCfAccess): Promise<void> {
  return new Promise((resolve, reject) => {
    mock.server.close((err) => (err ? reject(err) : resolve()));
  });
}
