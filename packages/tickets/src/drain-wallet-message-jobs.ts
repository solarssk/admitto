/**
 * Claim and run pending AdminJob type=wallet_message - sends one operator-composed message to
 * every target attendee's already-installed wallet pass, via sendWalletMessage. Unlike
 * wallet_push (which chunks many per-attendee PATCH calls at low concurrency), this job issues
 * one PassCreator bulk call per WALLET_MESSAGE_BULK_BATCH_SIZE-sized batch of recipients - the
 * bulk endpoint itself accepts many identifiers per request, so there is no per-attendee
 * concurrency to manage here.
 */
import type { PrismaClient } from "@admitto/db";
import {
  DEFAULT_WORKER_HEARTBEAT_STALE_MS,
  isWorkerHeartbeatStale,
  positiveMsOr,
  staleAdminJobOrClauses,
} from "@admitto/db";
import { resolveWalletProvider, type WalletPassProvider } from "@admitto/wallet";
import { claimNextAdminJob } from "./claim-admin-job.js";
import { parseWalletFieldMapping } from "./resolve.js";
import { loadWalletMessageTargets, sendWalletMessage } from "./send-wallet-message.js";

/** Same 30-minute budget as wallet_push - a large send is expected to take a while, bounded by
 * PassCreator's own rate limit, not a sign the worker died. */
export const DEFAULT_WALLET_MESSAGE_JOB_STALE_RUNNING_MS = 30 * 60 * 1000;

export const STALE_WALLET_MESSAGE_JOB_ERROR =
  "Wallet message job abandoned (worker stopped while running). Start it again.";
export const STALE_WALLET_MESSAGE_PENDING_ERROR =
  "Wallet message job was never picked up by the worker. Start the worker and try again.";

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

async function resolveEventWalletProvider(db: PrismaClient, eventId: string): Promise<WalletPassProvider | null> {
  const event = await db.event.findUnique({
    where: { id: eventId },
    select: {
      wallet_enabled: true,
      wallet_template_id: true,
      wallet_api_key_enc: true,
      wallet_field_mapping: true,
    },
  });
  if (!event) return null;
  return resolveWalletProvider({
    walletEnabled: event.wallet_enabled,
    walletTemplateId: event.wallet_template_id,
    walletApiKeyEnc: event.wallet_api_key_enc,
    walletFieldMapping: parseWalletFieldMapping(event.wallet_field_mapping),
  });
}

async function markWalletMessageFailed(db: PrismaClient, jobId: string, err: unknown): Promise<void> {
  await db.adminJob.update({
    where: { id: jobId },
    data: {
      status: "failed",
      finished_at: new Date(),
      error: (err instanceof Error ? err.message : String(err)).slice(0, 2000),
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
    const { sent, errored } = await sendWalletMessage(provider, targets, request.text, async (doneCount) => {
      await db.adminJob.update({ where: { id: job.id }, data: { progress_done: skipped + doneCount } });
    });

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
  const olderThanMs = positiveMsOr(options.olderThanMs, DEFAULT_WALLET_MESSAGE_JOB_STALE_RUNNING_MS);
  const heartbeatStaleMs = positiveMsOr(options.heartbeatStaleMs, DEFAULT_WORKER_HEARTBEAT_STALE_MS);
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - olderThanMs);
  const reclaimPending = await isWorkerHeartbeatStale(db, now, heartbeatStaleMs);

  const stale = await db.adminJob.findMany({
    where: { type: "wallet_message", OR: staleAdminJobOrClauses(cutoff, reclaimPending) },
    select: { id: true, status: true },
    orderBy: { created_at: "asc" },
  });

  let reclaimed = 0;
  for (const job of stale) {
    const error = job.status === "pending" ? STALE_WALLET_MESSAGE_PENDING_ERROR : STALE_WALLET_MESSAGE_JOB_ERROR;
    const updated = await db.adminJob.updateMany({
      where: { id: job.id, status: job.status },
      data: { status: "failed", error, finished_at: now },
    });
    if (updated.count > 0) reclaimed += 1;
  }
  return { reclaimed };
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
