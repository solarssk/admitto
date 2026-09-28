/** What the operator reads once a clean-up job ends, written for an event manager: no provider
 * or job vocabulary, one sentence each. */
const passes = (count: number) => `${count} wallet ${count === 1 ? "pass" : "passes"}`;

const VOID_ACTIVE_COPY = {
  queued: "Voiding started. You'll see a summary when it's done.",
  failed: "Voiding the wallet passes did not run. Try again from More actions.",
  stillRunning: "Voiding the wallet passes is still running in the background.",
  nothing: "There were no active wallet passes to void.",
  done: (count: number, skipped: number) =>
    `${passes(count)} voided.` +
    (skipped > 0
      ? ` ${skipped} ${skipped === 1 ? "was" : "were"} left alone because ${skipped === 1 ? "it was" : "they were"} no longer active.`
      : ""),
  withErrors: (count: number, errored: number) =>
    `${passes(count)} voided. ${errored} could not be voided. Run it again to try those once more.`,
};

export const WALLET_CLEANUP_COPY = { void_active: VOID_ACTIVE_COPY } as const;
export type WalletCleanupAction = keyof typeof WALLET_CLEANUP_COPY;
