/**
 * Re-export export job drain for the CLI worker entry.
 * Implementation lives in @admitto/tickets (shared with web integration tests).
 */
export { drainExportJobs, type DrainExportJobsResult } from "@admitto/tickets";
