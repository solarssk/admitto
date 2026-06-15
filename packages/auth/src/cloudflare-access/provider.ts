import type { IdentityProvider, PrismaClient, Prisma } from "@prisma/client";
import { PROVIDER_TYPE_CLOUDFLARE_ACCESS } from "../oidc/constants.js";
import type { CfAccessConfig } from "./config.js";

export const CF_ACCESS_CLIENT_ID_SENTINEL = "__cloudflare_access__";
export const CF_ACCESS_DISPLAY_NAME = "Cloudflare Access";

/** Upsert reserved IdentityProvider row for Cloudflare Access external identities. */
export async function ensureCloudflareAccessProvider(
  prisma: PrismaClient | Prisma.TransactionClient,
  config: Pick<CfAccessConfig, "teamDomain" | "jwksUri" | "enabled">,
): Promise<IdentityProvider> {
  const issuer = config.teamDomain;
  const existing = await prisma.identityProvider.findFirst({
    where: { provider_type: PROVIDER_TYPE_CLOUDFLARE_ACCESS },
  });

  const placeholderAuth = issuer ? `${issuer}/cdn-cgi/access/login` : "https://cloudflareaccess.com/";
  const data = {
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
  };

  if (existing) {
    return prisma.identityProvider.update({
      where: { id: existing.id },
      data,
    });
  }

  return prisma.identityProvider.create({ data });
}

export async function findCloudflareAccessProvider(
  prisma: PrismaClient | Prisma.TransactionClient,
): Promise<IdentityProvider | null> {
  return prisma.identityProvider.findFirst({
    where: { provider_type: PROVIDER_TYPE_CLOUDFLARE_ACCESS },
  });
}
