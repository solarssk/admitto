import type { PrismaClient, Prisma } from "@admitto/db";
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
  /** Set only for explicit account-link flows after step-up verification. */
  linkUserId?: string;
  /** Password/TOTP re-verification timestamp for link flows. */
  linkStepUpAt?: Date;
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
      link_user_id: input.linkUserId ?? null,
      link_step_up_at: input.linkStepUpAt ?? null,
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
  link_user_id: string | null;
  link_step_up_at: Date | null;
}

interface ConsumedOidcAuthStateRow {
  id: string;
  provider_id: string;
  nonce: string;
  code_verifier: string;
  redirect_next: string | null;
  link_user_id: string | null;
  link_step_up_at: Date | null;
}

/**
 * Atomically consume OAuth state (single-use). Returns null if missing, expired, or already consumed.
 *
 * `expires_at`/`consumed_at` are `timestamp` (no tz) columns holding naive UTC wall-clock
 * values (matching how Prisma's typed API writes/reads `DateTime` elsewhere in this module).
 * Comparing them against bare `NOW()` (`timestamptz`) makes Postgres cast `NOW()` down to
 * `timestamp` using the *session* `TimeZone` GUC, reinterpreting the naive value as local
 * wall-clock time in that zone before converting back to an absolute instant — silently
 * shifting the comparison by the zone's UTC offset, in whichever direction that zone points:
 *   - Positive offset (session zone ahead of UTC, e.g. Europe/Warsaw, +2h) shifts the
 *     effective instant *earlier*, past the 10-minute TTL, so every row looks already
 *     expired and OIDC login fails closed immediately.
 *   - Negative offset (session zone behind UTC, e.g. America/New_York, -4h/-5h) shifts it
 *     *later* instead, so a row keeps validating as "not yet expired" for TTL + |offset| —
 *     hours past its intended lifetime. Login still works, but the single-use
 *     state/nonce/PKCE-verifier row stays replayable far longer than intended: a
 *     security-relevant lifetime extension, not just a cosmetic delay.
 * `NOW() AT TIME ZONE 'utc'` yields a naive UTC timestamp that lines up with the stored
 * values regardless of session timezone, closing both cases.
 */
export async function consumeOidcAuthState(
  prisma: PrismaClient | Prisma.TransactionClient,
  state: string,
): Promise<ConsumedOidcAuthState | null> {
  const rows = await prisma.$queryRaw<ConsumedOidcAuthStateRow[]>`
    UPDATE "OidcAuthState"
    SET "consumed_at" = (NOW() AT TIME ZONE 'utc')
    WHERE "state" = ${state}
      AND "consumed_at" IS NULL
      AND "expires_at" > (NOW() AT TIME ZONE 'utc')
    RETURNING "id", "provider_id", "nonce", "code_verifier", "redirect_next", "link_user_id", "link_step_up_at"
  `;
  return rows[0] ?? null;
}
