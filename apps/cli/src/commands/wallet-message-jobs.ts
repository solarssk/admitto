/**
 * Re-export wallet_message job drain for the CLI worker entry.
 * Implementation lives in @admitto/tickets (shared with web integration tests).
 */
export { drainWalletMessageJobs, type DrainWalletMessageJobsResult } from "@admitto/tickets";
