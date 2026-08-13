/**
 * Admitto background worker loop (ADR 0042).
 *
 *   admitto worker
 *
 * Jobs: mail_delivery drain, import/export AdminJobs, bounce ingest, wallet_sync, retention.
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

async function runJobSafely(job: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (err) {
    log(job, `FAILED ${errMessage(err)}`);
  }
}

/**
 * Reuses `current` if still alive, otherwise (re)connects. Returns null on failure so the
 * caller can fall back to plain tick-interval polling — the notify client is a pure latency
 * optimization, never a correctness dependency.
 */
async function ensureNotifyClient(
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

async function runMailDeliveryJob(db: PrismaClient, locks: WorkerLockClient): Promise<void> {
  const acquired = await locks.tryAcquire("mail_delivery");
  if (!acquired) {
    log("mail_delivery", "skipped (lock held)");
    return;
  }
  try {
    const baseUrl = await resolveWorkerBaseUrl(db);
    if (!baseUrl) return;
    const result = await drainPendingDeliveries(db, process.env, {}, { baseUrl });
    if (result.claimed === 0) {
      log("mail_delivery", "idle");
      return;
    }
    log(
      "mail_delivery",
      `ok claimed=${result.claimed} sent=${result.sent} failed=${result.failed} skipped=${result.skipped}`,
    );
    await publishActivityChanged(result.eventIds);
  } finally {
    await locks.release("mail_delivery");
  }
}

async function runImportJob(db: PrismaClient, locks: WorkerLockClient): Promise<void> {
  const acquired = await locks.tryAcquire("import");
  if (!acquired) {
    log("import", "skipped (lock held)");
    return;
  }
  try {
    const heartbeatStaleMs = workerHeartbeatStaleMs(parseBounceIngestTickSeconds(process.env));
    const result = await drainImportJobs(db, getDefaultStorage(), {
      limit: 1,
      heartbeatStaleMs,
    });
    if (result.claimed === 0 && result.reclaimed === 0 && result.healed === 0) {
      log("import", "idle");
      return;
    }
    log(
      "import",
      `ok claimed=${result.claimed} succeeded=${result.succeeded} failed=${result.failed} reclaimed=${result.reclaimed} healed=${result.healed}`,
    );
    await publishActivityChanged(result.eventIds);
  } finally {
    await locks.release("import");
  }
}

async function runExportJob(db: PrismaClient, locks: WorkerLockClient): Promise<void> {
  const acquired = await locks.tryAcquire("export");
  if (!acquired) {
    log("export", "skipped (lock held)");
    return;
  }
  try {
    const heartbeatStaleMs = workerHeartbeatStaleMs(parseBounceIngestTickSeconds(process.env));
    const result = await drainExportJobs(db, getDefaultStorage(), {
      limit: 1,
      heartbeatStaleMs,
    });
    if (result.claimed === 0 && result.reclaimed === 0) {
      log("export", "idle");
      return;
    }
    log(
      "export",
      `ok claimed=${result.claimed} succeeded=${result.succeeded} failed=${result.failed} reclaimed=${result.reclaimed}`,
    );
  } finally {
    await locks.release("export");
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

export async function runWorkerTick(
  db: PrismaClient,
  locks: WorkerLockClient,
  schedule: RetentionSchedule,
): Promise<void> {
  await runJobSafely("heartbeat", async () => {
    await touchWorkerHeartbeat(db);
    log("heartbeat", "ok");
  });
  // Independent advisory locks per job type, so one slow drain (e.g. a big mail_delivery
  // batch) cannot delay another's turn (e.g. export) within the same tick.
  await Promise.all([
    runJobSafely("mail_delivery", () => runMailDeliveryJob(db, locks)),
    runJobSafely("import", () => runImportJob(db, locks)),
    runJobSafely("export", () => runExportJob(db, locks)),
    runJobSafely("bounce", () => runBounceJob(db, locks)),
    runJobSafely("wallet_sync", () => runWalletSyncJob(db, locks)),
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
  await runJobSafely("heartbeat", async () => {
    await touchWorkerHeartbeat(db);
  });
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
    `starting tick=${tickSeconds}s host=${osHostname()} notify=${notify ? "on" : "off"} (mail_delivery + import + export + bounce + wallet_sync + retention)`,
  );

  try {
    // Each tick is awaited fully before sleep; SIGTERM during a tick finishes the tick, then exits.
    while (!signal.stopped) {
      await runWorkerTick(db, locks, retention);
      if (signal.stopped) break;
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
