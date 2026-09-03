import type { PrismaClient } from "@admitto/db";
import type { WalletPassProvider } from "./provider.js";
import { registrationStatusToWalletPassFields } from "./registration-status-to-wallet-pass-fields.js";

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

export type WalletStatusRefreshOutcome = "refreshed" | "conflict";

/**
 * Pulls one attendee's current device-registration status directly from the provider (a read,
 * not a push) and writes it onto their WalletPass row - shared by the single-attendee "Refresh
 * status" action and its bulk/event-wide siblings, same reasoning as reissueOneWalletPass
 * (packages/tickets/src/reissue-wallet-pass.ts): one implementation, not one per caller.
 *
 * Retries once after a short delay on a "not found" response - PassCreator's own search index can
 * briefly lag right behind a status-affecting event, and a single resolved "not found" isn't
 * authoritative on its own. Still no match after the retry throws
 * WalletStatusCheckInconclusiveError rather than silently clearing previously-known registration
 * counts.
 *
 * The write is conditioned on the exact pass identity read by the caller (attendee_id +
 * providerPassId + userProvidedId), not just attendee_id - a concurrent delete+re-add during the
 * provider call would otherwise let this write stale registration data from the old pass onto a
 * new one's row. Returns "conflict" (never throws) when that guard doesn't match any row, so a
 * caller looping over many attendees can treat it the same as "nothing to do" rather than a hard
 * failure.
 */
export async function refreshOneWalletPassStatus(
  db: PrismaClient,
  target: { attendeeId: string; providerPassId: string; userProvidedId: string },
  provider: WalletPassProvider,
): Promise<WalletStatusRefreshOutcome> {
  let status = await provider.getRegistrationStatus(target.userProvidedId);
  if (!status) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    status = await provider.getRegistrationStatus(target.userProvidedId).catch(() => null);
  }
  if (!status) throw new WalletStatusCheckInconclusiveError();

  const { count } = await db.walletPass.updateMany({
    where: {
      attendee_id: target.attendeeId,
      provider_pass_id: target.providerPassId,
      user_provided_id: target.userProvidedId,
    },
    data: {
      ...registrationStatusToWalletPassFields(status),
      registration_checked_at: new Date(),
      // Matches syncOne's own success write (registration-sync.ts) - the periodic worker selects
      // its next stale-row batch by this field, not registration_checked_at, so leaving it
      // untouched here would make the row look never-synced and get re-picked on the very next
      // tick, seconds after this manual refresh already did the same work.
      registration_sync_attempted_at: new Date(),
    },
  });
  return count === 0 ? "conflict" : "refreshed";
}
