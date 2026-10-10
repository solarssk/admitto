import type { PrismaClient } from "@admitto/db";
import {
  refreshOneWalletPassStatus,
  type WalletPassProvider,
  type WalletStatusRefreshOutcome,
} from "@admitto/wallet";
import { attendeeIsLive } from "./lock-check.js";

/** What refreshOneWalletPassStatus answers, plus `erased`: the attendee is erased, or an erasure of
 * them is still open, and nothing was read from the provider. */
export type LiveWalletStatusRefreshOutcome = WalletStatusRefreshOutcome | "erased";

/**
 * refreshOneWalletPassStatus for the staff actions and the event-wide job (the single and the bulk
 * "Refresh status", and wallet_refresh_status): the last check before the provider is read. The
 * target was loaded with a plain query, which does not wait for an erasure that is still open and
 * shows the attendee as they were before it began; this check takes the attendee's row lock first,
 * so that erasure finishes and is seen, and the erased attendee's pass (the erasure's to delete at
 * the provider) is not read at all.
 *
 * Only the read is guarded. What the refresh writes (the registration counts, the first download,
 * the lifecycle the provider reports) is a retained fact about the pass, not personal data, and the
 * periodic sync and the webhook write the same columns without any attendee lock, so the write is
 * not taken under that lock either: a refresh whose provider read was already under way when an
 * erasure committed still records what the provider said.
 */
export async function refreshWalletPassStatusUnlessErased(
  db: PrismaClient,
  target: { attendeeId: string; providerPassId: string; userProvidedId: string },
  provider: WalletPassProvider,
): Promise<LiveWalletStatusRefreshOutcome> {
  if (!(await attendeeIsLive(db, target.attendeeId))) return "erased";
  return refreshOneWalletPassStatus(db, target, provider);
}
