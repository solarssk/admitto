/**
 * Re-export the event-wide wallet clean-up job drain (wallet_void_active) for the CLI worker entry.
 * Implementation lives in @admitto/tickets (shared with web integration tests).
 */
export { drainWalletCleanupJobs, type DrainWalletCleanupJobsResult } from "@admitto/tickets";
