/** What the operator reads once a clean-up job ends, written for an event manager: no provider
 * or job vocabulary, one sentence each. */
const VOID_ACTIVE_COPY = {
  queued: "Voiding queued - you'll see a summary once it finishes.",
  failed: "Voiding the wallet passes failed to run. Try again from More actions.",
  stillRunning: "Voiding the wallet passes is still running in the background.",
  nothing: "There were no active wallet passes to void.",
  done: (count: number, skipped: number) =>
    `${count} wallet ${count === 1 ? "pass" : "passes"} voided${skipped > 0 ? ` (${skipped} skipped)` : ""}.`,
  withErrors: (count: number, errored: number) =>
    `${count} wallet ${count === 1 ? "pass" : "passes"} voided, ${errored} could not be voided. Run it again to retry those.`,
};

export const WALLET_CLEANUP_COPY = { void_active: VOID_ACTIVE_COPY } as const;
export type WalletCleanupAction = keyof typeof WALLET_CLEANUP_COPY;
