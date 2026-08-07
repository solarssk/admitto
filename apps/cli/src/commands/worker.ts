/**
 * Admitto background worker loop (ADR 0042).
 *
 *   admitto worker
 *
 * Jobs (foundation): bounce ingest + retention. Mail/import/export land in stacked PRs.
 */
import { hostname as osHostname } from "node:os";
import type { PrismaClient } from "@admitto/db";
import {
  ingestBounces,
  nullifyDeliverySnapshots,
  parseBounceIngestTickSeconds,
} from "@admitto/mail-delivery";
import { purgeAuthRetention, purgeSecurityAuditLog, resolveSecurityAuditLogRetentionDays } from "@admitto/auth";
import { touchWorkerHeartbeat } from "./worker-heartbeat.js";
import { openWorkerLockClient, type WorkerLockClient } from "./worker-locks.js";

const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;

type RetentionSchedule = {
  lastRetentionAt: number | null;
  bootDone: boolean;
};

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

async function runRetentionJob(db: PrismaClient, locks: WorkerLockClient): Promise<void> {
  const acquired = await locks.tryAcquire("retention");
  if (!acquired) {
    log("retention", "skipped (lock held)");
    return;
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
  } finally {
    await locks.release("retention");
  }
}

function retentionIsDue(schedule: RetentionSchedule, now: number): boolean {
  return (
    !schedule.bootDone ||
    schedule.lastRetentionAt == null ||
    now - schedule.lastRetentionAt >= RETENTION_INTERVAL_MS
  );
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
  await runJobSafely("bounce", () => runBounceJob(db, locks));

  if (!retentionIsDue(schedule, Date.now())) return;

  await runJobSafely("retention", async () => {
    await runRetentionJob(db, locks);
    schedule.lastRetentionAt = Date.now();
    schedule.bootDone = true;
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
  const signal = { stopped: false };
  const retention: RetentionSchedule = { lastRetentionAt: null, bootDone: false };

  const onStop = () => {
    if (signal.stopped) return;
    signal.stopped = true;
    log("heartbeat", "shutdown signal received");
  };
  process.on("SIGTERM", onStop);
  process.on("SIGINT", onStop);

  log(
    "heartbeat",
    `starting tick=${tickSeconds}s host=${osHostname()} (bounce + retention; mail/import/export later)`,
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
