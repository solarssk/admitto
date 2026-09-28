/** What the operator reads once a clean-up job ends, written for an event manager: no provider
 * or job vocabulary, one sentence each. */
const passes = (count: number) => `${count} wallet ${count === 1 ? "pass" : "passes"}`;

/** " 3 were left alone because they had changed since." - empty when nothing was skipped. `reason`
 * is the clause after "because"; keep it in the past tense to match the fixed lead-in. */
function leftAloneNote(skipped: number, reason: string): string {
  if (skipped === 0) return "";
  const verb = skipped === 1 ? "was" : "were";
  return ` ${skipped} ${verb} left alone because ${reason}.`;
}

const VOID_ACTIVE_COPY = {
  queued: "Voiding started. You'll see a summary when it's done.",
  failed: "Voiding the wallet passes did not run. Try again from More actions.",
  /** The job was queued, only checking on it failed: it may well still finish. */
  pollFailed: "Could not check on the voiding. It may still be running in the background.",
  stillRunning: "Voiding the wallet passes is still running in the background.",
  nothing: "There were no active wallet passes to void.",
  done: (count: number, skipped: number) =>
    `${passes(count)} voided.${leftAloneNote(skipped, skipped === 1 ? "it was no longer active" : "they were no longer active")}`,
  withErrors: (count: number, errored: number) =>
    `${passes(count)} voided. ${errored} could not be voided. Run it again to try those once more.`,
};

const REMOVE_INACTIVE_COPY = {
  queued: "Removing started. You'll see a summary when it's done.",
  failed: "Removing the wallet passes did not run. Try again from More actions.",
  pollFailed: "Could not check on the removal. It may still be running in the background.",
  stillRunning: "Removing the wallet passes is still running in the background.",
  nothing: "There were no wallet passes ready to remove.",
  done: (count: number, skipped: number) =>
    `${passes(count)} removed from the wallet service.${leftAloneNote(skipped, skipped === 1 ? "it had changed since" : "they had changed since")}`,
  withErrors: (count: number, errored: number) =>
    `${passes(count)} removed from the wallet service. ${errored} could not be removed. Run it again to try those once more.`,
};

export const WALLET_CLEANUP_COPY = { void_active: VOID_ACTIVE_COPY, remove_inactive: REMOVE_INACTIVE_COPY } as const;
export type WalletCleanupAction = keyof typeof WALLET_CLEANUP_COPY;
