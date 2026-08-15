import type { IdentityProvider, Prisma, PrismaClient } from "@admitto/db";
import type { JWTPayload } from "jose";
import { runInTransaction } from "../prisma-tx.js";
import {
  ExternalIdentityLinkError,
  type ExternalIdentityClaims,
} from "../external-identity/resolve-user.js";
import type { CfAccessConfig } from "./config.js";

/**
 * Opaque Authentik subject that the Cloudflare Generic OIDC integration copies into
 * `payload.custom`. It is intentionally distinct from Cloudflare's own `sub`, which identifies
 * an Access session and is not the local account-binding key.
 */
export const CF_ACCESS_IDENTITY_CLAIM = "admitto_identity";

function ownValue(value: object, key: string): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

/**
 * Read the canonical source subject before any database write. The value must be an opaque
 * identifier (not an e-mail address), so Cloudflare can never auto-link a local account merely
 * because a signed token happens to carry the same e-mail claim.
 */
export function extractCfAccessSourceSubject(payload: JWTPayload): string {
  const custom = ownValue(payload, "custom");
  if (typeof custom !== "object" || custom === null || Array.isArray(custom)) {
    throw new ExternalIdentityLinkError("missing_canonical_identity");
  }

  const value = ownValue(custom, CF_ACCESS_IDENTITY_CLAIM);
  if (typeof value !== "string") {
    throw new ExternalIdentityLinkError("missing_canonical_identity");
  }
  const subject = value.trim();
  if (!subject || subject.length > 512 || subject.includes("@")) {
    throw new ExternalIdentityLinkError("invalid_canonical_identity");
  }
  return subject;
}

export interface ResolveCfAccessIdentityInput {
  config: Pick<CfAccessConfig, "enabled" | "sourceProviderId">;
  cloudflareProvider: IdentityProvider;
  cloudflareSubject: string;
  payload: JWTPayload;
  claims: ExternalIdentityClaims;
}

/**
 * Resolve a Cloudflare Access subject to an already-linked identity from one explicitly selected
 * OIDC provider. This intentionally has no JIT-user or e-mail-link path. Cloudflare's fully
 * verified JWT and the configured provider are the trust boundary that authorizes this automatic
 * link; interactive OIDC link step-up is therefore not applicable here.
 */
export async function resolveCfAccessIdentityFromValidatedJwt(
  prisma: PrismaClient | Prisma.TransactionClient,
  input: ResolveCfAccessIdentityInput,
): Promise<{ userId: string }> {
  // Validate this source-provided identity before opening a transaction. In particular, never
  // let the generic OIDC resolver see a valid CF JWT without this canonical binding.
  const sourceSubject = extractCfAccessSourceSubject(input.payload);
  const sourceProviderId = input.config.sourceProviderId.trim();
  if (!input.config.enabled || !sourceProviderId) {
    throw new ExternalIdentityLinkError("source_provider_not_configured");
  }

  return runInTransaction(prisma, async (tx) => {
    const sourceProvider = await tx.identityProvider.findFirst({
      where: { id: sourceProviderId, provider_type: "oidc", enabled: true },
      select: { id: true },
    });
    if (!sourceProvider) {
      throw new ExternalIdentityLinkError("source_provider_unavailable");
    }

    const sourceIdentity = await tx.externalIdentity.findUnique({
      where: {
        provider_id_subject: {
          provider_id: sourceProvider.id,
          subject: sourceSubject,
        },
      },
      include: { user: true },
    });
    if (!sourceIdentity) {
      throw new ExternalIdentityLinkError("source_identity_not_linked");
    }
    if (!sourceIdentity.user.is_active) {
      throw new ExternalIdentityLinkError("source_user_inactive");
    }

    const existingCfIdentity = await tx.externalIdentity.findUnique({
      where: {
        provider_id_subject: {
          provider_id: input.cloudflareProvider.id,
          subject: input.cloudflareSubject,
        },
      },
    });
    if (existingCfIdentity) {
      if (existingCfIdentity.user_id !== sourceIdentity.user_id) {
        throw new ExternalIdentityLinkError("cloudflare_subject_already_linked");
      }
      await tx.externalIdentity.update({
        where: { id: existingCfIdentity.id },
        data: { last_login_at: new Date() },
      });
      return { userId: sourceIdentity.user_id };
    }

    await tx.externalIdentity.create({
      data: {
        provider_id: input.cloudflareProvider.id,
        subject: input.cloudflareSubject,
        user_id: sourceIdentity.user_id,
        email: input.claims.email ?? null,
        name: input.claims.name ?? null,
        phone: input.claims.phone ?? null,
        // Cloudflare may omit or trim custom data. Never use its groups for role grants; direct
        // Authentik OIDC logins remain the only source for group-to-role synchronisation.
        groups: [],
        last_login_at: new Date(),
      },
    });
    return { userId: sourceIdentity.user_id };
  });
}
