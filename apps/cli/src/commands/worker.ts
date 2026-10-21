/**
 * Admitto background worker loop (ADR 0042).
 *
 *   admitto worker
 *
 * Jobs: mail_delivery drain, registration_mail drain, import/export/wallet_push/wallet_message
 * AdminJobs, bounce ingest, wallet_sync, retention.
 */
import { hostname as osHostname } from "node:os";
import type { PrismaClient } from "@admitto/db";
import { emitSystemLog, type SystemLogLevel } from "@admitto/shared/system-log";
import {
  InstanceUrlRequiredError,
  purgeAuthRetention,
  purgeSecurityAuditLog,
  resolveInstanceBaseUrl,
  resolveSecurityAuditLogRetentionDays,
} from "@admitto/auth";
import { purgeNotifications, resolveNotificationRetentionDays } from "@admitto/notifications";
import {
  DEFAULT_MAIL_DRAIN_LIMIT,
  DEFAULT_REGISTRATION_MAIL_DRAIN_LIMIT,
  assertValidBounceIngestTickSecondsEnv,
  drainPendingDeliveries,
  drainRegistrationMails,
  ingestBounces,
  nullifyDeliverySnapshots,
  parseBounceIngestTickSeconds,
  resolveDeliverySnapshotRetentionDays,
  sweepExpiredRegistrations,
  workerHeartbeatStaleMs,
  type SweepExpiredRegistrationsResult,
} from "@admitto/mail-delivery";
import { drainImportJobs } from "@admitto/import";
import { getDefaultStorage } from "@admitto/storage";
import { erasedWalletPassesLeft, sweepErasedWalletPasses } from "../lib/retention-erased-wallet-passes.js";
import { purgeJobFilesForRetention } from "../lib/retention-job-files.js";
import { closeSsePublishClient, publishActivityChanged } from "../lib/sse-publish.js";
import { installSystemLogRelay, uninstallSystemLogRelay } from "../lib/system-log-publish.js";
import { drainExportJobs } from "./export-jobs.js";
import { runWalletRegistrationSync } from "./wallet-sync.js";
import { runWalletExpiry } from "./wallet-expire.js";
import { drainWalletPushJobs } from "./wallet-push-jobs.js";
import { drainWalletCleanupJobs } from "./wallet-cleanup-jobs.js";
import { drainWalletRefreshStatusJobs } from "./wallet-refresh-status-jobs.js";
import { drainWalletMessageJobs } from "./wallet-message-jobs.js";
import { touchWorkerHeartbeat } from "./worker-heartbeat.js";
import { openWorkerLockClient, type WorkerLockClient } from "./worker-locks.js";
import { openWorkerNotifyClient, type WorkerNotifyClient } from "./worker-notify.js";
import {
  createRetentionSchedule,
  markRetentionFailure,
  markRetentionSuccess,
  retentionIsDue,
  type RetentionSchedule,
} from "./worker-retention-schedule.js";

/** Every job runner in this file already calls this on every outcome (ok, idle, skipped, FAILED,
 * a degraded fallback) - routing it through emitSystemLog too, rather than adding a second call
 * at each of those ~25 call sites, is what makes the worker's job-lifecycle activity reach System
 * logs at all (a separate OS process from apps/web - see apps/cli/src/lib/system-log-publish.ts).
 * Level is inferred from the message text rather than threading a new parameter through every
 * call site: the "FAILED " prefix convention (runJobSafely, the retention FAILED branch) maps to
 * "error"; "failed:"/"unavailable" appearing anywhere (heartbeat refresh failures, a notify-client
 * falling back to poll-only) maps to "warn" - both real degraded conditions, just not raised
 * through the FAILED-prefix path. A nonzero `failed=`/`errors=` counter in an otherwise-"ok"
 * summary (e.g. "ok claimed=5 sent=4 failed=1") also maps to "warn" - a drain that caught
 * per-item failures and returned normally must not read as fully successful (bot review).
 * Matches "failed:" (colon) and the counter form separately from bare "failed" - every routine
 * "ok claimed=1 ... failed=0 ..." summary also contains the substring "failed", as a zero count,
 * not a failure. Everything else (ok/idle/skipped/lifecycle banners) is "info". */
export function logLevel(message: string): SystemLogLevel {
  if (message.startsWith("FAILED ")) return "error";
  if (/failed:|unavailable/i.test(message)) return "warn";
  const counter = /\b(?:failed|errors)=(\d+)/.exec(message);
  if (counter && Number(counter[1]) > 0) return "warn";
  return "info";
}

/** Messages that mean "this tick did nothing for this job type" - the overwhelming majority of
 * log() calls in a healthy, mostly-idle worker. Not relayed to System logs (still written to
 * stdout via console.log below): a large backlog can make runWorkerTick loop back-to-back with
 * no sleep between ticks (see the `mightHaveMore` continue in runWorker), and each tick already
 * calls log() up to ~9 times - relaying every idle result too risks bursting past the ops-ingest
 * endpoint's 120/min-per-IP rate limit exactly when a real backlog (the case operators most want
 * visibility into) is being drained (bot review). */
export function isRoutineNoop(message: string): boolean {
  return message === "idle" || message === "skipped (lock held)";
}

function log(job: string, message: string): void {
  const ts = new Date().toISOString();
  console.log(`[worker:${job}] ${ts} ${message}`);
  if (isRoutineNoop(message)) return;
  emitSystemLog("worker", logLevel(message), message, { job });
}

function sleep(ms: number, signal: { stopped: boolean }): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (signal.stopped || Date.now() - started >= ms) {
        clearInterval(timer);
        resolve();
      }
    }, 200);
  });
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function runJobSafely<T>(job: string, run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch (err) {
    log(job, `FAILED ${errMessage(err)}`);
    return fallback;
  }
}

/**
 * Reuses `current` if still alive, otherwise (re)connects. Returns null on failure so the
 * caller can fall back to plain tick-interval polling — the notify client is a pure latency
 * optimization, never a correctness dependency.
 */
export async function ensureNotifyClient(
  databaseUrl: string,
  current: WorkerNotifyClient | null,
): Promise<WorkerNotifyClient | null> {
  if (current?.isAlive()) return current;
  if (current) await current.close().catch(() => undefined);
  try {
    return await openWorkerNotifyClient(databaseUrl);
  } catch (err) {
    log("heartbeat", `notify client unavailable, falling back to poll-only: ${errMessage(err)}`);
    return null;
  }
}

async function resolveWorkerBaseUrl(db: PrismaClient, job = "mail_delivery"): Promise<string | undefined> {
  try {
    return await resolveInstanceBaseUrl(db, process.env);
  } catch (err) {
    if (err instanceof InstanceUrlRequiredError) {
      log(job, "skip drain: instance URL not configured");
      return undefined;
    }
    throw err;
  }
}

/** @returns true when this tick's drain filled its batch limit, so more rows likely remain. */
async function runMailDeliveryJob(db: PrismaClient, locks: WorkerLockClient): Promise<boolean> {
  const acquired = await locks.tryAcquire("mail_delivery");
  if (!acquired) {
    log("mail_delivery", "skipped (lock held)");
    return false;
  }
  try {
    const baseUrl = await resolveWorkerBaseUrl(db);
    if (!baseUrl) return false;
    const result = await drainPendingDeliveries(
      db,
      process.env,
      {},
      { baseUrl, limit: DEFAULT_MAIL_DRAIN_LIMIT },
    );
    if (result.claimed === 0) {
      log("mail_delivery", "idle");
      return false;
    }
    log(
      "mail_delivery",
      `ok claimed=${result.claimed} sent=${result.sent} failed=${result.failed} skipped=${result.skipped}`,
    );
    await publishActivityChanged(result.eventIds);
    return result.claimed >= DEFAULT_MAIL_DRAIN_LIMIT;
  } finally {
    await locks.release("mail_delivery");
  }
}

/**
 * The clean-up of expired registrations, which never stops the sending of registration mail. The two do not depend on
 * each other (a confirmation link is checked when it is opened, swept or not), so a sweep that fails, say behind the
 * lock of a long erasure, is logged by its class and the mail still goes out, instead of stopping the confirmation
 * mail of every event on every tick.
 */
async function sweepExpiredRegistrationsOrLog(db: PrismaClient): Promise<SweepExpiredRegistrationsResult> {
  try {
    return await sweepExpiredRegistrations(db);
  } catch (err) {
    log("registration_mail", `sweep FAILED error_class=${err instanceof Error ? err.name : "unknown"}`);
    return { deleted: 0, eventIds: [], more: false };
  }
}

/**
 * Guest registration mail (D-D1, D-D2): sends what a registration queued, hands `ticket` rows to the usual ticket
 * send, and deletes registrations that were never confirmed within 24 hours (the only automatic deletion of them).
 *
 * The log line holds the counts of the tick and nothing else. An error is logged as its class only: the text of a
 * database or provider error can carry the address of a guest, and the rows record their own failures as fixed
 * categories (packages/mail-delivery/src/registration-mail-reasons.ts).
 *
 * @returns true when the tick filled its batch or its clean-up stopped at its limit, so more likely remains.
 */
async function runRegistrationMailJob(db: PrismaClient, locks: WorkerLockClient): Promise<boolean> {
  const acquired = await locks.tryAcquire("registration_mail");
  if (!acquired) {
    log("registration_mail", "skipped (lock held)");
    return false;
  }
  try {
    const expired = await sweepExpiredRegistrationsOrLog(db);
    const baseUrl = await resolveWorkerBaseUrl(db, "registration_mail");
    const drained = baseUrl
      ? await drainRegistrationMails(db, process.env, {}, { baseUrl, limit: DEFAULT_REGISTRATION_MAIL_DRAIN_LIMIT })
      : { claimed: 0, sent: 0, failed: 0, cancelled: 0, skipped: 0, eventIds: [] };
    if (drained.claimed === 0 && expired.deleted === 0) {
      log("registration_mail", "idle");
      return false;
    }
    log(
      "registration_mail",
      `ok claimed=${drained.claimed} sent=${drained.sent} failed=${drained.failed} cancelled=${drained.cancelled} skipped=${drained.skipped} expired=${expired.deleted}`,
    );
    await publishActivityChanged([...new Set([...drained.eventIds, ...expired.eventIds])]);
    return drained.claimed >= DEFAULT_REGISTRATION_MAIL_DRAIN_LIMIT || expired.more;
  } catch (err) {
    throw new Error(`error_class=${err instanceof Error ? err.name : "unknown"}`);
  } finally {
    await locks.release("registration_mail");
  }
}

/**
 * The ticket drain and the registration mail drain share one slot of the tick, one after the other. The mail
 * provider's rate limit is per mailer (per transporter), so a second drain running beside the first, each with its own
 * mailer, would double the pace. Running it after the ticket drain, every tick and never skipped for a backlog of
 * tickets, keeps a bulk send from starving the confirmation mails, whose link expires after 24 hours, while a flood
 * of registrations cannot take the quota ticket mail needs (its own limit is 20 a tick, against 50 for tickets).
 *
 * @returns true when either drain filled its batch.
 */
async function runMailJobs(db: PrismaClient, locks: WorkerLockClient): Promise<boolean> {
  const ticketsHaveMore = await runJobSafely("mail_delivery", () => runMailDeliveryJob(db, locks), false);
  const registrationsHaveMore = await runJobSafely("registration_mail", () => runRegistrationMailJob(db, locks), false);
  return ticketsHaveMore || registrationsHaveMore;
}

/** Refreshes the worker heartbeat every 60s while `fn` runs. import/export/wallet_push each have
 * a stale-running budget (15/15/30 min) well past the 5-minute heartbeat-stale floor tuned for a
 * typical short drain (see packages/db/src/worker-heartbeat.ts) - a big one can legitimately
 * outlast that floor and would otherwise show as a dead worker in Health mid-drain (bot review).
 * Timer is always cleared before returning, success or failure. */
async function withHeartbeatRefresh<T>(db: PrismaClient, jobName: string, fn: () => Promise<T>): Promise<T> {
  const timer = setInterval(() => {
    touchWorkerHeartbeat(db).catch((err) => log(jobName, `heartbeat refresh failed: ${errMessage(err)}`));
  }, 60_000);
  try {
    return await fn();
  } finally {
    clearInterval(timer);
  }
}

/** @returns true when a job was claimed this tick - the drain takes one at a time, so another
 * may already be waiting behind it. */
async function runImportJob(db: PrismaClient, locks: WorkerLockClient): Promise<boolean> {
  const acquired = await locks.tryAcquire("import");
  if (!acquired) {
    log("import", "skipped (lock held)");
    return false;
  }
  try {
    const heartbeatStaleMs = workerHeartbeatStaleMs(parseBounceIngestTickSeconds(process.env));
    const result = await withHeartbeatRefresh(db, "import", () =>
      drainImportJobs(db, getDefaultStorage(), { limit: 1, heartbeatStaleMs }),
    );
    if (result.claimed === 0 && result.reclaimed === 0 && result.healed === 0) {
      log("import", "idle");
      return false;
    }
    log(
      "import",
      `ok claimed=${result.claimed} succeeded=${result.succeeded} failed=${result.failed} reclaimed=${result.reclaimed} healed=${result.healed}`,
    );
    await publishActivityChanged(result.eventIds);
    return result.claimed > 0;
  } finally {
    await locks.release("import");
  }
}

/** @returns true when a job was claimed this tick - same one-at-a-time reasoning as import. */
async function runExportJob(db: PrismaClient, locks: WorkerLockClient): Promise<boolean> {
  const acquired = await locks.tryAcquire("export");
  if (!acquired) {
    log("export", "skipped (lock held)");
    return false;
  }
  try {
    const heartbeatStaleMs = workerHeartbeatStaleMs(parseBounceIngestTickSeconds(process.env));
    const result = await withHeartbeatRefresh(db, "export", () =>
      drainExportJobs(db, getDefaultStorage(), { limit: 1, heartbeatStaleMs }),
    );
    if (result.claimed === 0 && result.reclaimed === 0) {
      log("export", "idle");
      return false;
    }
    log(
      "export",
      `ok claimed=${result.claimed} succeeded=${result.succeeded} failed=${result.failed} reclaimed=${result.reclaimed}`,
    );
    return result.claimed > 0;
  } finally {
    await locks.release("export");
  }
}

/** @returns true when a job was claimed this tick - same one-at-a-time reasoning as import/export. */
async function runWalletPushJob(db: PrismaClient, locks: WorkerLockClient): Promise<boolean> {
  const acquired = await locks.tryAcquire("wallet_push");
  if (!acquired) {
    log("wallet_push", "skipped (lock held)");
    return false;
  }
  try {
    const heartbeatStaleMs = workerHeartbeatStaleMs(parseBounceIngestTickSeconds(process.env));
    const result = await withHeartbeatRefresh(db, "wallet_push", () =>
      drainWalletPushJobs(db, { limit: 1, heartbeatStaleMs }),
    );
    if (result.claimed === 0 && result.reclaimed === 0) {
      log("wallet_push", "idle");
      return false;
    }
    log(
      "wallet_push",
      `ok claimed=${result.claimed} succeeded=${result.succeeded} failed=${result.failed} reclaimed=${result.reclaimed}`,
    );
    return result.claimed > 0;
  } finally {
    await locks.release("wallet_push");
  }
}

/** @returns true when a job was claimed this tick - same one-at-a-time reasoning as wallet_push. */
async function runWalletMessageJob(db: PrismaClient, locks: WorkerLockClient): Promise<boolean> {
  const acquired = await locks.tryAcquire("wallet_message");
  if (!acquired) {
    log("wallet_message", "skipped (lock held)");
    return false;
  }
  try {
    const heartbeatStaleMs = workerHeartbeatStaleMs(parseBounceIngestTickSeconds(process.env));
    const result = await withHeartbeatRefresh(db, "wallet_message", () =>
      drainWalletMessageJobs(db, { limit: 1, heartbeatStaleMs }),
    );
    if (result.claimed === 0 && result.reclaimed === 0) {
      log("wallet_message", "idle");
      return false;
    }
    log(
      "wallet_message",
      `ok claimed=${result.claimed} succeeded=${result.succeeded} failed=${result.failed} reclaimed=${result.reclaimed}`,
    );
    return result.claimed > 0;
  } finally {
    await locks.release("wallet_message");
  }
}

/** @returns true when a job was claimed this tick - same one-at-a-time reasoning as wallet_push. */
async function runWalletRefreshStatusJob(db: PrismaClient, locks: WorkerLockClient): Promise<boolean> {
  const acquired = await locks.tryAcquire("wallet_refresh_status");
  if (!acquired) {
    log("wallet_refresh_status", "skipped (lock held)");
    return false;
  }
  try {
    const heartbeatStaleMs = workerHeartbeatStaleMs(parseBounceIngestTickSeconds(process.env));
    const result = await withHeartbeatRefresh(db, "wallet_refresh_status", () =>
      drainWalletRefreshStatusJobs(db, { limit: 1, heartbeatStaleMs }),
    );
    if (result.claimed === 0 && result.reclaimed === 0) {
      log("wallet_refresh_status", "idle");
      return false;
    }
    log(
      "wallet_refresh_status",
      `ok claimed=${result.claimed} succeeded=${result.succeeded} failed=${result.failed} reclaimed=${result.reclaimed}`,
    );
    return result.claimed > 0;
  } finally {
    await locks.release("wallet_refresh_status");
  }
}

/** @returns true when a job was claimed this tick - same one-at-a-time reasoning as wallet_push. */
async function runWalletCleanupJob(db: PrismaClient, locks: WorkerLockClient): Promise<boolean> {
  const acquired = await locks.tryAcquire("wallet_cleanup");
  if (!acquired) {
    log("wallet_cleanup", "skipped (lock held)");
    return false;
  }
  try {
    const heartbeatStaleMs = workerHeartbeatStaleMs(parseBounceIngestTickSeconds(process.env));
    const result = await withHeartbeatRefresh(db, "wallet_cleanup", () =>
      drainWalletCleanupJobs(db, { limit: 1, heartbeatStaleMs }),
    );
    if (result.claimed === 0 && result.reclaimed === 0) {
      log("wallet_cleanup", "idle");
      return false;
    }
    log(
      "wallet_cleanup",
      `ok claimed=${result.claimed} succeeded=${result.succeeded} failed=${result.failed} reclaimed=${result.reclaimed}`,
    );
    return result.claimed > 0;
  } finally {
    await locks.release("wallet_cleanup");
  }
}

async function runBounceJob(db: PrismaClient, locks: WorkerLockClient): Promise<void> {
  const acquired = await locks.tryAcquire("bounce");
  if (!acquired) {
    log("bounce", "skipped (lock held)");
    return;
  }
  try {
    const summary = await ingestBounces(db, {});
    log(
      "bounce",
      `ok events=${summary.eventsProcessed} seen=${summary.messagesSeen} applied=${summary.bouncesApplied} errors=${summary.errors}`,
    );
  } finally {
    await locks.release("bounce");
  }
}

/** Best-effort refresh of each wallet pass's device-registration status from PassCreator - a
 * quiet background maintenance job like retention, not a user-visible-progress one like mail
 * delivery, so it doesn't publish an SSE activity nudge on completion. */
async function runWalletSyncJob(db: PrismaClient, locks: WorkerLockClient): Promise<void> {
  const acquired = await locks.tryAcquire("wallet_sync");
  if (!acquired) {
    log("wallet_sync", "skipped (lock held)");
    return;
  }
  try {
    const result = await runWalletRegistrationSync(db);
    if (result.checked === 0 && result.skippedNoProvider === 0) {
      log("wallet_sync", "idle");
      return;
    }
    log(
      "wallet_sync",
      `ok checked=${result.checked} updated=${result.updated} skippedNoProvider=${result.skippedNoProvider} failed=${result.failed}`,
    );
  } finally {
    await locks.release("wallet_sync");
  }
}

/** Flips any wallet pass whose canonical expires_at (plan v4.2 step 6) has passed to "expired" -
 * a quiet background maintenance job like wallet_sync/retention, not a user-visible-progress one,
 * so it doesn't publish an SSE activity nudge on completion. No provider contact, so unlike
 * wallet_sync there's no per-tick batch cap to report on. */
async function runWalletExpireJob(db: PrismaClient, locks: WorkerLockClient): Promise<void> {
  const acquired = await locks.tryAcquire("wallet_expire");
  if (!acquired) {
    log("wallet_expire", "skipped (lock held)");
    return;
  }
  try {
    const result = await runWalletExpiry(db);
    if (result.expired === 0 && result.deferredEvents === 0) {
      log("wallet_expire", "idle");
      return;
    }
    log("wallet_expire", `ok expired=${result.expired} deferred_events=${result.deferredEvents}`);
  } finally {
    await locks.release("wallet_expire");
  }
}

/** @returns true when this process held the lock and finished retention work. */
async function runRetentionJob(db: PrismaClient, locks: WorkerLockClient): Promise<boolean> {
  const acquired = await locks.tryAcquire("retention");
  if (!acquired) {
    log("retention", "skipped (lock held)");
    return false;
  }
  try {
    const retentionDays = resolveSecurityAuditLogRetentionDays(process.env);
    const notificationRetentionDays = resolveNotificationRetentionDays(process.env);
    const snapshotRetentionDays = resolveDeliverySnapshotRetentionDays(process.env);
    const authResult = await purgeAuthRetention(db, { dryRun: false });
    const mailResult = await nullifyDeliverySnapshots(db, {
      dryRun: false,
      retentionDays: snapshotRetentionDays,
    });
    const securityAuditResult = await purgeSecurityAuditLog(db, {
      dryRun: false,
      retentionDays,
    });
    const notificationsResult = await purgeNotifications(db, {
      dryRun: false,
      retentionDays: notificationRetentionDays,
    });
    const jobFilesResult = await purgeJobFilesForRetention(db, false);
    // Calls the wallet provider for up to a minute: keep the heartbeat fresh, like the other drains that make network calls.
    const walletSweep = await withHeartbeatRefresh(db, "retention", () => sweepErasedWalletPasses(db, { dryRun: false }));
    log(
      "retention",
      `ok auth_sessions=${authResult.sessions} trusted_devices=${authResult.trustedDevices} mail_snapshots=${mailResult.deliveries} security_audit=${securityAuditResult.deleted} notifications=${notificationsResult.deleted} export_files=${jobFilesResult.exportFiles} staged_import_files=${jobFilesResult.stagedImportFiles} orphaned_job_files=${jobFilesResult.orphanedFiles} erased_wallet_passes=${walletSweep.deleted} failed=${jobFilesResult.failures + erasedWalletPassesLeft(walletSweep)}`,
    );
    return true;
  } finally {
    await locks.release("retention");
  }
}

/**
 * @returns true when a drain hit its per-tick batch limit (mail_delivery) or claimed a job at
 * all (import/export claim one at a time) - a backlog larger than one tick's capacity, which
 * the caller should keep draining immediately rather than waiting for the next wake/tick.
 */
export async function runWorkerTick(
  db: PrismaClient,
  locks: WorkerLockClient,
  schedule: RetentionSchedule,
): Promise<boolean> {
  await runJobSafely(
    "heartbeat",
    async () => {
      await touchWorkerHeartbeat(db);
      log("heartbeat", "ok");
    },
    undefined,
  );
  // Independent advisory locks per job type, so one slow drain (e.g. a big mail_delivery
  // batch) cannot delay another's turn (e.g. export) within the same tick.
  const [
    mailHasMore,
    importHasMore,
    exportHasMore,
    walletPushHasMore,
    walletRefreshStatusHasMore,
    walletCleanupHasMore,
    walletMessageHasMore,
  ] = await Promise.all([
    runMailJobs(db, locks),
    runJobSafely("import", () => runImportJob(db, locks), false),
    runJobSafely("export", () => runExportJob(db, locks), false),
    runJobSafely("wallet_push", () => runWalletPushJob(db, locks), false),
    runJobSafely("wallet_refresh_status", () => runWalletRefreshStatusJob(db, locks), false),
    runJobSafely("wallet_cleanup", () => runWalletCleanupJob(db, locks), false),
    runJobSafely("wallet_message", () => runWalletMessageJob(db, locks), false),
    runJobSafely("bounce", () => runBounceJob(db, locks), undefined),
    runJobSafely("wallet_sync", () => runWalletSyncJob(db, locks), undefined),
    runJobSafely("wallet_expire", () => runWalletExpireJob(db, locks), undefined),
  ]);

  if (retentionIsDue(schedule, Date.now())) {
    try {
      const completed = await runRetentionJob(db, locks);
      // Lock held elsewhere: try again on the next tick (cheap skip).
      if (completed) markRetentionSuccess(schedule, Date.now());
    } catch (err) {
      log("retention", `FAILED ${errMessage(err)}`);
      markRetentionFailure(schedule, Date.now());
      log("retention", "retry after failure backoff (15m)");
    }
  }

  // Refresh after long drains so Health does not mark the worker stale mid-tick.
  await runJobSafely(
    "heartbeat",
    async () => {
      await touchWorkerHeartbeat(db);
    },
    undefined,
  );

  return (
    mailHasMore ||
    importHasMore ||
    exportHasMore ||
    walletPushHasMore ||
    walletRefreshStatusHasMore ||
    walletCleanupHasMore ||
    walletMessageHasMore
  );
}

/**
 * The least time between the starts of two ticks that a wake notification may cause. Every guest registration queues
 * mail and so wakes the worker, and a steady stream of them, as a form that is open to many people brings, would
 * otherwise keep the loop running one tick after another with no pause. A backlog that a tick leaves is not held to
 * this: it is drained at once, because there is work to do.
 */
export const WORKER_MIN_WAKE_INTERVAL_MS = 2_000;

/**
 * A wake that comes soon after the tick began waits out the rest of the interval. A notification that arrives
 * meanwhile is latched by the notify client, so the next wait returns at once and nothing is lost.
 */
async function waitOutWakeInterval(tickStartedAt: number, minIntervalMs: number, signal: { stopped: boolean }): Promise<void> {
  const remaining = minIntervalMs - (Date.now() - tickStartedAt);
  if (remaining > 0 && !signal.stopped) await sleep(remaining, signal);
}

/**
 * Long-running worker. Resolves when SIGTERM/SIGINT handled (or fatal lock client error).
 * Does not disconnect Prisma (caller owns that).
 */
export async function runWorker(
  db: PrismaClient,
  options: { minWakeIntervalMs?: number } = {},
): Promise<void> {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  assertValidBounceIngestTickSecondsEnv(process.env);
  const tickSeconds = parseBounceIngestTickSeconds(process.env);
  const tickMs = tickSeconds * 1000;
  const minWakeIntervalMs = options.minWakeIntervalMs ?? WORKER_MIN_WAKE_INTERVAL_MS;
  const locks = await openWorkerLockClient(databaseUrl);
  let notify = await ensureNotifyClient(databaseUrl, null);
  const signal = { stopped: false };
  const retention: RetentionSchedule = createRetentionSchedule();

  // Installed only once the resources the `finally` block below cleans up (locks, notify) have
  // actually been acquired - installing any earlier would leave the process-wide relay dangling
  // if openWorkerLockClient/ensureNotifyClient itself threw before the try block was reached
  // (bot review).
  installSystemLogRelay();

  const onStop = () => {
    if (signal.stopped) return;
    signal.stopped = true;
    log("heartbeat", "shutdown signal received");
  };
  process.on("SIGTERM", onStop);
  process.on("SIGINT", onStop);

  log(
    "heartbeat",
    `starting tick=${tickSeconds}s host=${osHostname()} notify=${notify ? "on" : "off"} (mail_delivery + registration_mail + import + export + wallet_push + wallet_message + bounce + wallet_sync + retention)`,
  );

  try {
    // Each tick is awaited fully before sleep; SIGTERM during a tick finishes the tick, then exits.
    while (!signal.stopped) {
      const tickStartedAt = Date.now();
      const mightHaveMore = await runWorkerTick(db, locks, retention);
      if (signal.stopped) break;
      // A batch bigger than one tick's per-type limit (e.g. mail sent to hundreds of
      // attendees at once) - keep draining immediately instead of waiting for the next
      // wake/tick, since the burst's notifications already collapsed into one wake.
      if (mightHaveMore) continue;
      notify = await ensureNotifyClient(databaseUrl, notify); // NOSONAR - worker loop: each tick waits for the previous wake or timeout
      if (notify) {
        await notify.waitForWakeOrTimeout(tickMs, signal); // NOSONAR - worker loop: each tick waits for the previous wake or timeout
        await waitOutWakeInterval(tickStartedAt, minWakeIntervalMs, signal); // NOSONAR - worker loop: the interval between ticks
      } else {
        await sleep(tickMs, signal); // NOSONAR - worker loop: each tick waits for the previous wake or timeout
      }
    }
  } finally {
    process.off("SIGTERM", onStop);
    process.off("SIGINT", onStop);
    await locks.close();
    await notify?.close();
    await closeSsePublishClient();
    // Log "stopped" while the relay is still installed, or the final lifecycle entry never
    // leaves this process - System logs would show the shutdown signal arriving but never
    // confirm the worker actually finished stopping (bot review).
    log("heartbeat", "stopped");
    uninstallSystemLogRelay();
  }
}
