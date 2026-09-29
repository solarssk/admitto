import type { PrismaClient } from "@admitto/db";

export type WalletExpiryResult = { expired: number };

/**
 * Flips every wallet pass whose canonical `expires_at` (plan v4.2 step 6 - Admitto's own,
 * provider-independent expiration date; never the provider's own observed value, which is never
 * persisted) has passed to "expired". Active and voided passes both qualify - canonical expiry
 * outranks a manual void, the same way it outranks everything else this pass's status could be
 * carrying, but `voided_at` is left untouched as history, so a voided-then-expired row still shows
 * when and that it was voided before it expired. No provider contact at all (this is a purely
 * local fact - Admitto decided the date, not PassCreator) and no archived-event exception - an
 * event's own end time keeps mattering after the event archives, same as the rest of plan v4.2's
 * lifecycle rules. A single indexed UPDATE (`WalletPass_expires_at_pending_idx`) rather than a
 * paginated per-row loop: unlike the provider-calling jobs (wallet_sync, wallet_push, ...), there's
 * no external rate limit to respect here, so nothing is gained by batching it.
 */
export async function runWalletExpiry(db: PrismaClient, nowMs = Date.now()): Promise<WalletExpiryResult> {
  const { count } = await db.walletPass.updateMany({
    where: { status: { in: ["active", "voided"] }, expires_at: { lte: new Date(nowMs) } },
    data: { status: "expired" },
  });
  return { expired: count };
}
