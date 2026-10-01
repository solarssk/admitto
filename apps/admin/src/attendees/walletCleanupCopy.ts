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

/** " 3 are still inside their 24-hour safety window before removal." - empty when nothing is
 * waiting on the grace period. Explains WHY in plain terms (in case one needs to be restored by
 * mistake), not just that a wait exists - this line is what tells an admin who just ran "Remove
 * inactive passes" right after a wave of voids apart from one where nothing is voided/expired at
 * all, both of which otherwise read as the exact same "nothing removed" (PO report). */
function pendingGraceNote(pendingGraceCount: number): string {
  if (pendingGraceCount <= 0) return "";
  const verb = pendingGraceCount === 1 ? "is" : "are";
  return ` ${passes(pendingGraceCount)} ${verb} less than a day old - not yet eligible, in case one needs restoring.`;
}

const VOID_ACTIVE_COPY = {
  queued: "Voiding started. You'll see a summary when it's done.",
  failed: "Voiding the wallet passes did not run. Try again from More actions.",
  /** The job was queued, only checking on it failed: it may well still finish. */
  pollFailed: "Could not check on the voiding. It may still be running in the background.",
  stillRunning: "Voiding the wallet passes is still running in the background.",
  /** wallet_void_active has no grace period, so this never has anything to append - kept as a
   * function purely so toastWalletCleanupSucceeded can call `copy.nothing(...)` the same way for
   * both actions rather than branching on which one it is. */
  nothing: (_pendingGraceCount: number) => "There were no active wallet passes to void.",
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
  nothing: (pendingGraceCount: number) =>
    `There were no wallet passes ready to remove.${pendingGraceNote(pendingGraceCount)}`,
  done: (count: number, skipped: number) =>
    `${passes(count)} removed from the wallet service.${leftAloneNote(skipped, skipped === 1 ? "it had changed since" : "they had changed since")}`,
  withErrors: (count: number, errored: number) =>
    `${passes(count)} removed from the wallet service. ${errored} could not be removed. Run it again to try those once more.`,
};

export const WALLET_CLEANUP_COPY = { void_active: VOID_ACTIVE_COPY, remove_inactive: REMOVE_INACTIVE_COPY } as const;
export type WalletCleanupAction = keyof typeof WALLET_CLEANUP_COPY;
