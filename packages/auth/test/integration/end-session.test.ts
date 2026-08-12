import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { resolveOidcEndSessionRedirect } from "../../src/oidc/end-session.js";

const PROVIDER_WITH_END_SESSION = "end-session-provider-with";
const PROVIDER_WITHOUT_END_SESSION = "end-session-provider-without";
const BASE_URL = "https://admitto.example.com";

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = createTestPrismaClient();
  await prisma.identityProvider.deleteMany({ where: { id: { in: [PROVIDER_WITH_END_SESSION, PROVIDER_WITHOUT_END_SESSION] } } });
  await prisma.identityProvider.create({
    data: {
      id: PROVIDER_WITH_END_SESSION,
      issuer: "https://idp.example.test/with/",
      client_id: "admitto-client",
      authorization_endpoint: "https://idp.example.test/with/authorize",
      token_endpoint: "https://idp.example.test/with/token",
      jwks_uri: "https://idp.example.test/with/jwks",
      end_session_endpoint: "https://idp.example.test/with/end-session",
      display_name: "With end_session",
    },
  });
  await prisma.identityProvider.create({
    data: {
      id: PROVIDER_WITHOUT_END_SESSION,
      issuer: "https://idp.example.test/without/",
      client_id: "admitto-client-2",
      authorization_endpoint: "https://idp.example.test/without/authorize",
      token_endpoint: "https://idp.example.test/without/token",
      jwks_uri: "https://idp.example.test/without/jwks",
      display_name: "Without end_session",
    },
  });
});

afterAll(async () => {
  await prisma.identityProvider.deleteMany({ where: { id: { in: [PROVIDER_WITH_END_SESSION, PROVIDER_WITHOUT_END_SESSION] } } });
  await prisma.$disconnect();
});

describe("resolveOidcEndSessionRedirect", () => {
  it("returns null for a local session", async () => {
    const result = await resolveOidcEndSessionRedirect(
      prisma,
      { auth_method: "local", oidc_provider_id: null },
      BASE_URL,
    );
    expect(result).toBeNull();
  });

  it("returns null for an OIDC session whose provider has no end_session_endpoint", async () => {
    const result = await resolveOidcEndSessionRedirect(
      prisma,
      { auth_method: "oidc", oidc_provider_id: PROVIDER_WITHOUT_END_SESSION },
      BASE_URL,
    );
    expect(result).toBeNull();
  });

  it("returns null for an OIDC session with no provider recorded (pre-migration session)", async () => {
    const result = await resolveOidcEndSessionRedirect(
      prisma,
      { auth_method: "oidc", oidc_provider_id: null },
      BASE_URL,
    );
    expect(result).toBeNull();
  });

  it("builds the end_session_endpoint URL with client_id and post_logout_redirect_uri", async () => {
    const result = await resolveOidcEndSessionRedirect(
      prisma,
      { auth_method: "oidc", oidc_provider_id: PROVIDER_WITH_END_SESSION },
      BASE_URL,
    );
    expect(result).not.toBeNull();
    const url = new URL(result!);
    expect(`${url.origin}${url.pathname}`).toBe("https://idp.example.test/with/end-session");
    expect(url.searchParams.get("client_id")).toBe("admitto-client");
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe("https://admitto.example.com/login");
  });
});
