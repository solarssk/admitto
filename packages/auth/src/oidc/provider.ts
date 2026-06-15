import type { IdentityProvider, Prisma, PrismaClient } from "@prisma/client";
import { encryptClientSecret, hasClientSecret } from "./provider-secret.js";
import { PROVIDER_TYPE_OIDC } from "./constants.js";
import { fetchOidcDiscovery, testOidcConnection } from "./discovery.js";
import { assertSafeOidcFetchUrl } from "./safe-url.js";

export interface IdentityProviderInput {
  display_name: string;
  issuer: string;
  client_id: string;
  client_secret?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  jwks_uri?: string;
  userinfo_endpoint?: string;
  claim_email?: string;
  claim_name?: string;
  claim_groups?: string;
  enabled?: boolean;
  provider_type?: string;
}

export interface IdentityProviderFormView {
  id: string;
  provider_type: string;
  display_name: string;
  issuer: string;
  client_id: string;
  has_client_secret: boolean;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint: string | null;
  claim_email: string;
  claim_name: string;
  claim_groups: string;
  enabled: boolean;
}

export function toProviderFormView(provider: IdentityProvider): IdentityProviderFormView {
  return {
    id: provider.id,
    provider_type: provider.provider_type,
    display_name: provider.display_name,
    issuer: provider.issuer,
    client_id: provider.client_id,
    has_client_secret: hasClientSecret(provider.client_secret_enc),
    authorization_endpoint: provider.authorization_endpoint,
    token_endpoint: provider.token_endpoint,
    jwks_uri: provider.jwks_uri,
    userinfo_endpoint: provider.userinfo_endpoint,
    claim_email: provider.claim_email,
    claim_name: provider.claim_name,
    claim_groups: provider.claim_groups,
    enabled: provider.enabled,
  };
}

export async function findEnabledOidcProviders(
  prisma: PrismaClient | Prisma.TransactionClient,
): Promise<IdentityProvider[]> {
  return prisma.identityProvider.findMany({
    where: { enabled: true, provider_type: PROVIDER_TYPE_OIDC },
    orderBy: { display_name: "asc" },
  });
}

export async function findOidcProviderById(
  prisma: PrismaClient | Prisma.TransactionClient,
  id: string,
): Promise<IdentityProvider | null> {
  return prisma.identityProvider.findFirst({
    where: { id, provider_type: PROVIDER_TYPE_OIDC },
  });
}

export async function listOidcProviders(
  prisma: PrismaClient | Prisma.TransactionClient,
): Promise<IdentityProvider[]> {
  return prisma.identityProvider.findMany({
    where: { provider_type: PROVIDER_TYPE_OIDC },
    orderBy: { display_name: "asc" },
  });
}

async function resolveEndpoints(input: IdentityProviderInput): Promise<{
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint: string | null;
}> {
  assertSafeOidcFetchUrl(normalizeIssuerForValidation(input.issuer));
  if (input.authorization_endpoint && input.token_endpoint && input.jwks_uri) {
    assertSafeOidcFetchUrl(input.authorization_endpoint);
    assertSafeOidcFetchUrl(input.token_endpoint);
    assertSafeOidcFetchUrl(input.jwks_uri);
    if (input.userinfo_endpoint) assertSafeOidcFetchUrl(input.userinfo_endpoint);
    return {
      issuer: input.issuer,
      authorization_endpoint: input.authorization_endpoint,
      token_endpoint: input.token_endpoint,
      jwks_uri: input.jwks_uri,
      userinfo_endpoint: input.userinfo_endpoint ?? null,
    };
  }
  const discovery = await fetchOidcDiscovery(input.issuer);
  const endpoints = {
    issuer: discovery.issuer,
    authorization_endpoint: input.authorization_endpoint ?? discovery.authorization_endpoint,
    token_endpoint: input.token_endpoint ?? discovery.token_endpoint,
    jwks_uri: input.jwks_uri ?? discovery.jwks_uri,
    userinfo_endpoint: input.userinfo_endpoint ?? discovery.userinfo_endpoint ?? null,
  };
  assertSafeOidcFetchUrl(endpoints.authorization_endpoint);
  assertSafeOidcFetchUrl(endpoints.token_endpoint);
  assertSafeOidcFetchUrl(endpoints.jwks_uri);
  if (endpoints.userinfo_endpoint) assertSafeOidcFetchUrl(endpoints.userinfo_endpoint);
  return endpoints;
}

function normalizeIssuerForValidation(issuer: string): string {
  return issuer.endsWith("/") ? issuer : `${issuer}/`;
}

/** Create provider; encrypts client_secret when supplied. */
export async function createIdentityProvider(
  prisma: PrismaClient | Prisma.TransactionClient,
  input: IdentityProviderInput,
): Promise<IdentityProvider> {
  const endpoints = await resolveEndpoints(input);
  return prisma.identityProvider.create({
    data: {
      provider_type: input.provider_type ?? PROVIDER_TYPE_OIDC,
      display_name: input.display_name,
      issuer: endpoints.issuer,
      client_id: input.client_id,
      client_secret_enc: input.client_secret ? encryptClientSecret(input.client_secret) : null,
      authorization_endpoint: endpoints.authorization_endpoint,
      token_endpoint: endpoints.token_endpoint,
      jwks_uri: endpoints.jwks_uri,
      userinfo_endpoint: endpoints.userinfo_endpoint,
      claim_email: input.claim_email ?? "email",
      claim_name: input.claim_name ?? "name",
      claim_groups: input.claim_groups ?? "groups",
      enabled: input.enabled ?? false,
    },
  });
}

/**
 * Update provider — omitted client_secret leaves existing encrypted value unchanged (mailer pattern).
 */
export async function updateIdentityProvider(
  prisma: PrismaClient | Prisma.TransactionClient,
  id: string,
  input: IdentityProviderInput,
): Promise<IdentityProvider> {
  const existing = await prisma.identityProvider.findUniqueOrThrow({ where: { id } });
  const endpoints = await resolveEndpoints({
    ...input,
    issuer: input.issuer || existing.issuer,
    authorization_endpoint: input.authorization_endpoint ?? existing.authorization_endpoint,
    token_endpoint: input.token_endpoint ?? existing.token_endpoint,
    jwks_uri: input.jwks_uri ?? existing.jwks_uri,
    userinfo_endpoint: input.userinfo_endpoint ?? existing.userinfo_endpoint ?? undefined,
  });

  return prisma.identityProvider.update({
    where: { id },
    data: {
      display_name: input.display_name,
      issuer: endpoints.issuer,
      client_id: input.client_id,
      ...(input.client_secret !== undefined && input.client_secret !== ""
        ? { client_secret_enc: encryptClientSecret(input.client_secret) }
        : {}),
      authorization_endpoint: endpoints.authorization_endpoint,
      token_endpoint: endpoints.token_endpoint,
      jwks_uri: endpoints.jwks_uri,
      userinfo_endpoint: endpoints.userinfo_endpoint,
      claim_email: input.claim_email ?? existing.claim_email,
      claim_name: input.claim_name ?? existing.claim_name,
      claim_groups: input.claim_groups ?? existing.claim_groups,
      enabled: input.enabled ?? existing.enabled,
    },
  });
}

export { testOidcConnection };

export function buildOidcRedirectUri(baseUrl: string, providerId: string): string {
  const base = baseUrl.replace(/\/$/, "");
  return `${base}/api/auth/oidc/${providerId}/callback`;
}

export function buildOidcAuthorizeUrl(
  provider: IdentityProvider,
  params: {
    redirectUri: string;
    state: string;
    nonce: string;
    codeChallenge: string;
  },
): string {
  const url = new URL(provider.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", provider.client_id);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", params.state);
  url.searchParams.set("nonce", params.nonce);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export interface GroupRoleMappingInput {
  group: string;
  role: string;
  scope_type: string;
  scope_id?: string | null;
}

const ALLOWED_MAPPING_ROLES = new Set(["superadmin", "admin", "operator"]);
const ALLOWED_MAPPING_SCOPE_TYPES = new Set(["instance", "organization", "event"]);

/** Reject mapping rows that would fail RoleAssignment CHECK constraints at login time. */
export function validateGroupRoleMappingInput(mapping: GroupRoleMappingInput): void {
  const group = mapping.group.trim();
  if (!group) {
    throw new Error("group is required for each mapping row");
  }
  if (!ALLOWED_MAPPING_ROLES.has(mapping.role)) {
    throw new Error(
      `Invalid role "${mapping.role}" — must be one of: superadmin, admin, operator`,
    );
  }
  if (!ALLOWED_MAPPING_SCOPE_TYPES.has(mapping.scope_type)) {
    throw new Error(
      `Invalid scope_type "${mapping.scope_type}" — must be one of: instance, organization, event`,
    );
  }
  mappingStorageScopeId(mapping.scope_type, mapping.scope_id);
}

function mappingStorageScopeId(scopeType: string, scopeId?: string | null): string {
  if (scopeType === "instance") return "";
  const trimmed = scopeId?.trim();
  if (!trimmed) {
    throw new Error(`scope_id is required for scope_type ${scopeType}`);
  }
  return trimmed;
}

export async function replaceProviderGroupMappings(
  prisma: PrismaClient | Prisma.TransactionClient,
  providerId: string,
  mappings: GroupRoleMappingInput[],
): Promise<void> {
  await prisma.oidcGroupRoleMapping.deleteMany({ where: { provider_id: providerId } });
  if (mappings.length === 0) return;
  for (const mapping of mappings) {
    validateGroupRoleMappingInput(mapping);
  }
  await prisma.oidcGroupRoleMapping.createMany({
    data: mappings.map((m) => ({
      provider_id: providerId,
      group: m.group,
      role: m.role,
      scope_type: m.scope_type,
      scope_id: mappingStorageScopeId(m.scope_type, m.scope_id),
    })),
  });
}

export async function createIdentityProviderWithMappings(
  prisma: PrismaClient,
  input: IdentityProviderInput,
  mappings: GroupRoleMappingInput[],
): Promise<IdentityProvider> {
  return prisma.$transaction(async (tx) => {
    const provider = await createIdentityProvider(tx, input);
    await replaceProviderGroupMappings(tx, provider.id, mappings);
    return provider;
  });
}

export async function updateIdentityProviderWithMappings(
  prisma: PrismaClient,
  id: string,
  input: IdentityProviderInput,
  mappings: GroupRoleMappingInput[],
): Promise<IdentityProvider> {
  return prisma.$transaction(async (tx) => {
    const provider = await updateIdentityProvider(tx, id, input);
    await replaceProviderGroupMappings(tx, provider.id, mappings);
    return provider;
  });
}

export async function listProviderGroupMappings(
  prisma: PrismaClient | Prisma.TransactionClient,
  providerId: string,
) {
  return prisma.oidcGroupRoleMapping.findMany({
    where: { provider_id: providerId },
    orderBy: { group: "asc" },
  });
}
