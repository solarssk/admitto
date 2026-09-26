import type { PrismaClient } from "@admitto/db";
import { applyProviderSnapshotToWalletPass } from "./apply-provider-snapshot.js";
import type { WalletPassProvider } from "./provider.js";

/** Thrown when the provider still has no matching record for a pass after the one retry below -
 * genuinely gone at the provider (deleted out of band) or longer-than-usual search-index lag.
 * Distinct from a plain provider error so callers (the single-attendee route today, its bulk and
 * event-wide siblings later) can each decide how to surface "the check itself was inconclusive"
 * versus a hard provider failure. */
export class WalletStatusCheckInconclusiveError extends Error {
  constructor() {
    super("wallet_status_check_inconclusive");
    this.name = "WalletStatusCheckInconclusiveError";
  }
}

/** "inactive" = the pass is not active (voided, expired, removed, or never issued) - nothing to
 * refresh, and no provider call was made. */
export type WalletStatusRefreshOutcome = "refreshed" | "conflict" | "inactive";

/**
 * Pulls one attendee's current state directly from the provider (a read, not a push) and writes it
 * onto their WalletPass row - shared by the single-attendee "Refresh status" action, its bulk and
 * event-wide siblings, and the `pass_voided` webhook signal, same reasoning as reissueOneWalletPass
 * (packages/tickets/src/reissue-wallet-pass.ts): one implementation, not one per caller. What is
 * written is the device-registration status, plus - through applyProviderSnapshotToWalletPass - the
 * one lifecycle transition an observation may cause (active -> voided/expired).
 *
 * Only an active pass is read at all: a voided or expired pass is Admitto's own recorded state and
 * is never polled again, so it returns "inactive" without a provider call.
 *
 * Retries once after a short delay on a "not found" response - PassCreator's own search index can
 * briefly lag right behind a status-affecting event, and a single resolved "not found" isn't
 * authoritative on its own. Still no match after the retry throws
 * WalletStatusCheckInconclusiveError rather than silently clearing previously-known registration
 * counts, and it is not read as proof the pass is gone either.
 *
 * The write is conditioned on the pass exactly as it was read before the provider call (identity
 * plus lifecycle state, see applyProviderSnapshotToWalletPass), not just attendee_id - a
 * concurrent delete+re-add, Void or Restore during the provider call would otherwise let this
 * write stale data onto a row that has since moved on. Returns "conflict" (never throws) when that
 * guard doesn't match any row, so a caller looping over many attendees can treat it the same as
 * "nothing to do" rather than a hard failure.
 */
export async function refreshOneWalletPassStatus(
  db: PrismaClient,
  target: { attendeeId: string; providerPassId: string; userProvidedId: string },
  provider: WalletPassProvider,
  options: { providerTimeZone?: string | null } = {},
): Promise<WalletStatusRefreshOutcome> {
  const ref = { providerPassId: target.providerPassId, userProvidedId: target.userProvidedId };
  const row = await db.walletPass.findFirst({
    where: {
      attendee_id: target.attendeeId,
      provider_pass_id: target.providerPassId,
      user_provided_id: target.userProvidedId,
    },
    select: { status: true, provider_commanded_at: true, provider_removed_at: true },
  });
  if (!row) return "conflict";
  if (row.status !== "active" || row.provider_removed_at) return "inactive";

  let snapshot = await provider.getPassSnapshot(ref);
  if (!snapshot) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    snapshot = await provider.getPassSnapshot(ref).catch(() => null);
  }
  if (!snapshot) throw new WalletStatusCheckInconclusiveError();

  const outcome = await applyProviderSnapshotToWalletPass(db, { ...target, ...row }, snapshot, {
    policy: provider.consistencyPolicy,
    providerTimeZone: options.providerTimeZone ?? null,
  });
  return outcome === "applied" ? "refreshed" : "conflict";
}
