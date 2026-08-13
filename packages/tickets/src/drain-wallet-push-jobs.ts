/**
 * Claim and run pending AdminJob type=wallet_push - rebuilds each target attendee's already-
 * issued wallet pass from their current data (name/ticket type/event details), via the same
 * reissueOneWalletPass used by the single-attendee and bulk "Push updates" actions. Chunked at a
 * low concurrency (ADR 0041 §3: PassCreator's own limit is 600 req/min, "keep client concurrency
 * low (~8)") - a large push can genuinely take minutes regardless of how this is implemented,
 * that's PassCreator's own rate limit, not something to optimize away.
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
import { reissueOneWalletPass } from "./reissue-wallet-pass.js";
import type { OpsAuditContext } from "./ops-audit.js";

/** Longer than import/export's 15 min - a large push is expected to run for many minutes,
 * bounded by PassCreator's own rate limit, not a sign the worker died. */
export const DEFAULT_WALLET_PUSH_JOB_STALE_RUNNING_MS = 30 * 60 * 1000;

export const WALLET_PUSH_CONCURRENCY = 8;

export const STALE_WALLET_PUSH_JOB_ERROR =
  "Wallet push job abandoned (worker stopped while running). Start it again.";
export const STALE_WALLET_PUSH_PENDING_ERROR =
  "Wallet push job was never picked up by the worker. Start the worker and try again.";

export type DrainWalletPushJobsResult = {
  claimed: number;
  succeeded: number;
  failed: number;
  reclaimed: number;
};

/** `kind: "attendee_ids"` is the only request shape so far (an operator-bounded selection, e.g.
 * bulk ticket-type change) - an `"event_wide"` kind (every active pass under an event, for
 * date/location changes with no selection cap) is a deliberate follow-up, not built yet. */
type WalletPushRequest = {
  kind: "attendee_ids";
  eventId: string;
  attendeeIds: string[];
};

type ClaimedWalletPushJob = NonNullable<Awaited<ReturnType<typeof claimNextAdminJob>>>;

function readRequest(job: { result_json: unknown }): WalletPushRequest | null {
  if (!job.result_json || typeof job.result_json !== "object" || Array.isArray(job.result_json)) {
    return null;
  }
  const raw = job.result_json as Record<string, unknown>;
  const request = raw.request;
  if (!request || typeof request !== "object" || Array.isArray(request)) return null;
  const req = request as Record<string, unknown>;
  if (req.kind !== "attendee_ids") return null;
  if (typeof req.eventId !== "string" || !req.eventId) return null;
  if (!Array.isArray(req.attendeeIds) || !req.attendeeIds.every((id) => typeof id === "string")) return null;
  return { kind: "attendee_ids", eventId: req.eventId, attendeeIds: req.attendeeIds as string[] };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
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

async function loadTargets(
  db: PrismaClient,
  eventId: string,
  attendeeIds: string[],
): Promise<{ attendeeId: string; providerPassId: string }[]> {
  const rows = await db.walletPass.findMany({
    where: {
      attendee_id: { in: attendeeIds },
      provider_pass_id: { not: null },
      attendee: { event_id: eventId },
    },
    select: { attendee_id: true, provider_pass_id: true },
  });
  return rows.map((row) => ({ attendeeId: row.attendee_id, providerPassId: row.provider_pass_id! }));
}

async function markWalletPushFailed(db: PrismaClient, jobId: string, err: unknown): Promise<void> {
  await db.adminJob.update({
    where: { id: jobId },
    data: {
      status: "failed",
      finished_at: new Date(),
      error: (err instanceof Error ? err.message : String(err)).slice(0, 2000),
    },
  });
}

async function runOneWalletPushJob(db: PrismaClient, job: ClaimedWalletPushJob): Promise<"succeeded" | "failed"> {
  try {
    const request = readRequest(job);
    if (!request) throw new Error("wallet_push_job_bad_request");
    const eventId = request.eventId;

    const provider = await resolveEventWalletProvider(db, eventId);
    if (!provider) throw new Error("wallet_not_configured");

    const targets = await loadTargets(db, eventId, request.attendeeIds);
    const skippedNoPass = request.attendeeIds.length - targets.length;

    await db.adminJob.update({
      where: { id: job.id },
      data: { progress_total: targets.length, progress_done: 0 },
    });

    const audit: OpsAuditContext = {
      operator: job.actor_user_id ?? undefined,
      sessionId: job.session_id ?? undefined,
      timezone: job.client_timezone ?? undefined,
    };

    let reissued = 0;
    let skipped = skippedNoPass;
    let errored = 0;
    let done = 0;

    for (const batch of chunk(targets, WALLET_PUSH_CONCURRENCY)) {
      const settled = await Promise.allSettled(
        batch.map((target) => reissueOneWalletPass(db, eventId, target, provider, audit)),
      );
      for (const outcome of settled) {
        if (outcome.status === "rejected") errored += 1;
        else if (outcome.value === "reissued") reissued += 1;
        else skipped += 1;
      }
      done += batch.length;
      await db.adminJob.update({ where: { id: job.id }, data: { progress_done: done } });
    }

    await db.adminJob.update({
      where: { id: job.id },
      data: {
        status: "succeeded",
        finished_at: new Date(),
        result_json: {
          request: { kind: request.kind, eventId: request.eventId, attendeeIds: request.attendeeIds },
          reissued,
          skipped,
          errored,
        },
        error: null,
      },
    });
    return "succeeded";
  } catch (err) {
    await markWalletPushFailed(db, job.id, err);
    return "failed";
  }
}

export function parseWalletPushJobStaleRunningMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.WALLET_PUSH_JOB_STALE_RUNNING_MS?.trim();
  if (!raw) return DEFAULT_WALLET_PUSH_JOB_STALE_RUNNING_MS;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_WALLET_PUSH_JOB_STALE_RUNNING_MS;
  return n;
}

export async function reclaimStaleWalletPushJobs(
  db: PrismaClient,
  options: { olderThanMs?: number; heartbeatStaleMs?: number; now?: Date } = {},
): Promise<{ reclaimed: number }> {
  const olderThanMs = positiveMsOr(options.olderThanMs, DEFAULT_WALLET_PUSH_JOB_STALE_RUNNING_MS);
  const heartbeatStaleMs = positiveMsOr(options.heartbeatStaleMs, DEFAULT_WORKER_HEARTBEAT_STALE_MS);
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - olderThanMs);
  const reclaimPending = await isWorkerHeartbeatStale(db, now, heartbeatStaleMs);

  const stale = await db.adminJob.findMany({
    where: { type: "wallet_push", OR: staleAdminJobOrClauses(cutoff, reclaimPending) },
    select: { id: true, status: true },
    orderBy: { created_at: "asc" },
  });

  let reclaimed = 0;
  for (const job of stale) {
    const error = job.status === "pending" ? STALE_WALLET_PUSH_PENDING_ERROR : STALE_WALLET_PUSH_JOB_ERROR;
    const updated = await db.adminJob.updateMany({
      where: { id: job.id, status: job.status },
      data: { status: "failed", error, finished_at: now },
    });
    if (updated.count > 0) reclaimed += 1;
  }
  return { reclaimed };
}

export async function drainWalletPushJobs(
  db: PrismaClient,
  options: { limit?: number; staleRunningMs?: number; heartbeatStaleMs?: number } = {},
): Promise<DrainWalletPushJobsResult> {
  const limit = options.limit && options.limit > 0 ? Math.floor(options.limit) : 1;
  const staleRunningMs = options.staleRunningMs ?? parseWalletPushJobStaleRunningMs();
  const { reclaimed } = await reclaimStaleWalletPushJobs(db, {
    olderThanMs: staleRunningMs,
    heartbeatStaleMs: options.heartbeatStaleMs,
  });

  let claimed = 0;
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < limit; i += 1) {
    const job = await claimNextAdminJob(db, "wallet_push");
    if (!job) break;
    claimed += 1;
    const outcome = await runOneWalletPushJob(db, job);
    if (outcome === "succeeded") succeeded += 1;
    else failed += 1;
  }

  return { claimed, succeeded, failed, reclaimed };
}
