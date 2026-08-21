/**
 * Claim and run pending AdminJob type=wallet_message - sends one operator-composed message to
 * every target attendee's already-installed wallet pass, via sendWalletMessage. Unlike
 * wallet_push (which chunks many per-attendee PATCH calls at low concurrency), this job issues
 * one PassCreator bulk call per WALLET_MESSAGE_BULK_BATCH_SIZE-sized batch of recipients - the
 * bulk endpoint itself accepts many identifiers per request, so there is no per-attendee
 * concurrency to manage here.
 */
import type { PrismaClient } from "@admitto/db";
import { emitSystemLog } from "@admitto/shared/system-log";
import { claimNextAdminJob } from "./claim-admin-job.js";
import { reclaimStaleAdminJobsByType } from "./reclaim-stale-admin-jobs-by-type.js";
import { resolveEventWalletProvider } from "./resolve-event-wallet-provider.js";
import { loadWalletMessageTargets, sendWalletMessage } from "./send-wallet-message.js";

/** Same 30-minute budget as wallet_push - a large send is expected to take a while, bounded by
 * PassCreator's own rate limit, not a sign the worker died. */
export const DEFAULT_WALLET_MESSAGE_JOB_STALE_RUNNING_MS = 30 * 60 * 1000;

export const STALE_WALLET_MESSAGE_JOB_ERROR =
  "Wallet message job abandoned (worker stopped while running). Start it again.";
export const STALE_WALLET_MESSAGE_PENDING_ERROR =
  "Wallet message job was never picked up by the worker. Start the worker and try again.";
export const WALLET_MESSAGE_JOB_BAD_REQUEST_ERROR = "Wallet message job has an invalid request payload.";
export const WALLET_MESSAGE_JOB_NOT_CONFIGURED_ERROR = "Wallet is not configured for this event.";
export const WALLET_MESSAGE_JOB_GENERIC_ERROR =
  "Wallet message send failed unexpectedly. Contact support if this continues.";

export type DrainWalletMessageJobsResult = {
  claimed: number;
  succeeded: number;
  failed: number;
  reclaimed: number;
};

type WalletMessageRequest = {
  eventId: string;
  attendeeIds: string[];
  text: string;
};

type ClaimedWalletMessageJob = NonNullable<Awaited<ReturnType<typeof claimNextAdminJob>>>;

function readRequest(job: { result_json: unknown }): WalletMessageRequest | null {
  if (!job.result_json || typeof job.result_json !== "object" || Array.isArray(job.result_json)) {
    return null;
  }
  const raw = job.result_json as Record<string, unknown>;
  const request = raw.request;
  if (!request || typeof request !== "object" || Array.isArray(request)) return null;
  const req = request as Record<string, unknown>;
  if (typeof req.eventId !== "string" || !req.eventId) return null;
  if (!Array.isArray(req.attendeeIds) || !req.attendeeIds.every((id) => typeof id === "string")) return null;
  if (typeof req.text !== "string" || !req.text.trim()) return null;
  return { eventId: req.eventId, attendeeIds: req.attendeeIds as string[], text: req.text };
}

/** Maps the two deliberately-thrown internal signals in runOneWalletMessageJob below to their
 * operator-facing copy, and everything else (an unexpected database, crypto, or provider
 * exception) to one generic fixed message - AdminJob.error is read verbatim by the polling UI,
 * so it must never carry raw exception text (AGENTS.md's "Admin API errors in the UI" convention,
 * applied here at the point the message is stored, same as wallet_push's own drain). The real
 * error is still logged server-side. */
function walletMessageJobErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    if (err.message === "wallet_message_job_bad_request") return WALLET_MESSAGE_JOB_BAD_REQUEST_ERROR;
    if (err.message === "wallet_not_configured") return WALLET_MESSAGE_JOB_NOT_CONFIGURED_ERROR;
  }
  return WALLET_MESSAGE_JOB_GENERIC_ERROR;
}

async function markWalletMessageFailed(db: PrismaClient, jobId: string, err: unknown): Promise<void> {
  emitSystemLog("wallet", "error", "wallet_message_job_failed", {
    job_id: jobId,
    error: err instanceof Error ? err.message : String(err),
  });
  await db.adminJob.update({
    where: { id: jobId },
    data: {
      status: "failed",
      finished_at: new Date(),
      error: walletMessageJobErrorMessage(err),
    },
  });
}

async function runOneWalletMessageJob(
  db: PrismaClient,
  job: ClaimedWalletMessageJob,
): Promise<"succeeded" | "failed"> {
  try {
    const request = readRequest(job);
    if (!request) throw new Error("wallet_message_job_bad_request");
    const eventId = request.eventId;

    const provider = await resolveEventWalletProvider(db, eventId);
    if (!provider) throw new Error("wallet_not_configured");

    const targets = await loadWalletMessageTargets(db, eventId, request.attendeeIds);
    const skipped = request.attendeeIds.length - targets.length;

    // Denominator is the full selection, not just targets.length - keeps progress_total and the
    // final result_json counts (sent+skipped) referring to the same set (same reasoning as
    // wallet_push's own progress accounting).
    await db.adminJob.update({
      where: { id: job.id },
      data: { progress_total: request.attendeeIds.length, progress_done: skipped },
    });

    // A batch failure (e.g. PassCreator outage partway through a large send) counts toward
    // `errored` below rather than throwing - the job still reports "succeeded" with an accurate
    // sent/errored split, same as wallet_push treating a per-target failure as non-fatal. Letting
    // it throw here would mark the whole job "failed" with no record of which batches already
    // went out, and an operator retrying the same selection would re-message everyone already
    // reached by an earlier, successful batch.
    const { sent, errored, erroredAttendeeIds } = await sendWalletMessage(
      provider,
      targets,
      request.text,
      async (doneCount) => {
        await db.adminJob.update({ where: { id: job.id }, data: { progress_done: skipped + doneCount } });
      },
    );

    await db.adminJob.update({
      where: { id: job.id },
      data: {
        status: "succeeded",
        finished_at: new Date(),
        progress_done: request.attendeeIds.length,
        result_json: {
          request: { eventId: request.eventId, attendeeIds: request.attendeeIds, text: request.text },
          sent,
          skipped,
          errored,
          erroredAttendeeIds,
        },
        error: null,
      },
    });
    return "succeeded";
  } catch (err) {
    await markWalletMessageFailed(db, job.id, err);
    return "failed";
  }
}

export function parseWalletMessageJobStaleRunningMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.WALLET_MESSAGE_JOB_STALE_RUNNING_MS?.trim();
  if (!raw) return DEFAULT_WALLET_MESSAGE_JOB_STALE_RUNNING_MS;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_WALLET_MESSAGE_JOB_STALE_RUNNING_MS;
  return n;
}

export async function reclaimStaleWalletMessageJobs(
  db: PrismaClient,
  options: { olderThanMs?: number; heartbeatStaleMs?: number; now?: Date } = {},
): Promise<{ reclaimed: number }> {
  return reclaimStaleAdminJobsByType(
    db,
    "wallet_message",
    { running: STALE_WALLET_MESSAGE_JOB_ERROR, pending: STALE_WALLET_MESSAGE_PENDING_ERROR },
    DEFAULT_WALLET_MESSAGE_JOB_STALE_RUNNING_MS,
    options,
  );
}

export async function drainWalletMessageJobs(
  db: PrismaClient,
  options: { limit?: number; staleRunningMs?: number; heartbeatStaleMs?: number } = {},
): Promise<DrainWalletMessageJobsResult> {
  const limit = options.limit && options.limit > 0 ? Math.floor(options.limit) : 1;
  const staleRunningMs = options.staleRunningMs ?? parseWalletMessageJobStaleRunningMs();
  const { reclaimed } = await reclaimStaleWalletMessageJobs(db, {
    olderThanMs: staleRunningMs,
    heartbeatStaleMs: options.heartbeatStaleMs,
  });

  let claimed = 0;
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < limit; i += 1) {
    const job = await claimNextAdminJob(db, "wallet_message");
    if (!job) break;
    claimed += 1;
    const outcome = await runOneWalletMessageJob(db, job);
    if (outcome === "succeeded") succeeded += 1;
    else failed += 1;
  }

  return { claimed, succeeded, failed, reclaimed };
}
