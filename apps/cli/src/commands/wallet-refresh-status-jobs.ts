/**
 * Re-export wallet_refresh_status job drain for the CLI worker entry.
 * Implementation lives in @admitto/tickets (shared with web integration tests).
 */
export { drainWalletRefreshStatusJobs, type DrainWalletRefreshStatusJobsResult } from "@admitto/tickets";
