/**
 * Claim and run pending event-wide wallet clean-up AdminJobs (currently `wallet_void_active`): the
 * same action for every pass of one event that the Attendees selection routes cap at
 * WALLET_BULK_SEND_LIMIT (100) - void all active passes, and (in a later step) remove all inactive
 * ones at the provider. One drain for every clean-up type, each with its own handler, so a new
 * clean-up action is one more entry in HANDLERS rather than another copy of this claim/progress/
 * finalize/reclaim scaffolding (the shape wallet_refresh_status already has).
 *
 * Chunked at the same low concurrency as wallet_push/wallet_refresh_status (ADR 0041 §3:
 * PassCreator's own limit is 600 req/min, "keep client concurrency low (~8)") - a large event can
 * genuinely take minutes, that is PassCreator's own rate limit, not something to optimize away.
 * A job is resumable in the sense that matters: every handler only acts on a pass that is still
 * eligible when it reaches it, so running the same action again after a crash or a partial failure
 * simply continues with what is left.
 *
 * Works on an archived event and with the wallet master switch off (the provider is resolved from
 * the event's credentials alone): winding passes down after an event is exactly when this is used.
 */
import type { PrismaClient } from "@admitto/db";
import { emitSystemLog } from "@admitto/shared/system-log";
import type { WalletPassProvider } from "@admitto/wallet";
import { claimNextAdminJob } from "./claim-admin-job.js";
import type { OpsAuditContext } from "./ops-audit.js";
import { reclaimStaleAdminJobsByType } from "./reclaim-stale-admin-jobs-by-type.js";
import { resolveEventWalletProvider } from "./resolve-event-wallet-provider.js";
import { voidOneWalletPassAtProvider } from "./void-wallet-pass-at-provider.js";

/** Same 30-minute budget as wallet_push - a large clean-up is expected to take a while, bounded by
 * PassCreator's own rate limit, not a sign the worker died. */
export const DEFAULT_WALLET_CLEANUP_JOB_STALE_RUNNING_MS = 30 * 60 * 1000;

export const WALLET_CLEANUP_CONCURRENCY = 8;

export const WALLET_CLEANUP_JOB_TYPES = ["wallet_void_active"] as const;
export type WalletCleanupJobType = (typeof WALLET_CLEANUP_JOB_TYPES)[number];

export const STALE_WALLET_CLEANUP_JOB_ERROR =
  "Wallet clean-up job abandoned (worker stopped while running). Start it again.";
export const STALE_WALLET_CLEANUP_PENDING_ERROR =
  "Wallet clean-up job was never picked up by the worker. Start the worker and try again.";
export const WALLET_CLEANUP_JOB_BAD_REQUEST_ERROR = "Wallet clean-up job has an invalid request payload.";
export const WALLET_CLEANUP_JOB_NOT_CONFIGURED_ERROR = "Wallet is not configured for this event.";
export const WALLET_CLEANUP_JOB_GENERIC_ERROR =
  "Wallet clean-up failed unexpectedly. Contact support if this continues.";
export const WALLET_CLEANUP_JOB_ALL_FAILED_ERROR =
  "Wallet clean-up failed for every targeted pass. Check the wallet provider's status, then try again.";

export type DrainWalletCleanupJobsResult = {
  claimed: number;
  succeeded: number;
  failed: number;
  reclaimed: number;
};

/** Every clean-up job is event-wide by construction - no operator-bounded selection to carry. */
type WalletCleanupRequest = { eventId: string };

type ClaimedWalletCleanupJob = NonNullable<Awaited<ReturnType<typeof claimNextAdminJob>>>;

/** One pass a clean-up action may apply to - the row as it was read, before the provider call. */
type WalletCleanupTarget = {
  attendeeId: string;
  providerPassId: string;
  userProvidedId: string | null;
  status: string;
  providerCommandedAt: Date | null;
  providerRemovedAt: Date | null;
};

type WalletCleanupHandler = {
  loadTargets(db: PrismaClient, eventId: string): Promise<WalletCleanupTarget[]>;
  /** `done` - the action was applied to this pass. `skipped` - nothing to do for it (it changed
   * since it was read). A thrown error counts as failed and leaves the pass for a later run. */
  act(
    db: PrismaClient,
    eventId: string,
    target: WalletCleanupTarget,
    provider: WalletPassProvider,
    audit: OpsAuditContext,
  ): Promise<"done" | "skipped">;
};

/** Every active pass under the event that still exists at the provider. */
async function loadActivePassTargets(db: PrismaClient, eventId: string): Promise<WalletCleanupTarget[]> {
  const rows = await db.walletPass.findMany({
    where: {
      status: "active",
      provider_pass_id: { not: null },
      provider_removed_at: null,
      attendee: { event_id: eventId },
    },
    select: {
      attendee_id: true,
      provider_pass_id: true,
      user_provided_id: true,
      status: true,
      provider_commanded_at: true,
      provider_removed_at: true,
    },
  });
  return rows.map((row) => ({
    attendeeId: row.attendee_id,
    providerPassId: row.provider_pass_id!,
    userProvidedId: row.user_provided_id,
    status: row.status,
    providerCommandedAt: row.provider_commanded_at,
    providerRemovedAt: row.provider_removed_at,
  }));
}

/** One handler per job type: `Record` makes a type without an entry a compile error. The drain walks
 * the entries (below) rather than looking a handler up by the type of a row it just claimed. */
const HANDLERS: Record<WalletCleanupJobType, WalletCleanupHandler> = {
  wallet_void_active: {
    loadTargets: loadActivePassTargets,
    async act(db, eventId, target, provider, audit) {
      const outcome = await voidOneWalletPassAtProvider(db, eventId, target, provider, audit, { eventWide: true });
      return outcome === "voided" ? "done" : "skipped";
    },
  },
};

const HANDLER_ENTRIES = Object.entries(HANDLERS) as [WalletCleanupJobType, WalletCleanupHandler][];

function readRequest(job: { result_json: unknown }): WalletCleanupRequest | null {
  if (!job.result_json || typeof job.result_json !== "object" || Array.isArray(job.result_json)) {
    return null;
  }
  const request = (job.result_json as Record<string, unknown>).request;
  if (!request || typeof request !== "object" || Array.isArray(request)) return null;
  const eventId = (request as Record<string, unknown>).eventId;
  if (typeof eventId !== "string" || !eventId) return null;
  return { eventId };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Maps the two deliberately-thrown internal signals in runOneWalletCleanupJob below to their
 * operator-facing copy, and everything else (an unexpected database, crypto, or provider
 * exception) to one generic fixed message - AdminJob.error is read verbatim by the polling UI, so
 * it must never carry raw exception text (AGENTS.md's "Admin API errors in the UI" convention).
 * The real error is still logged server-side. */
function walletCleanupJobErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    if (err.message === "wallet_cleanup_job_bad_request") return WALLET_CLEANUP_JOB_BAD_REQUEST_ERROR;
    if (err.message === "wallet_not_configured") return WALLET_CLEANUP_JOB_NOT_CONFIGURED_ERROR;
  }
  return WALLET_CLEANUP_JOB_GENERIC_ERROR;
}

async function markWalletCleanupJobFailed(db: PrismaClient, job: ClaimedWalletCleanupJob, err: unknown): Promise<void> {
  emitSystemLog("wallet", "error", "wallet_cleanup_job_failed", {
    job_id: job.id,
    job_type: job.type,
    error: err instanceof Error ? err.message : String(err),
  });
  await db.adminJob.update({
    where: { id: job.id },
    data: { status: "failed", finished_at: new Date(), error: walletCleanupJobErrorMessage(err) },
  });
}

/** Writes the job's terminal state once the per-target loop is done. */
async function finalizeWalletCleanupJob(
  db: PrismaClient,
  job: ClaimedWalletCleanupJob,
  request: WalletCleanupRequest,
  targetCount: number,
  tally: { done: number; skipped: number; errored: number },
): Promise<"succeeded" | "failed"> {
  const { done, skipped, errored } = tally;

  if (errored > 0) {
    // An event-wide clean-up has no operator watching a toast for each pass, so this is the only
    // signal ops has that some targets failed.
    emitSystemLog("wallet", "error", "wallet_cleanup_job_had_errors", {
      job_id: job.id,
      job_type: job.type,
      event_id: request.eventId,
      done,
      skipped,
      errored,
    });
  }

  const allFailed = targetCount > 0 && errored === targetCount;
  // Only a job that is still running is finalized: one that was reclaimed as stale (marked failed)
  // while this loop was still going keeps that status instead of being overwritten.
  const { count } = await db.adminJob.updateMany({
    where: { id: job.id, status: "running" },
    data: {
      status: allFailed ? "failed" : "succeeded",
      finished_at: new Date(),
      result_json: { request, done, skipped, errored },
      error: allFailed ? WALLET_CLEANUP_JOB_ALL_FAILED_ERROR : null,
    },
  });
  if (count === 0) return "failed";
  return allFailed ? "failed" : "succeeded";
}

async function runOneWalletCleanupJob(
  db: PrismaClient,
  job: ClaimedWalletCleanupJob,
  handler: WalletCleanupHandler,
): Promise<"succeeded" | "failed"> {
  try {
    const request = readRequest(job);
    if (!request) throw new Error("wallet_cleanup_job_bad_request");
    const eventId = request.eventId;

    // The event's credentials alone, not the wallet master switch: this winds down passes that
    // already exist, which must keep working after the feature is switched off or the event is
    // archived (same rule as the single and bulk Void/Remove routes).
    const provider = await resolveEventWalletProvider(db, eventId, { ignoreWalletEnabled: true });
    if (!provider) throw new Error("wallet_not_configured");

    const targets = await handler.loadTargets(db, eventId);
    await db.adminJob.update({
      where: { id: job.id },
      data: { progress_total: targets.length, progress_done: 0 },
    });

    const audit: OpsAuditContext = {
      operator: job.actor_user_id ?? undefined,
      sessionId: job.session_id ?? undefined,
      timezone: job.client_timezone ?? undefined,
    };

    let done = 0;
    let skipped = 0;
    let errored = 0;
    let processed = 0;

    for (const batch of chunk(targets, WALLET_CLEANUP_CONCURRENCY)) {
      const settled = await Promise.allSettled(
        batch.map((target) => handler.act(db, eventId, target, provider, audit)),
      );
      for (const outcome of settled) {
        if (outcome.status === "rejected") errored += 1;
        else if (outcome.value === "done") done += 1;
        else skipped += 1;
      }
      processed += batch.length;
      await db.adminJob.update({ where: { id: job.id }, data: { progress_done: processed } });
    }

    return await finalizeWalletCleanupJob(db, job, request, targets.length, { done, skipped, errored });
  } catch (err) {
    await markWalletCleanupJobFailed(db, job, err);
    return "failed";
  }
}

export async function reclaimStaleWalletCleanupJobs(
  db: PrismaClient,
  options: { olderThanMs?: number; heartbeatStaleMs?: number; now?: Date } = {},
): Promise<{ reclaimed: number }> {
  let reclaimed = 0;
  for (const type of WALLET_CLEANUP_JOB_TYPES) {
    const result = await reclaimStaleAdminJobsByType(
      db,
      type,
      { running: STALE_WALLET_CLEANUP_JOB_ERROR, pending: STALE_WALLET_CLEANUP_PENDING_ERROR },
      DEFAULT_WALLET_CLEANUP_JOB_STALE_RUNNING_MS,
      options,
    );
    reclaimed += result.reclaimed;
  }
  return { reclaimed };
}

/** Claims and runs up to `limit` jobs across every clean-up type, oldest pending first within a
 * type. */
export async function drainWalletCleanupJobs(
  db: PrismaClient,
  options: { limit?: number; staleRunningMs?: number; heartbeatStaleMs?: number } = {},
): Promise<DrainWalletCleanupJobsResult> {
  const limit = options.limit && options.limit > 0 ? Math.floor(options.limit) : 1;
  const { reclaimed } = await reclaimStaleWalletCleanupJobs(db, {
    olderThanMs: options.staleRunningMs,
    heartbeatStaleMs: options.heartbeatStaleMs,
  });

  let claimed = 0;
  let succeeded = 0;
  let failed = 0;

  for (const [type, handler] of HANDLER_ENTRIES) {
    while (claimed < limit) {
      const job = await claimNextAdminJob(db, type);
      if (!job) break;
      claimed += 1;
      const outcome = await runOneWalletCleanupJob(db, job, handler);
      if (outcome === "succeeded") succeeded += 1;
      else failed += 1;
    }
  }

  return { claimed, succeeded, failed, reclaimed };
}
