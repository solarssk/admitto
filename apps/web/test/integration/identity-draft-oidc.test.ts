/**
 * Integration tests for the stateless draft test/discover endpoints against a
 * real in-process stub OIDC IdP on 127.0.0.1. The codebase already permits
 * http://127.0.0.1 as a mock IdP URL in non-production (see safe-url.ts), so
 * these tests exercise the full code path — no internal mocking required.
 */
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { hashPassword, createSession, SESSION_STAGE } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { createApp } from "../../src/app.js";
import { createRateLimitStore } from "../../src/rate-limit/index.js";

const SUPER_ID = "idp-draft-oidc-super";
const SUPER_EMAIL = "idp-draft-oidc-super@example.com";
const sameOrigin = { Origin: "http://localhost" };

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let superCookie: string;
let stubServer: Server;
let stubBase: string;

beforeAll(async () => {
  // --- Stub OIDC IdP ---
  stubServer = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/.well-known/openid-configuration") {
      res.writeHead(200);
      res.end(
        JSON.stringify({
          issuer: stubBase,
          authorization_endpoint: `${stubBase}/authorize`,
          token_endpoint: `${stubBase}/token`,
          jwks_uri: `${stubBase}/jwks`,
        }),
      );
    } else if (req.url === "/jwks") {
      res.writeHead(200);
      // Minimal valid JWKS — testOidcConnection only checks keys.length > 0.
      res.end(JSON.stringify({ keys: [{ kty: "RSA", n: "stub", e: "AQAB" }] }));
    } else {
      res.writeHead(404);
      res.end("{}");
    }
  });

  await new Promise<void>((resolve) => stubServer.listen(0, "127.0.0.1", resolve));
  const addr = stubServer.address() as { port: number };
  stubBase = `http://127.0.0.1:${addr.port}`;

  // --- App + superadmin session ---
  prisma = createTestPrismaClient();
  await prisma.userMfaMethod.deleteMany({ where: { user_id: SUPER_ID } });
  await prisma.roleAssignment.deleteMany({ where: { user_id: SUPER_ID } });
  await prisma.session.deleteMany({ where: { user_id: SUPER_ID } });
  await prisma.user.deleteMany({ where: { id: SUPER_ID } });

  const password_hash = await hashPassword("draft-oidc-pass");
  await prisma.user.create({ data: { id: SUPER_ID, email: SUPER_EMAIL, password_hash } });
  await prisma.roleAssignment.create({
    data: { user_id: SUPER_ID, role: "superadmin", scope_type: "instance", scope_id: null },
  });
  await prisma.userMfaMethod.create({
    data: {
      user_id: SUPER_ID,
      type: "totp",
      secret_enc: encryptTotpSecret(generateTotpSecret()),
      confirmed_at: new Date(),
    },
  });

  const session = await createSession(prisma, { userId: SUPER_ID, stage: SESSION_STAGE.FULL });
  superCookie = `admitto_session=${session.rawToken}`;

  app = createApp({
    prisma,
    skipCheckinBootValidation: true,
    rateLimitStore: createRateLimitStore(),
    allowCheckinBearer: false,
    checkinToken: "draft-oidc-test-token-32chars!!",
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    stubServer.close((err) => (err ? reject(err) : resolve())),
  );
  await prisma.userMfaMethod.deleteMany({ where: { user_id: SUPER_ID } });
  await prisma.roleAssignment.deleteMany({ where: { user_id: SUPER_ID } });
  await prisma.session.deleteMany({ where: { user_id: SUPER_ID } });
  await prisma.user.deleteMany({ where: { id: SUPER_ID } });
  await prisma.$disconnect();
});

function json(path: string, init: RequestInit = {}) {
  return app.request(path, {
    ...init,
    headers: {
      Cookie: superCookie,
      "Content-Type": "application/json",
      ...sameOrigin,
      ...(init.headers ?? {}),
    },
  });
}

describe("identity draft endpoints — success paths via stub OIDC IdP", () => {
  it("POST /providers/test returns ok:true when the IdP is reachable", async () => {
    const res = await json("/api/admin/identity/providers/test", {
      method: "POST",
      body: JSON.stringify({ issuer: stubBase }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("POST /providers/test with partial endpoints falls back to discovery and returns ok:true", async () => {
    // Sending only 2 of 3 endpoints → all-or-nothing normalization → falls back to discovery.
    const res = await json("/api/admin/identity/providers/test", {
      method: "POST",
      body: JSON.stringify({
        issuer: stubBase,
        authorization_endpoint: `${stubBase}/authorize`,
        token_endpoint: `${stubBase}/token`,
        // jwks_uri intentionally omitted — partial set must not be passed as-is
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("POST /providers/test with explicit endpoints skips discovery and returns ok:true", async () => {
    const res = await json("/api/admin/identity/providers/test", {
      method: "POST",
      body: JSON.stringify({
        issuer: stubBase,
        authorization_endpoint: `${stubBase}/authorize`,
        token_endpoint: `${stubBase}/token`,
        jwks_uri: `${stubBase}/jwks`,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("POST /providers/discover-preview returns the stub IdP's endpoints", async () => {
    const res = await json("/api/admin/identity/providers/discover-preview", {
      method: "POST",
      body: JSON.stringify({ issuer: stubBase }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      endpoints: { issuer: string; authorization_endpoint: string; jwks_uri: string };
    };
    expect(body.ok).toBe(true);
    expect(body.endpoints.issuer).toBe(stubBase);
    expect(body.endpoints.authorization_endpoint).toBe(`${stubBase}/authorize`);
    expect(body.endpoints.jwks_uri).toBe(`${stubBase}/jwks`);
  });
});
