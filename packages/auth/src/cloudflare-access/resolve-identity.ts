import { randomInt } from "node:crypto";
import { isSerializationFailure, Prisma, type IdentityProvider, type PrismaClient } from "@admitto/db";
import type { JWTPayload } from "jose";
import {
  ExternalIdentityLinkError,
  type ExternalIdentityClaims,
} from "../external-identity/resolve-user.js";
import { applyOidcGroupRoleMappings } from "../oidc/group-role-mapping.js";
import { parseStringArrayClaim } from "../oidc/claims.js";
import type { CfAccessConfig } from "./config.js";

/**
 * Opaque Authentik subject that the Cloudflare Generic OIDC integration copies into
 * `payload.custom`. It is intentionally distinct from Cloudflare's own `sub`, which identifies
 * an Access session and is not the local account-binding key.
 */
export const CF_ACCESS_IDENTITY_CLAIM = "admitto_identity";

/** Enough attempts to absorb a concurrent provider disablement or user deactivation. */
const SERIALIZATION_RETRY_ATTEMPTS = 5;

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

/**
 * Read the group assertion for the configured direct OIDC provider from Cloudflare's copied
 * custom claims. `undefined` is intentionally different from `[]`: the former is incomplete
 * data, while the latter is an explicit assertion that the user belongs to no mapped groups.
 */
export function extractCfAccessSourceGroups(
  payload: JWTPayload,
  claimName: string,
): string[] | undefined {
  const custom = ownValue(payload, "custom");
  if (typeof custom !== "object" || custom === null || Array.isArray(custom)) return undefined;
  return parseStringArrayClaim(ownValue(custom, claimName));
}

function isRootPrismaClient(
  prisma: PrismaClient | Prisma.TransactionClient,
): prisma is PrismaClient {
  return typeof (prisma as PrismaClient).$transaction === "function";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run identity binding at SERIALIZABLE isolation and retry expected PostgreSQL serialization
 * conflicts. Transaction clients are already owned by the caller, so they are reused as-is.
 */
async function runCfAccessIdentityTransaction<T>(
  prisma: PrismaClient | Prisma.TransactionClient,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if (!isRootPrismaClient(prisma)) return fn(prisma);

  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (err) {
      if (!isSerializationFailure(err) || attempt >= SERIALIZATION_RETRY_ATTEMPTS - 1) {
        throw err;
      }
      await sleep(randomInt(Math.min(500, 25 * 2 ** attempt) + 1));
    }
  }
}

type LockedSourceProvider = { id: string; enabled: boolean; claim_groups: string };
type LockedUser = { id: string; is_active: boolean };

/** Lock the source-provider state for the rest of the binding transaction. */
async function lockSourceProvider(
  tx: Prisma.TransactionClient,
  sourceProviderId: string,
): Promise<LockedSourceProvider> {
  const rows = await tx.$queryRaw<LockedSourceProvider[]>`
    SELECT "id", "enabled", "claim_groups"
    FROM "IdentityProvider"
    WHERE "id" = ${sourceProviderId} AND "provider_type" = 'oidc'
    FOR SHARE
  `;
  const provider = rows[0];
  if (!provider?.enabled) {
    throw new ExternalIdentityLinkError("source_provider_unavailable");
  }
  return provider;
}

/** Lock the linked account state for the rest of the binding transaction. */
async function lockSourceUser(tx: Prisma.TransactionClient, userId: string): Promise<LockedUser> {
  const rows = await tx.$queryRaw<LockedUser[]>`
    SELECT "id", "is_active"
    FROM "User"
    WHERE "id" = ${userId}
    FOR SHARE
  `;
  const user = rows[0];
  if (!user?.is_active) {
    throw new ExternalIdentityLinkError("source_user_inactive");
  }
  return user;
}

export interface ResolveCfAccessIdentityInput {
  config: Pick<CfAccessConfig, "enabled" | "sourceProviderId">;
  cloudflareProvider: IdentityProvider;
  cloudflareSubject: string;
  payload: JWTPayload;
  claims: ExternalIdentityClaims;
}

/**
 * A staff admin page load fires many parallel `/api/admin/*` requests, each carrying the same
 * Cloudflare-issued JWT and each independently reaching this resolver. Without this, every one of
 * them opens its own SERIALIZABLE transaction against the same two ExternalIdentity rows, which
 * Postgres then aborts and retries under write-write conflict - functionally harmless (the retry
 * loop below absorbs it) but a real source of DB load and log noise.
 *
 * This coalesces only calls that are genuinely concurrent (arrive while an identical-token
 * resolution is already in flight) - deliberately *not* a time-based cache. The entry is removed
 * the instant that resolution settles, success or failure, so it can never outlive the burst that
 * created it. `lockSourceUser`/`lockSourceProvider` re-check `is_active`/`enabled` fresh on every
 * resolution and must keep doing so on every request: a superadmin deactivating this account or
 * disabling the source provider has to take effect on the very next request, and a TTL here -
 * however short - would let an already-revoked Cloudflare-authenticated caller keep working until
 * it expired.
 */
const resolutionCache = new Map<string, Promise<{ userId: string }>>();

/** For tests - reset the resolution cache between cases. */
export function clearCfAccessIdentityCacheForTests(): void {
  resolutionCache.clear();
}

function resolutionCacheKey(payload: JWTPayload): string | undefined {
  const sub = ownValue(payload, "sub");
  const iat = ownValue(payload, "iat");
  if (typeof sub !== "string" || !sub || typeof iat !== "number") return undefined;
  return `${sub}:${iat}`;
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
  const key = resolutionCacheKey(input.payload);
  const cached = key ? resolutionCache.get(key) : undefined;
  if (cached) {
    return cached;
  }

  const promise = resolveCfAccessIdentityUncached(prisma, input);
  if (key) {
    resolutionCache.set(key, promise);
    // Remove on both outcomes, not just failure - the moment this settles, this entry must stop
    // being served. Guarded on identity so a later, different in-flight call for the same key
    // (started after this one already cleaned up) is never evicted by this cleanup instead of its
    // own. The rejection handler here only stops it from becoming an unhandled rejection on this
    // internal chain - resolveCfAccessIdentityUncached's real rejection still propagates to every
    // caller awaiting `promise` itself.
    const evict = () => {
      if (resolutionCache.get(key) === promise) resolutionCache.delete(key);
    };
    promise.then(evict, evict);
  }
  return promise;
}

async function resolveCfAccessIdentityUncached(
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

  return runCfAccessIdentityTransaction(prisma, async (tx) => {
    const sourceProvider = await lockSourceProvider(tx, sourceProviderId);

    const sourceIdentity = await tx.externalIdentity.findUnique({
      where: {
        provider_id_subject: {
          provider_id: sourceProvider.id,
          subject: sourceSubject,
        },
      },
      select: { id: true, user_id: true },
    });
    if (!sourceIdentity) {
      throw new ExternalIdentityLinkError("source_identity_not_linked");
    }
    await lockSourceUser(tx, sourceIdentity.user_id);

    const sourceGroups = extractCfAccessSourceGroups(input.payload, sourceProvider.claim_groups);
    const sourceHasRoleMappings =
      (await tx.oidcGroupRoleMapping.count({ where: { provider_id: sourceProvider.id } })) > 0;
    // If this provider drives roles, a missing/malformed copied claim must not silently retain
    // old grants. An explicit [] still reaches the mapper and revokes provider-owned grants.
    if (sourceHasRoleMappings && sourceGroups === undefined) {
      throw new ExternalIdentityLinkError("source_groups_unavailable");
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
    }

    // Recheck immediately before any role or identity write. `FOR SHARE` also prevents a
    // concurrent provider disablement or account deactivation from committing until this
    // transaction has either completed or been retried at SERIALIZABLE isolation.
    await lockSourceProvider(tx, sourceProvider.id);
    await lockSourceUser(tx, sourceIdentity.user_id);

    const now = new Date();
    await tx.externalIdentity.update({
      where: { id: sourceIdentity.id },
      data: {
        ...(sourceGroups === undefined ? {} : { groups: sourceGroups }),
        last_login_at: now,
      },
    });
    await applyOidcGroupRoleMappings(tx, sourceProvider.id, sourceIdentity.user_id, sourceGroups);

    if (existingCfIdentity) {
      await tx.externalIdentity.update({
        where: { id: existingCfIdentity.id },
        data: { last_login_at: now },
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
        // Role grants come only from the explicitly configured direct provider's copied custom
        // claim above, never from Cloudflare's own group data.
        groups: [],
        last_login_at: now,
      },
    });
    return { userId: sourceIdentity.user_id };
  });
}
