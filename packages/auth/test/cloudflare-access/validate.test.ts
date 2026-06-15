import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as jose from "jose";
import {
  validateAccessJwt,
  CfAccessJwtError,
  isServiceTokenShape,
  clearCfAccessJwksCacheForTests,
} from "../../src/cloudflare-access/validate.js";

let teamDomain: string;
let jwksUri: string;
let privateKey: jose.KeyLike;
let server: Server;
const audience = "aud-accept";

beforeAll(async () => {
  const keys = await jose.generateKeyPair("RS256");
  privateKey = keys.privateKey;
  const publicJwk = await jose.exportJWK(keys.publicKey);
  publicJwk.kid = "cf-test-key";
  publicJwk.alg = "RS256";

  server = createServer((req, res) => {
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
  if (!addr || typeof addr === "string") throw new Error("bind failed");
  teamDomain = `http://127.0.0.1:${addr.port}`;
  jwksUri = `${teamDomain}/cdn-cgi/access/certs`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  clearCfAccessJwksCacheForTests();
});

async function signJwt(claims: Record<string, unknown> = {}, opts?: { nbf?: string }): Promise<string> {
  const builder = new jose.SignJWT({
    type: "app",
    email: "cf-admin@example.com",
    groups: [],
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256", kid: "cf-test-key" })
    .setIssuer(teamDomain)
    .setAudience(audience)
    .setSubject((claims.sub as string) ?? "cf-subject-123")
    .setExpirationTime((claims.exp as string) ?? "2h");
  if (opts?.nbf) builder.setNotBefore(opts.nbf);
  return builder.sign(privateKey);
}

function config() {
  return { teamDomain, audience: [audience, "aud-alt"], jwksUri };
}

describe("validateAccessJwt", () => {
  it("accepts valid human JWT", async () => {
    const token = await signJwt();
    const payload = await validateAccessJwt(token, config());
    expect(payload.sub).toBe("cf-subject-123");
  });

  it("rejects wrong issuer", async () => {
    const token = await new jose.SignJWT({ type: "app", email: "a@example.com" })
      .setProtectedHeader({ alg: "RS256", kid: "cf-test-key" })
      .setIssuer("https://wrong.cloudflareaccess.com")
      .setAudience(audience)
      .setSubject("sub")
      .setExpirationTime("2h")
      .sign(privateKey);
    await expect(validateAccessJwt(token, config())).rejects.toBeInstanceOf(CfAccessJwtError);
  });

  it("rejects wrong audience", async () => {
    const token = await new jose.SignJWT({ type: "app", email: "a@example.com" })
      .setProtectedHeader({ alg: "RS256", kid: "cf-test-key" })
      .setIssuer(teamDomain)
      .setAudience("wrong-aud")
      .setSubject("sub")
      .setExpirationTime("2h")
      .sign(privateKey);
    await expect(validateAccessJwt(token, config())).rejects.toBeInstanceOf(CfAccessJwtError);
  });

  it("rejects expired token", async () => {
    const token = await signJwt({ exp: "-10s" });
    await expect(validateAccessJwt(token, config())).rejects.toBeInstanceOf(CfAccessJwtError);
  });

  it("rejects not-yet-active token", async () => {
    const token = await signJwt({}, { nbf: "1h" });
    await expect(validateAccessJwt(token, config())).rejects.toBeInstanceOf(CfAccessJwtError);
  });

  it("rejects non-app type", async () => {
    const token = await signJwt({ type: "org" });
    await expect(validateAccessJwt(token, config())).rejects.toBeInstanceOf(CfAccessJwtError);
  });

  it("rejects missing email", async () => {
    const token = await new jose.SignJWT({ type: "app" })
      .setProtectedHeader({ alg: "RS256", kid: "cf-test-key" })
      .setIssuer(teamDomain)
      .setAudience(audience)
      .setSubject("sub")
      .setExpirationTime("2h")
      .sign(privateKey);
    await expect(validateAccessJwt(token, config())).rejects.toBeInstanceOf(CfAccessJwtError);
  });

  it("detects service token shape", () => {
    expect(isServiceTokenShape({ type: "app", sub: "", common_name: "" })).toBe(true);
  });
});
