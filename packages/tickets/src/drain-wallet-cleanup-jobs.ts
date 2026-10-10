/**
 * Claim and run pending event-wide wallet clean-up AdminJobs (`wallet_void_active`,
 * `wallet_remove_inactive`): the same action for every pass of one event that the Attendees
 * selection routes cap at WALLET_BULK_SEND_LIMIT (100) - void all active passes, or remove all
 * inactive ones at the provider while keeping their local row and Reports history. One drain for
 * every clean-up type, each with its own handler, so a new clean-up action is one more entry in
 * HANDLERS rather than another copy of this claim/progress/finalize/reclaim scaffolding (the shape
 * wallet_refresh_status already has).
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
import { removeOneWalletPassFromProvider } from "./remove-wallet-pass-from-provider.js";
import { resolveEventWalletProvider } from "./resolve-event-wallet-provider.js";
import { voidOneWalletPassAtProvider } from "./void-wallet-pass-at-provider.js";

/** Same 30-minute budget as wallet_push - a large clean-up is expected to take a while, bounded by
 * PassCreator's own rate limit, not a sign the worker died. */
export const DEFAULT_WALLET_CLEANUP_JOB_STALE_RUNNING_MS = 30 * 60 * 1000;

export const WALLET_CLEANUP_CONCURRENCY = 8;

/** How long an inactive pass sits before "Remove inactive passes" is allowed to remove it at the
 * provider - a safety margin against removing (irreversible there) something an admin might still
 * restore, per the plan's own "Remove" grace rule. Counted from `voided_at` for a voided pass, or
 * `expires_at` for an expired one (plan v4.2 step 6 - the canonical `expires_at` column) - a pass
 * with neither reference point set does not qualify for this job (Remove from provider on one
 * attendee, or the bulk selection action, still works on it directly). */
export const WALLET_REMOVE_INACTIVE_GRACE_MS = 24 * 60 * 60 * 1000;

export const WALLET_CLEANUP_JOB_TYPES = ["wallet_void_active", "wallet_remove_inactive"] as const;
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
  /** Optional: how many passes this handler would ALSO act on if not for some extra condition it
   * gates on (only wallet_remove_inactive has one, its grace period) - surfaced in the job result
   * so a run that finds nothing to do can be told apart from a run where something is waiting on
   * that condition (PO report: the toast read the same either way, so an admin who ran "Remove
   * inactive passes" right after a wave of webhook-reported voids saw "nothing to remove" and
   * assumed the action had silently failed, with no way to tell it apart from there genuinely
   * being nothing voided/expired at all). */
  countPending?(this: void, db: PrismaClient, eventId: string): Promise<number>;
};

/** The fields every clean-up target-loading query reads, and how the row maps to a
 * WalletCleanupTarget - shared so the type-specific queries below differ only in their `where`. */
const WALLET_CLEANUP_TARGET_SELECT = {
  attendee_id: true,
  provider_pass_id: true,
  user_provided_id: true,
  status: true,
  provider_commanded_at: true,
  provider_removed_at: true,
} as const;

function mapRowToWalletCleanupTarget(row: {
  attendee_id: string;
  provider_pass_id: string | null;
  user_provided_id: string | null;
  status: string;
  provider_commanded_at: Date | null;
  provider_removed_at: Date | null;
}): WalletCleanupTarget {
  return {
    attendeeId: row.attendee_id,
    providerPassId: row.provider_pass_id!,
    userProvidedId: row.user_provided_id,
    status: row.status,
    providerCommandedAt: row.provider_commanded_at,
    providerRemovedAt: row.provider_removed_at,
  };
}

/** Every active pass under the event that still exists at the provider. */
async function loadActivePassTargets(db: PrismaClient, eventId: string): Promise<WalletCleanupTarget[]> {
  const rows = await db.walletPass.findMany({
    where: {
      status: "active",
      provider_pass_id: { not: null },
      provider_removed_at: null,
      // An erased attendee's pass is deleted, not voided: it is the erasure's to remove.
      attendee: { event_id: eventId, erased_at: null },
    },
    select: WALLET_CLEANUP_TARGET_SELECT,
  });
  return rows.map(mapRowToWalletCleanupTarget);
}

/** Every voided or expired pass under the event, past its own grace period (see
 * WALLET_REMOVE_INACTIVE_GRACE_MS), that still exists at the provider. */
async function loadGracedInactivePassTargets(db: PrismaClient, eventId: string): Promise<WalletCleanupTarget[]> {
  const cutoff = new Date(Date.now() - WALLET_REMOVE_INACTIVE_GRACE_MS);
  const rows = await db.walletPass.findMany({
    where: {
      OR: [
        { status: "voided", voided_at: { lte: cutoff } },
        { status: "expired", expires_at: { lte: cutoff } },
      ],
      provider_pass_id: { not: null },
      provider_removed_at: null,
      attendee: { event_id: eventId },
    },
    select: WALLET_CLEANUP_TARGET_SELECT,
  });
  return rows.map(mapRowToWalletCleanupTarget);
}

/** Complement of loadGracedInactivePassTargets's own WHERE: every voided or expired pass under
 * the event, still managed at the provider, that has NOT yet passed its own grace period - see
 * that function's doc comment and WALLET_REMOVE_INACTIVE_GRACE_MS for the exact rule. Read by
 * runOneWalletCleanupJob below and surfaced as the job's own `pendingGraceCount`. A pass with
 * neither reference point set (voided with no voided_at, expired with no expires_at) is
 * intentionally NOT counted here either - it is not "waiting", it will never qualify for this
 * job regardless of how long it sits, so counting it here would wrongly suggest it just needs
 * more time. Exported so the Wallets report (apps/web/src/admin/reports-routes.ts) can call this
 * same, unbounded-by-construction count for its own `pending_removal` field instead of deriving
 * it from the report's own WALLET_AGGREGATE_MAX-capped pass sample - that sample is fine for
 * percentages and breakdowns, which stay proportionally right even truncated, but wrong for a
 * plain count that must agree exactly with what this job itself will find (bot review). */
export function countPendingGraceInactivePasses(db: PrismaClient, eventId: string): Promise<number> {
  const cutoff = new Date(Date.now() - WALLET_REMOVE_INACTIVE_GRACE_MS);
  return db.walletPass.count({
    where: {
      OR: [
        { status: "voided", voided_at: { gt: cutoff } },
        { status: "expired", expires_at: { gt: cutoff } },
      ],
      provider_pass_id: { not: null },
      provider_removed_at: null,
      attendee: { event_id: eventId },
    },
  });
}

/** Removes one pass listed by loadGracedInactivePassTargets - re-read right before acting, the
 * same reasoning as voidOneWalletPassAtProvider's own re-read: this job can reach a given pass
 * minutes after listing it, and an admin may have restored the pass (back to `active`, nothing to
 * remove) or already removed it directly in the meantime. `removeOneWalletPassFromProvider` itself
 * has no status guard - it only checks `provider_removed_at` - so skipping here on a pass that is
 * no longer voided or expired is what keeps a restored pass from being deleted at the provider out
 * from under the admin who just restored it.
 *
 * A restore-then-void in that same window leaves the pass `voided` again, so the status check
 * alone would not catch it - but it also gives the pass a brand new `voided_at`, so the grace
 * period this job promises ("only touches a pass inactive for at least a day") no longer applies
 * to it. The re-read checks the anchor for the pass's current status - `voided_at` for voided,
 * `expires_at` for expired - against the same cutoff loadGracedInactivePassTargets used, not just
 * status, so a freshly re-voided pass is left for a later run instead of being removed before its
 * own new grace period has elapsed. `expired` has no such re-triggering path (it is terminal -
 * Restore is blocked once `expires_at <= now()`), so its own re-check exists for the same
 * defense-in-depth reason as the status check itself: acting on a fresh read, not the one from
 * listing time. */
async function removeOneGracedInactivePass(
  db: PrismaClient,
  eventId: string,
  target: WalletCleanupTarget,
  provider: WalletPassProvider,
  audit: OpsAuditContext,
): Promise<"done" | "skipped"> {
  const current = await db.walletPass.findFirst({
    where: { attendee_id: target.attendeeId, provider_pass_id: target.providerPassId },
    select: {
      status: true,
      voided_at: true,
      expires_at: true,
      provider_removed_at: true,
      provider_commanded_at: true,
      user_provided_id: true,
    },
  });
  if (!current || current.provider_removed_at) return "skipped";
  if (current.status !== "voided" && current.status !== "expired") return "skipped";
  const cutoff = Date.now() - WALLET_REMOVE_INACTIVE_GRACE_MS;
  if (current.status === "voided" && (!current.voided_at || current.voided_at.getTime() > cutoff)) {
    return "skipped";
  }
  if (current.status === "expired" && (!current.expires_at || current.expires_at.getTime() > cutoff)) {
    return "skipped";
  }

  const outcome = await removeOneWalletPassFromProvider(
    db,
    eventId,
    {
      attendeeId: target.attendeeId,
      providerPassId: target.providerPassId,
      userProvidedId: current.user_provided_id,
      status: current.status,
      providerCommandedAt: current.provider_commanded_at,
      providerRemovedAt: current.provider_removed_at,
    },
    provider,
    audit,
    { eventWide: true },
  );
  return outcome === "removed" ? "done" : "skipped";
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
  wallet_remove_inactive: {
    loadTargets: loadGracedInactivePassTargets,
    act: removeOneGracedInactivePass,
    countPending: countPendingGraceInactivePasses,
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
  pendingGraceCount: number | null,
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
      result_json: { request, done, skipped, errored, pendingGraceCount },
      error: allFailed ? WALLET_CLEANUP_JOB_ALL_FAILED_ERROR : null,
    },
  });
  if (count === 0) return "failed";
  return allFailed ? "failed" : "succeeded";
}

/** Runs a handler's optional countPending outside the risk of failing the whole job: it is a
 * best-effort, purely informational number (see WalletCleanupHandler.countPending's own doc
 * comment), read AFTER the per-target loop above has already done its real, often irreversible
 * work (voiding or removing passes at the provider). If this count itself throws (a DB timeout,
 * say), letting that propagate to runOneWalletCleanupJob's own outer catch would mark the whole
 * job failed - discarding done/skipped/errored and telling the admin "did not run" - even though
 * the actual cleanup already succeeded, which could send them to retry an action that already
 * happened (bot review). Falls back to null, the same "no info available" state already used for
 * wallet_void_active (which has no countPending at all), and logs the real error server-side. */
async function safeCountPending(
  db: PrismaClient,
  job: ClaimedWalletCleanupJob,
  eventId: string,
  countPending: NonNullable<WalletCleanupHandler["countPending"]>,
): Promise<number | null> {
  try {
    return await countPending(db, eventId);
  } catch (err) {
    emitSystemLog("wallet", "warn", "wallet_cleanup_pending_count_failed", {
      job_id: job.id,
      job_type: job.type,
      event_id: eventId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
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
      const settled = await Promise.allSettled( // NOSONAR - batches are sequential on purpose: WALLET_CLEANUP_CONCURRENCY bounds the provider load
        batch.map((target) => handler.act(db, eventId, target, provider, audit)),
      );
      for (const outcome of settled) {
        if (outcome.status === "rejected") errored += 1;
        else if (outcome.value === "done") done += 1;
        else skipped += 1;
      }
      processed += batch.length;
      await db.adminJob.update({ where: { id: job.id }, data: { progress_done: processed } }); // NOSONAR - progress is written after each batch, in order
    }

    const pendingGraceCount = handler.countPending
      ? await safeCountPending(db, job, eventId, handler.countPending)
      : null;
    return await finalizeWalletCleanupJob(
      db,
      job,
      request,
      targets.length,
      { done, skipped, errored },
      pendingGraceCount,
    );
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
    const result = await reclaimStaleAdminJobsByType( // NOSONAR - one job type at a time, so reclaim counts and errors stay attributable
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

/** Claims and runs up to `limit` jobs of EACH clean-up type, oldest pending first within a type.
 * `limit` is a per-type budget, not shared across types - the worker always calls this with
 * `limit: 1`, so a per-type budget is what gives every job type a turn on a given tick. A single
 * shared counter would let a steady trickle of one type (e.g. wallet_void_active) claim the whole
 * budget every tick and starve the other type indefinitely, since claimNextAdminJob for the
 * starved type would never even be called. */
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
    let claimedForType = 0;
    while (claimedForType < limit) {
      const job = await claimNextAdminJob(db, type);
      if (!job) break;
      claimedForType += 1;
      const outcome = await runOneWalletCleanupJob(db, job, handler); // NOSONAR - jobs of a type must run one after another; each claim depends on the previous finishing
      if (outcome === "succeeded") succeeded += 1;
      else failed += 1;
    }
    claimed += claimedForType;
  }

  return { claimed, succeeded, failed, reclaimed };
}
