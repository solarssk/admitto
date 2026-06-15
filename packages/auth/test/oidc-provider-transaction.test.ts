import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

const { fetchOidcDiscovery } = vi.hoisted(() => ({
  fetchOidcDiscovery: vi.fn(async () => ({
    issuer: "https://idp.example.com/",
    authorization_endpoint: "https://idp.example.com/authorize",
    token_endpoint: "https://idp.example.com/token",
    jwks_uri: "https://idp.example.com/jwks",
    userinfo_endpoint: null,
  })),
}));

vi.mock("../src/oidc/discovery.js", () => ({
  fetchOidcDiscovery,
  testOidcConnection: vi.fn(),
}));

import {
  createIdentityProviderWithMappings,
  updateIdentityProviderWithMappings,
} from "../src/oidc/provider.js";

const baseInput = {
  display_name: "Test IdP",
  issuer: "https://idp.example.com/",
  client_id: "client-1",
  client_secret: "secret",
};

function mockPrismaForTxn(): PrismaClient {
  const tx = {
    identityProvider: {
      create: vi.fn(async () => ({
        id: "prov-1",
        provider_type: "oidc",
        display_name: baseInput.display_name,
        issuer: "https://idp.example.com/",
        client_id: baseInput.client_id,
        client_secret_enc: "enc",
        authorization_endpoint: "https://idp.example.com/authorize",
        token_endpoint: "https://idp.example.com/token",
        jwks_uri: "https://idp.example.com/jwks",
        userinfo_endpoint: null,
        claim_email: "email",
        claim_name: "name",
        claim_groups: "groups",
        enabled: false,
        created_at: new Date(),
        updated_at: new Date(),
      })),
      findUniqueOrThrow: vi.fn(async () => ({
        id: "prov-1",
        provider_type: "oidc",
        display_name: baseInput.display_name,
        issuer: "https://idp.example.com/",
        client_id: baseInput.client_id,
        client_secret_enc: "enc",
        authorization_endpoint: "https://idp.example.com/authorize",
        token_endpoint: "https://idp.example.com/token",
        jwks_uri: "https://idp.example.com/jwks",
        userinfo_endpoint: null,
        claim_email: "email",
        claim_name: "name",
        claim_groups: "groups",
        enabled: false,
        created_at: new Date(),
        updated_at: new Date(),
      })),
      update: vi.fn(async () => ({
        id: "prov-1",
        provider_type: "oidc",
        display_name: baseInput.display_name,
        issuer: "https://idp.example.com/",
        client_id: baseInput.client_id,
        client_secret_enc: "enc",
        authorization_endpoint: "https://idp.example.com/authorize",
        token_endpoint: "https://idp.example.com/token",
        jwks_uri: "https://idp.example.com/jwks",
        userinfo_endpoint: null,
        claim_email: "email",
        claim_name: "name",
        claim_groups: "groups",
        enabled: false,
        created_at: new Date(),
        updated_at: new Date(),
      })),
    },
    oidcGroupRoleMapping: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(async () => ({ count: 0 })),
    },
  };

  return {
    $transaction: vi.fn(async (fn: (inner: typeof tx) => Promise<unknown>) => fn(tx)),
    identityProvider: tx.identityProvider,
    oidcGroupRoleMapping: tx.oidcGroupRoleMapping,
  } as unknown as PrismaClient;
}

describe("OIDC provider save — discovery outside transaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("createIdentityProviderWithMappings resolves discovery before $transaction", async () => {
    const prisma = mockPrismaForTxn();
    const discoveryOrder: string[] = [];
    fetchOidcDiscovery.mockImplementation(async () => {
      discoveryOrder.push("discovery");
      return {
        issuer: "https://idp.example.com/",
        authorization_endpoint: "https://idp.example.com/authorize",
        token_endpoint: "https://idp.example.com/token",
        jwks_uri: "https://idp.example.com/jwks",
        userinfo_endpoint: null,
      };
    });
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      discoveryOrder.push("transaction");
      return (fn as (tx: unknown) => Promise<unknown>)({
        identityProvider: prisma.identityProvider,
        oidcGroupRoleMapping: { deleteMany: vi.fn(), createMany: vi.fn() },
      });
    });

    await createIdentityProviderWithMappings(prisma, baseInput, []);

    expect(discoveryOrder).toEqual(["discovery", "transaction"]);
    expect(fetchOidcDiscovery).toHaveBeenCalledOnce();
  });

  it("updateIdentityProviderWithMappings opens transaction only after endpoint resolution", async () => {
    const prisma = mockPrismaForTxn();
    const callOrder: string[] = [];
    vi.mocked(prisma.identityProvider.findUniqueOrThrow).mockImplementation(async () => {
      callOrder.push("findExisting");
      return {
        id: "prov-1",
        provider_type: "oidc",
        display_name: baseInput.display_name,
        issuer: "https://idp.example.com/",
        client_id: baseInput.client_id,
        client_secret_enc: "enc",
        authorization_endpoint: "https://idp.example.com/authorize",
        token_endpoint: "https://idp.example.com/token",
        jwks_uri: "https://idp.example.com/jwks",
        userinfo_endpoint: null,
        claim_email: "email",
        claim_name: "name",
        claim_groups: "groups",
        enabled: false,
        created_at: new Date(),
        updated_at: new Date(),
      };
    });
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      callOrder.push("transaction");
      return (fn as (tx: unknown) => Promise<unknown>)({
        identityProvider: prisma.identityProvider,
        oidcGroupRoleMapping: { deleteMany: vi.fn(), createMany: vi.fn() },
      });
    });

    await updateIdentityProviderWithMappings(
      prisma,
      "prov-1",
      {
        ...baseInput,
        authorization_endpoint: "https://idp.example.com/authorize",
        token_endpoint: "https://idp.example.com/token",
        jwks_uri: "https://idp.example.com/jwks",
      },
      [],
    );

    expect(callOrder).toEqual(["findExisting", "transaction"]);
    expect(fetchOidcDiscovery).not.toHaveBeenCalled();
  });

  it("does not call fetchOidcDiscovery when all endpoints are provided", async () => {
    const prisma = mockPrismaForTxn();
    await createIdentityProviderWithMappings(
      prisma,
      {
        ...baseInput,
        authorization_endpoint: "https://idp.example.com/authorize",
        token_endpoint: "https://idp.example.com/token",
        jwks_uri: "https://idp.example.com/jwks",
      },
      [],
    );
    expect(fetchOidcDiscovery).not.toHaveBeenCalled();
  });
});
