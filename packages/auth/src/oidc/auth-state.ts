import type { PrismaClient, Prisma } from "@prisma/client";
import {
  OIDC_AUTH_STATE_CONSUMED_RETENTION_MS,
  OIDC_AUTH_STATE_TTL_MS,
} from "./constants.js";

/** Delete expired and old consumed OAuth state rows. */
export async function sweepExpiredOidcAuthStates(
  prisma: PrismaClient | Prisma.TransactionClient,
): Promise<number> {
  const now = new Date();
  const consumedBefore = new Date(now.getTime() - OIDC_AUTH_STATE_CONSUMED_RETENTION_MS);
  const result = await prisma.oidcAuthState.deleteMany({
    where: {
      OR: [{ expires_at: { lt: now } }, { consumed_at: { lt: consumedBefore } }],
    },
  });
  return result.count;
}

export interface CreateOidcAuthStateInput {
  providerId: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  redirectNext?: string;
}

/** Persist short-lived OAuth state; sweeps stale rows first. */
export async function createOidcAuthState(
  prisma: PrismaClient | Prisma.TransactionClient,
  input: CreateOidcAuthStateInput,
): Promise<void> {
  await sweepExpiredOidcAuthStates(prisma);
  const expires_at = new Date(Date.now() + OIDC_AUTH_STATE_TTL_MS);
  await prisma.oidcAuthState.create({
    data: {
      provider_id: input.providerId,
      state: input.state,
      nonce: input.nonce,
      code_verifier: input.codeVerifier,
      redirect_next: input.redirectNext ?? null,
      expires_at,
    },
  });
}

export interface ConsumedOidcAuthState {
  id: string;
  provider_id: string;
  nonce: string;
  code_verifier: string;
  redirect_next: string | null;
}

/**
 * Atomically consume OAuth state (single-use). Returns null if missing, expired, or already consumed.
 */
export async function consumeOidcAuthState(
  prisma: PrismaClient | Prisma.TransactionClient,
  state: string,
): Promise<ConsumedOidcAuthState | null> {
  const now = new Date();
  const row = await prisma.oidcAuthState.findUnique({ where: { state } });
  if (!row) return null;
  if (row.consumed_at) return null;
  if (row.expires_at.getTime() <= now.getTime()) return null;

  const updated = await prisma.oidcAuthState.updateMany({
    where: { id: row.id, consumed_at: null },
    data: { consumed_at: now },
  });
  if (updated.count !== 1) return null;

  return {
    id: row.id,
    provider_id: row.provider_id,
    nonce: row.nonce,
    code_verifier: row.code_verifier,
    redirect_next: row.redirect_next,
  };
}
