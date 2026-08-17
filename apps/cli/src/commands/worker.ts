/**
 * Admitto background worker loop (ADR 0042).
 *
 *   admitto worker
 *
 * Jobs: mail_delivery drain, import/export/wallet_push/wallet_message AdminJobs, bounce ingest,
 * wallet_sync, retention.
 */
import { hostname as osHostname } from "node:os";
import type { PrismaClient } from "@admitto/db";
import {
  InstanceUrlRequiredError,
  purgeAuthRetention,
  purgeSecurityAuditLog,
  resolveInstanceBaseUrl,
  resolveSecurityAuditLogRetentionDays,
} from "@admitto/auth";
import {
  DEFAULT_MAIL_DRAIN_LIMIT,
  drainPendingDeliveries,
  ingestBounces,
  nullifyDeliverySnapshots,
  parseBounceIngestTickSeconds,
  workerHeartbeatStaleMs,
} from "@admitto/mail-delivery";
import { drainImportJobs } from "@admitto/import";
import { getDefaultStorage } from "@admitto/storage";
import { closeSsePublishClient, publishActivityChanged } from "../lib/sse-publish.js";
import { drainExportJobs } from "./export-jobs.js";
import { runWalletRegistrationSync } from "./wallet-sync.js";
import { drainWalletPushJobs } from "./wallet-push-jobs.js";
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

function log(job: string, message: string): void {
  const ts = new Date().toISOString();
  console.log(`[worker:${job}] ${ts} ${message}`);
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

async function resolveWorkerBaseUrl(db: PrismaClient): Promise<string | undefined> {
  try {
    return await resolveInstanceBaseUrl(db, process.env);
  } catch (err) {
    if (err instanceof InstanceUrlRequiredError) {
      log("mail_delivery", "skip drain: instance URL not configured");
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

/** @returns true when this process held the lock and finished retention work. */
async function runRetentionJob(db: PrismaClient, locks: WorkerLockClient): Promise<boolean> {
  const acquired = await locks.tryAcquire("retention");
  if (!acquired) {
    log("retention", "skipped (lock held)");
    return false;
  }
  try {
    const retentionDays = resolveSecurityAuditLogRetentionDays(process.env);
    const authResult = await purgeAuthRetention(db, { dryRun: false });
    const mailResult = await nullifyDeliverySnapshots(db, { dryRun: false });
    const securityAuditResult = await purgeSecurityAuditLog(db, {
      dryRun: false,
      retentionDays,
    });
    log(
      "retention",
      `ok auth_sessions=${authResult.sessions} trusted_devices=${authResult.trustedDevices} mail_snapshots=${mailResult.deliveries} security_audit=${securityAuditResult.deleted}`,
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
  const [mailHasMore, importHasMore, exportHasMore, walletPushHasMore, walletMessageHasMore] = await Promise.all([
    runJobSafely("mail_delivery", () => runMailDeliveryJob(db, locks), false),
    runJobSafely("import", () => runImportJob(db, locks), false),
    runJobSafely("export", () => runExportJob(db, locks), false),
    runJobSafely("wallet_push", () => runWalletPushJob(db, locks), false),
    runJobSafely("wallet_message", () => runWalletMessageJob(db, locks), false),
    runJobSafely("bounce", () => runBounceJob(db, locks), undefined),
    runJobSafely("wallet_sync", () => runWalletSyncJob(db, locks), undefined),
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

  return mailHasMore || importHasMore || exportHasMore || walletPushHasMore || walletMessageHasMore;
}

/**
 * Long-running worker. Resolves when SIGTERM/SIGINT handled (or fatal lock client error).
 * Does not disconnect Prisma (caller owns that).
 */
export async function runWorker(db: PrismaClient): Promise<void> {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const tickSeconds = parseBounceIngestTickSeconds(process.env);
  const tickMs = tickSeconds * 1000;
  const locks = await openWorkerLockClient(databaseUrl);
  let notify = await ensureNotifyClient(databaseUrl, null);
  const signal = { stopped: false };
  const retention: RetentionSchedule = createRetentionSchedule();

  const onStop = () => {
    if (signal.stopped) return;
    signal.stopped = true;
    log("heartbeat", "shutdown signal received");
  };
  process.on("SIGTERM", onStop);
  process.on("SIGINT", onStop);

  log(
    "heartbeat",
    `starting tick=${tickSeconds}s host=${osHostname()} notify=${notify ? "on" : "off"} (mail_delivery + import + export + wallet_push + wallet_message + bounce + wallet_sync + retention)`,
  );

  try {
    // Each tick is awaited fully before sleep; SIGTERM during a tick finishes the tick, then exits.
    while (!signal.stopped) {
      const mightHaveMore = await runWorkerTick(db, locks, retention);
      if (signal.stopped) break;
      // A batch bigger than one tick's per-type limit (e.g. mail sent to hundreds of
      // attendees at once) - keep draining immediately instead of waiting for the next
      // wake/tick, since the burst's notifications already collapsed into one wake.
      if (mightHaveMore) continue;
      notify = await ensureNotifyClient(databaseUrl, notify);
      if (notify) {
        await notify.waitForWakeOrTimeout(tickMs, signal);
      } else {
        await sleep(tickMs, signal);
      }
    }
  } finally {
    process.off("SIGTERM", onStop);
    process.off("SIGINT", onStop);
    await locks.close();
    await notify?.close();
    await closeSsePublishClient();
    log("heartbeat", "stopped");
  }
}
