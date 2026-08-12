import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";

const { fetchOidcDiscovery } = vi.hoisted(() => ({
  fetchOidcDiscovery: vi.fn(async () => ({
    issuer: "https://idp.example.com/",
    authorization_endpoint: "https://idp.example.com/authorize",
    token_endpoint: "https://idp.example.com/token",
    jwks_uri: "https://idp.example.com/jwks",
    userinfo_endpoint: null,
  })),
}));

vi.mock("../src/oidc/discovery.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/oidc/discovery.js")>();
  return {
    ...actual,
    fetchOidcDiscovery,
    testOidcConnection: vi.fn(),
  };
});

import {
  createIdentityProviderWithMappings,
  updateIdentityProvider,
  updateIdentityProviderWithMappings,
} from "../src/oidc/provider.js";

const baseInput = {
  display_name: "Test IdP",
  issuer: "https://idp.example.com/",
  client_id: "client-1",
  client_secret: "secret",
};

/** Minimal in-memory Prisma stub for OIDC provider transaction ordering tests. */
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
        claim_given_name: "given_name",
        claim_family_name: "family_name",
        claim_phone: "phone_number",
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
        claim_given_name: "given_name",
        claim_family_name: "family_name",
        claim_phone: "phone_number",
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
        claim_given_name: "given_name",
        claim_family_name: "family_name",
        claim_phone: "phone_number",
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
        claim_given_name: "given_name",
        claim_family_name: "family_name",
        claim_phone: "phone_number",
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

  it("strips a pasted .well-known/openid-configuration suffix from the issuer even when all endpoints are provided (no discovery call to self-correct via)", async () => {
    const prisma = mockPrismaForTxn();
    await createIdentityProviderWithMappings(
      prisma,
      {
        ...baseInput,
        issuer: "https://idp.example.com/.well-known/openid-configuration",
        authorization_endpoint: "https://idp.example.com/authorize",
        token_endpoint: "https://idp.example.com/token",
        jwks_uri: "https://idp.example.com/jwks",
      },
      [],
    );
    expect(fetchOidcDiscovery).not.toHaveBeenCalled();
    const createCall = vi.mocked(prisma.identityProvider.create).mock.calls[0]![0] as { data: { issuer: string } };
    expect(createCall.data.issuer).toBe("https://idp.example.com/");
  });
});

describe("OIDC provider save — end_session_endpoint clear vs preserve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const existingProvider = {
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
    end_session_endpoint: "https://idp.example.com/end-session",
    claim_email: "email",
    claim_name: "name",
    claim_groups: "groups",
    claim_given_name: "given_name",
    claim_family_name: "family_name",
    claim_phone: "phone_number",
    enabled: false,
    created_at: new Date(),
    updated_at: new Date(),
  };

  function mockPrismaForUpdate() {
    return {
      identityProvider: {
        findUniqueOrThrow: vi.fn(async () => existingProvider),
        update: vi.fn(async () => existingProvider),
      },
    } as unknown as PrismaClient;
  }

  // Same explicit-endpoints shape handleApiDiscoverProvider sends: Discover just ran and
  // supplied every endpoint it found, including an explicit end_session_endpoint value one way
  // or the other - a re-fetch inside resolveEndpoints never happens on this path.
  const discoveredInput = {
    ...baseInput,
    authorization_endpoint: "https://idp.example.com/authorize",
    token_endpoint: "https://idp.example.com/token",
    jwks_uri: "https://idp.example.com/jwks",
  };

  it("clears a stored end_session_endpoint when the caller explicitly passes null (provider stopped advertising one)", async () => {
    const prisma = mockPrismaForUpdate();

    await updateIdentityProvider(prisma, "prov-1", {
      ...discoveredInput,
      end_session_endpoint: null,
    });

    const call = vi.mocked(prisma.identityProvider.update).mock.calls[0]![0] as {
      data: { end_session_endpoint: string | null };
    };
    expect(call.data.end_session_endpoint).toBeNull();
  });

  it("preserves the stored end_session_endpoint when the caller omits it entirely (unrelated save, e.g. a plain display_name edit)", async () => {
    const prisma = mockPrismaForUpdate();

    await updateIdentityProvider(prisma, "prov-1", { ...discoveredInput });

    const call = vi.mocked(prisma.identityProvider.update).mock.calls[0]![0] as {
      data: { end_session_endpoint: string | null };
    };
    expect(call.data.end_session_endpoint).toBe("https://idp.example.com/end-session");
  });

  // Same tri-state merge, duplicated in updateIdentityProviderWithMappings (the path the admin
  // editor's own Save button uses, wrapped in a $transaction) - not exercised by the two tests
  // above, which only cover the plain updateIdentityProvider a bare discover POST calls.
  function mockPrismaForUpdateWithMappings() {
    const identityProvider = {
      findUniqueOrThrow: vi.fn(async () => existingProvider),
      update: vi.fn(async () => existingProvider),
    };
    return {
      $transaction: vi.fn(async (fn: (inner: { identityProvider: typeof identityProvider; oidcGroupRoleMapping: unknown }) => Promise<unknown>) =>
        fn({ identityProvider, oidcGroupRoleMapping: { deleteMany: vi.fn(), createMany: vi.fn() } }),
      ),
      identityProvider,
    } as unknown as PrismaClient & { identityProvider: typeof identityProvider };
  }

  it("clears a stored end_session_endpoint via updateIdentityProviderWithMappings too", async () => {
    const prisma = mockPrismaForUpdateWithMappings();

    await updateIdentityProviderWithMappings(prisma, "prov-1", { ...discoveredInput, end_session_endpoint: null }, []);

    const call = vi.mocked(prisma.identityProvider.update).mock.calls[0]![0] as {
      data: { end_session_endpoint: string | null };
    };
    expect(call.data.end_session_endpoint).toBeNull();
  });

  it("preserves a stored end_session_endpoint via updateIdentityProviderWithMappings when omitted", async () => {
    const prisma = mockPrismaForUpdateWithMappings();

    await updateIdentityProviderWithMappings(prisma, "prov-1", { ...discoveredInput }, []);

    const call = vi.mocked(prisma.identityProvider.update).mock.calls[0]![0] as {
      data: { end_session_endpoint: string | null };
    };
    expect(call.data.end_session_endpoint).toBe("https://idp.example.com/end-session");
  });

  // The other two "omitted" tests above preserve an EXISTING non-null value - they never touch
  // the ?? undefined fallback inside that same branch, for a provider that never had one stored
  // in the first place (existing.end_session_endpoint itself null, not just absent from input).
  const existingProviderNoEndSession = { ...existingProvider, end_session_endpoint: null };

  it("stays null (not a stored value) when both the caller and the existing row have no end_session_endpoint", async () => {
    const prisma = {
      identityProvider: {
        findUniqueOrThrow: vi.fn(async () => existingProviderNoEndSession),
        update: vi.fn(async () => existingProviderNoEndSession),
      },
    } as unknown as PrismaClient;

    await updateIdentityProvider(prisma, "prov-1", { ...discoveredInput });

    const call = vi.mocked(prisma.identityProvider.update).mock.calls[0]![0] as {
      data: { end_session_endpoint: string | null | undefined };
    };
    expect(call.data.end_session_endpoint).toBeFalsy();
  });

  it("stays null via updateIdentityProviderWithMappings too, when neither the caller nor the existing row has one", async () => {
    const identityProvider = {
      findUniqueOrThrow: vi.fn(async () => existingProviderNoEndSession),
      update: vi.fn(async () => existingProviderNoEndSession),
    };
    const prisma = {
      $transaction: vi.fn(async (fn: (inner: { identityProvider: typeof identityProvider; oidcGroupRoleMapping: unknown }) => Promise<unknown>) =>
        fn({ identityProvider, oidcGroupRoleMapping: { deleteMany: vi.fn(), createMany: vi.fn() } }),
      ),
      identityProvider,
    } as unknown as PrismaClient;

    await updateIdentityProviderWithMappings(prisma, "prov-1", { ...discoveredInput }, []);

    const call = vi.mocked(identityProvider.update).mock.calls[0]![0] as {
      data: { end_session_endpoint: string | null | undefined };
    };
    expect(call.data.end_session_endpoint).toBeFalsy();
  });
});
