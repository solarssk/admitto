import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { consumeOidcAuthState, createOidcAuthState } from "../../src/oidc/auth-state.js";

const PROVIDER_ID = "auth-state-test-provider";
const STATE = "auth-state-test-state-value";

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = new PrismaClient();
  await prisma.oidcAuthState.deleteMany({ where: { state: STATE } });
  await prisma.identityProvider.deleteMany({ where: { id: PROVIDER_ID } });
  await prisma.identityProvider.create({
    data: {
      id: PROVIDER_ID,
      issuer: "https://auth-state-test.example.com/",
      client_id: "auth-state-client",
      authorization_endpoint: "https://auth-state-test.example.com/a",
      token_endpoint: "https://auth-state-test.example.com/t",
      jwks_uri: "https://auth-state-test.example.com/j",
      display_name: "Auth state test",
    },
  });
});

afterAll(async () => {
  await prisma.oidcAuthState.deleteMany({ where: { state: STATE } });
  await prisma.identityProvider.deleteMany({ where: { id: PROVIDER_ID } });
  await prisma.$disconnect();
});

describe("consumeOidcAuthState", () => {
  it("consumes state once; second consume returns null", async () => {
    await createOidcAuthState(prisma, {
      providerId: PROVIDER_ID,
      state: STATE,
      nonce: "nonce",
      codeVerifier: "verifier",
    });

    const first = await consumeOidcAuthState(prisma, STATE);
    expect(first).toMatchObject({
      provider_id: PROVIDER_ID,
      nonce: "nonce",
      code_verifier: "verifier",
    });

    const second = await consumeOidcAuthState(prisma, STATE);
    expect(second).toBeNull();
  });
});
