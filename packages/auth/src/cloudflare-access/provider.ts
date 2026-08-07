import type { IdentityProvider, PrismaClient, Prisma } from "@admitto/db";
import { PROVIDER_TYPE_CLOUDFLARE_ACCESS } from "../oidc/constants.js";
import type { CfAccessConfig } from "./config.js";

export const CF_ACCESS_CLIENT_ID_SENTINEL = "__cloudflare_access__";
export const CF_ACCESS_DISPLAY_NAME = "Cloudflare Access";

function providerDataFromConfig(
  config: Pick<CfAccessConfig, "teamDomain" | "jwksUri" | "enabled">,
) {
  const issuer = config.teamDomain;
  const placeholderAuth = issuer ? `${issuer}/cdn-cgi/access/login` : "https://cloudflareaccess.com/";
  return {
    provider_type: PROVIDER_TYPE_CLOUDFLARE_ACCESS,
    issuer: issuer || "https://cloudflareaccess.com",
    client_id: CF_ACCESS_CLIENT_ID_SENTINEL,
    authorization_endpoint: placeholderAuth,
    token_endpoint: placeholderAuth,
    jwks_uri: config.jwksUri || `${issuer || "https://cloudflareaccess.com"}/cdn-cgi/access/certs`,
    display_name: CF_ACCESS_DISPLAY_NAME,
    enabled: config.enabled && Boolean(issuer),
    claim_email: "email",
    claim_name: "name",
    claim_groups: "groups",
    claim_given_name: "given_name",
    claim_family_name: "family_name",
    claim_phone: "phone_number",
  };
}

function providerNeedsUpdate(existing: IdentityProvider, data: ReturnType<typeof providerDataFromConfig>): boolean {
  return (
    existing.issuer !== data.issuer ||
    existing.jwks_uri !== data.jwks_uri ||
    existing.enabled !== data.enabled ||
    existing.authorization_endpoint !== data.authorization_endpoint ||
    existing.token_endpoint !== data.token_endpoint
  );
}

/** Upsert reserved IdentityProvider row for Cloudflare Access external identities. */
export async function ensureCloudflareAccessProvider(
  prisma: PrismaClient | Prisma.TransactionClient,
  config: Pick<CfAccessConfig, "teamDomain" | "jwksUri" | "enabled">,
): Promise<IdentityProvider> {
  const data = providerDataFromConfig(config);
  const existing = await prisma.identityProvider.findFirst({
    where: { provider_type: PROVIDER_TYPE_CLOUDFLARE_ACCESS },
  });

  if (existing) {
    if (!providerNeedsUpdate(existing, data)) return existing;
    return prisma.identityProvider.update({
      where: { id: existing.id },
      data,
    });
  }

  // Atomic create — concurrent boot (env-only rollout) races on @@unique([issuer, client_id]).
  return prisma.identityProvider.upsert({
    where: {
      issuer_client_id: {
        issuer: data.issuer,
        client_id: data.client_id,
      },
    },
    create: data,
    update: data,
  });
}

export async function findCloudflareAccessProvider(
  prisma: PrismaClient | Prisma.TransactionClient,
): Promise<IdentityProvider | null> {
  return prisma.identityProvider.findFirst({
    where: { provider_type: PROVIDER_TYPE_CLOUDFLARE_ACCESS },
  });
}
