/**
 * Re-export wallet_push job drain for the CLI worker entry.
 * Implementation lives in @admitto/tickets (shared with web integration tests).
 */
export { drainWalletPushJobs, type DrainWalletPushJobsResult } from "@admitto/tickets";
