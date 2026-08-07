/**
 * Admitto background worker loop (ADR 0042).
 *
 *   admitto worker
 *
 * Jobs: mail_delivery drain, import/export AdminJobs, bounce ingest, retention.
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
} from "@admitto/mail-delivery";
import { drainImportJobs } from "@admitto/import";
import { getDefaultStorage } from "@admitto/storage";
import { drainExportJobs } from "./export-jobs.js";
import { touchWorkerHeartbeat } from "./worker-heartbeat.js";
import { openWorkerLockClient, type WorkerLockClient } from "./worker-locks.js";
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
    const result = await drainImportJobs(db, getDefaultStorage(), { limit: 1 });
    if (result.claimed === 0 && result.reclaimed === 0 && result.healed === 0) {
      log("import", "idle");
      return;
    }
    log(
      "import",
      `ok claimed=${result.claimed} succeeded=${result.succeeded} failed=${result.failed} reclaimed=${result.reclaimed} healed=${result.healed}`,
    );
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
    const result = await drainExportJobs(db, getDefaultStorage(), { limit: 1 });
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

async function runWorkerTick(
  db: PrismaClient,
  locks: WorkerLockClient,
  schedule: RetentionSchedule,
): Promise<void> {
  await runJobSafely("heartbeat", async () => {
    await touchWorkerHeartbeat(db);
    log("heartbeat", "ok");
  });
  await runJobSafely("mail_delivery", () => runMailDeliveryJob(db, locks));
  await runJobSafely("import", () => runImportJob(db, locks));
  await runJobSafely("export", () => runExportJob(db, locks));
  await runJobSafely("bounce", () => runBounceJob(db, locks));

  if (!retentionIsDue(schedule, Date.now())) return;

  try {
    const completed = await runRetentionJob(db, locks);
    // Lock held elsewhere: try again on the next tick (cheap skip).
    if (!completed) return;
    markRetentionSuccess(schedule, Date.now());
  } catch (err) {
    log("retention", `FAILED ${errMessage(err)}`);
    markRetentionFailure(schedule, Date.now());
    log("retention", "retry after failure backoff (15m)");
  }
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
    `starting tick=${tickSeconds}s host=${osHostname()} (mail_delivery + import + export + bounce + retention)`,
  );

  try {
    // Each tick is awaited fully before sleep; SIGTERM during a tick finishes the tick, then exits.
    while (!signal.stopped) {
      await runWorkerTick(db, locks, retention);
      if (signal.stopped) break;
      await sleep(tickMs, signal);
    }
  } finally {
    process.off("SIGTERM", onStop);
    process.off("SIGINT", onStop);
    await locks.close();
    log("heartbeat", "stopped");
  }
}
