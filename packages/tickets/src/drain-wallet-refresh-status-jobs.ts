/**
 * Claim and run pending AdminJob type=wallet_refresh_status - pulls each target attendee's
 * current device-registration status straight from the provider, via the same
 * refreshOneWalletPassStatus used by the single-attendee and bulk "Refresh status" actions.
 * Always event-wide (there's no attendee_ids-kind variant - an operator-bounded selection
 * refreshes synchronously instead, see attendees-api-routes.ts's bulk-wallet-refresh-status),
 * unlike its wallet_push sibling. Chunked at the same low concurrency as wallet_push (ADR 0041
 * §3: PassCreator's own limit is 600 req/min, "keep client concurrency low (~8)") - a large
 * refresh can genuinely take minutes, that's PassCreator's own rate limit, not something to
 * optimize away.
 */
import type { PrismaClient } from "@admitto/db";
import { emitSystemLog } from "@admitto/shared/system-log";
import { refreshOneWalletPassStatus } from "@admitto/wallet";
import { claimNextAdminJob } from "./claim-admin-job.js";
import { reclaimStaleAdminJobsByType } from "./reclaim-stale-admin-jobs-by-type.js";
import { resolveEventWalletProvider } from "./resolve-event-wallet-provider.js";

/** Same 30-minute budget as wallet_push - a large refresh is expected to take a while, bounded by
 * PassCreator's own rate limit, not a sign the worker died. */
export const DEFAULT_WALLET_REFRESH_STATUS_JOB_STALE_RUNNING_MS = 30 * 60 * 1000;

export const WALLET_REFRESH_STATUS_CONCURRENCY = 8;

export const STALE_WALLET_REFRESH_STATUS_JOB_ERROR =
  "Wallet refresh status job abandoned (worker stopped while running). Start it again.";
export const STALE_WALLET_REFRESH_STATUS_PENDING_ERROR =
  "Wallet refresh status job was never picked up by the worker. Start the worker and try again.";
export const WALLET_REFRESH_STATUS_JOB_BAD_REQUEST_ERROR =
  "Wallet refresh status job has an invalid request payload.";
export const WALLET_REFRESH_STATUS_JOB_NOT_CONFIGURED_ERROR = "Wallet is not configured for this event.";
export const WALLET_REFRESH_STATUS_JOB_GENERIC_ERROR =
  "Wallet status refresh failed unexpectedly. Contact support if this continues.";
export const WALLET_REFRESH_STATUS_JOB_ALL_FAILED_ERROR =
  "Wallet status refresh failed for every targeted attendee. Check the wallet provider's status, then try again.";

export type DrainWalletRefreshStatusJobsResult = {
  claimed: number;
  succeeded: number;
  failed: number;
  reclaimed: number;
};

/** Every wallet_refresh_status job is event-wide by construction - no operator-bounded selection
 * to carry, unlike wallet_push's attendee_ids kind. */
type WalletRefreshStatusRequest = { eventId: string };

type ClaimedWalletRefreshStatusJob = NonNullable<Awaited<ReturnType<typeof claimNextAdminJob>>>;

function readRequest(job: { result_json: unknown }): WalletRefreshStatusRequest | null {
  if (!job.result_json || typeof job.result_json !== "object" || Array.isArray(job.result_json)) {
    return null;
  }
  const raw = job.result_json as Record<string, unknown>;
  const request = raw.request;
  if (!request || typeof request !== "object" || Array.isArray(request)) return null;
  const req = request as Record<string, unknown>;
  if (typeof req.eventId !== "string" || !req.eventId) return null;
  return { eventId: req.eventId };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Every wallet pass under the event with a known device-registration id - includes a voided
 * pass (unlike wallet_push's event-wide target query, which excludes them): voiding only flips
 * PassCreator's own `voided` flag, it doesn't unregister the device, so a voided pass can still
 * be genuinely registered - same reasoning packages/wallet/src/registration-sync.ts's own
 * periodic sync already applies. */
async function loadEventWideRefreshTargets(
  db: PrismaClient,
  eventId: string,
): Promise<{ attendeeId: string; providerPassId: string; userProvidedId: string }[]> {
  const rows = await db.walletPass.findMany({
    where: {
      status: { in: ["active", "voided"] },
      provider_pass_id: { not: null },
      user_provided_id: { not: null },
      attendee: { event_id: eventId },
    },
    select: { attendee_id: true, provider_pass_id: true, user_provided_id: true },
  });
  return rows.map((row) => ({
    attendeeId: row.attendee_id,
    providerPassId: row.provider_pass_id!,
    userProvidedId: row.user_provided_id!,
  }));
}

/** Maps the two deliberately-thrown internal signals in runOneWalletRefreshStatusJob below to
 * their operator-facing copy, and everything else (an unexpected database, crypto, or provider
 * exception) to one generic fixed message - AdminJob.error is read verbatim by the polling UI, so
 * it must never carry raw exception text (AGENTS.md's "Admin API errors in the UI" convention,
 * same as wallet_push's/wallet_message's own drains). The real error is still logged
 * server-side. */
function walletRefreshStatusJobErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    if (err.message === "wallet_refresh_status_job_bad_request") return WALLET_REFRESH_STATUS_JOB_BAD_REQUEST_ERROR;
    if (err.message === "wallet_not_configured") return WALLET_REFRESH_STATUS_JOB_NOT_CONFIGURED_ERROR;
  }
  return WALLET_REFRESH_STATUS_JOB_GENERIC_ERROR;
}

async function markWalletRefreshStatusJobFailed(db: PrismaClient, jobId: string, err: unknown): Promise<void> {
  emitSystemLog("wallet", "error", "wallet_refresh_status_job_failed", {
    job_id: jobId,
    error: err instanceof Error ? err.message : String(err),
  });
  await db.adminJob.update({
    where: { id: jobId },
    data: {
      status: "failed",
      finished_at: new Date(),
      error: walletRefreshStatusJobErrorMessage(err),
    },
  });
}

/** Writes the job's terminal state once the per-target loop is done - split out to keep
 * runOneWalletRefreshStatusJob's own cognitive complexity down, same reasoning as wallet_push's
 * own finalizeWalletPushJob. */
async function finalizeWalletRefreshStatusJob(
  db: PrismaClient,
  job: ClaimedWalletRefreshStatusJob,
  request: WalletRefreshStatusRequest,
  targetCount: number,
  tally: { refreshed: number; skipped: number; errored: number },
): Promise<"succeeded" | "failed"> {
  const { refreshed, skipped, errored } = tally;

  if (errored > 0) {
    // An event-wide refresh has no operator watching a toast for it (unlike an in-session
    // "Refresh status" click), so this is the only signal ops has that some targets failed.
    emitSystemLog("wallet", "error", "wallet_refresh_status_job_had_errors", {
      job_id: job.id,
      event_id: request.eventId,
      refreshed,
      skipped,
      errored,
    });
  }

  if (targetCount > 0 && errored === targetCount) {
    await db.adminJob.update({
      where: { id: job.id },
      data: {
        status: "failed",
        finished_at: new Date(),
        result_json: { request, refreshed, skipped, errored },
        error: WALLET_REFRESH_STATUS_JOB_ALL_FAILED_ERROR,
      },
    });
    return "failed";
  }

  await db.adminJob.update({
    where: { id: job.id },
    data: {
      status: "succeeded",
      finished_at: new Date(),
      result_json: { request, refreshed, skipped, errored },
      error: null,
    },
  });
  return "succeeded";
}

async function runOneWalletRefreshStatusJob(
  db: PrismaClient,
  job: ClaimedWalletRefreshStatusJob,
): Promise<"succeeded" | "failed"> {
  try {
    const request = readRequest(job);
    if (!request) throw new Error("wallet_refresh_status_job_bad_request");
    const eventId = request.eventId;

    const provider = await resolveEventWalletProvider(db, eventId);
    if (!provider) throw new Error("wallet_not_configured");

    const targets = await loadEventWideRefreshTargets(db, eventId);

    await db.adminJob.update({
      where: { id: job.id },
      data: { progress_total: targets.length, progress_done: 0 },
    });

    let refreshed = 0;
    let skipped = 0;
    let errored = 0;
    let done = 0;

    for (const batch of chunk(targets, WALLET_REFRESH_STATUS_CONCURRENCY)) {
      const settled = await Promise.allSettled(
        batch.map((target) => refreshOneWalletPassStatus(db, target, provider)),
      );
      for (const outcome of settled) {
        if (outcome.status === "rejected") errored += 1;
        else if (outcome.value === "refreshed") refreshed += 1;
        else skipped += 1;
      }
      done += batch.length;
      await db.adminJob.update({ where: { id: job.id }, data: { progress_done: done } });
    }

    return await finalizeWalletRefreshStatusJob(db, job, request, targets.length, { refreshed, skipped, errored });
  } catch (err) {
    await markWalletRefreshStatusJobFailed(db, job.id, err);
    return "failed";
  }
}

export function parseWalletRefreshStatusJobStaleRunningMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.WALLET_REFRESH_STATUS_JOB_STALE_RUNNING_MS?.trim();
  if (!raw) return DEFAULT_WALLET_REFRESH_STATUS_JOB_STALE_RUNNING_MS;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_WALLET_REFRESH_STATUS_JOB_STALE_RUNNING_MS;
  return n;
}

export async function reclaimStaleWalletRefreshStatusJobs(
  db: PrismaClient,
  options: { olderThanMs?: number; heartbeatStaleMs?: number; now?: Date } = {},
): Promise<{ reclaimed: number }> {
  return reclaimStaleAdminJobsByType(
    db,
    "wallet_refresh_status",
    { running: STALE_WALLET_REFRESH_STATUS_JOB_ERROR, pending: STALE_WALLET_REFRESH_STATUS_PENDING_ERROR },
    DEFAULT_WALLET_REFRESH_STATUS_JOB_STALE_RUNNING_MS,
    options,
  );
}

export async function drainWalletRefreshStatusJobs(
  db: PrismaClient,
  options: { limit?: number; staleRunningMs?: number; heartbeatStaleMs?: number } = {},
): Promise<DrainWalletRefreshStatusJobsResult> {
  const limit = options.limit && options.limit > 0 ? Math.floor(options.limit) : 1;
  const staleRunningMs = options.staleRunningMs ?? parseWalletRefreshStatusJobStaleRunningMs();
  const { reclaimed } = await reclaimStaleWalletRefreshStatusJobs(db, {
    olderThanMs: staleRunningMs,
    heartbeatStaleMs: options.heartbeatStaleMs,
  });

  let claimed = 0;
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < limit; i += 1) {
    const job = await claimNextAdminJob(db, "wallet_refresh_status");
    if (!job) break;
    claimed += 1;
    const outcome = await runOneWalletRefreshStatusJob(db, job);
    if (outcome === "succeeded") succeeded += 1;
    else failed += 1;
  }

  return { claimed, succeeded, failed, reclaimed };
}
