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
  custom?: Record<string, unknown>;
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
  const requestedTeam = options?.teamDomain?.trim().replace(/\/$/, "");

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

  let listenHostname = "127.0.0.1";
  let listenPort = 0;
  if (requestedTeam) {
    const requestedUrl = new URL(requestedTeam);
    listenHostname = requestedUrl.hostname;
    if (requestedUrl.port) listenPort = Number(requestedUrl.port);
  }

  await new Promise<void>((resolve) => server.listen(listenPort, listenHostname, resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("mock cf access bind failed");

  let teamDomain: string;
  if (requestedTeam) {
    const requestedUrl = new URL(requestedTeam);
    if (requestedUrl.port) {
      teamDomain = requestedTeam;
    } else {
      teamDomain = `${requestedUrl.protocol}//${requestedUrl.hostname}:${addr.port}`;
    }
  } else {
    teamDomain = `http://127.0.0.1:${addr.port}`;
  }
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
  if (input.custom !== undefined) payload.custom = input.custom;

  const builder = new jose.SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: "cf-test-key" })
    .setIssuer(input.iss ?? mock.teamDomain)
    .setAudience(input.aud ?? mock.audience)
    .setExpirationTime(input.exp ?? "2h");

  // An explicitly empty subject must remain empty so callers can create a structurally valid
  // token whose claims are rejected by the application's identity boundary.
  if (input.sub === undefined) {
    builder.setSubject("cf-subject-123");
  } else {
    builder.setSubject(input.sub);
  }

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
