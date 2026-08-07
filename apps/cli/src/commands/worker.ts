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
const SHUTDOWN_DRAIN_MS = 120_000;

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
  let inFlight: Promise<void> | null = null;
  let lastRetentionAt: number | null = null;
  let retentionBootDone = false;

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
    while (!signal.stopped) {
      const tickWork = (async () => {
        try {
          await touchWorkerHeartbeat(db);
          log("heartbeat", "ok");
        } catch (err) {
          log("heartbeat", `FAILED ${err instanceof Error ? err.message : String(err)}`);
        }

        try {
          await runBounceJob(db, locks);
        } catch (err) {
          log("bounce", `FAILED ${err instanceof Error ? err.message : String(err)}`);
        }

        const now = Date.now();
        const retentionDue =
          !retentionBootDone ||
          lastRetentionAt == null ||
          now - lastRetentionAt >= RETENTION_INTERVAL_MS;
        if (retentionDue) {
          try {
            await runRetentionJob(db, locks);
            lastRetentionAt = Date.now();
            retentionBootDone = true;
          } catch (err) {
            log("retention", `FAILED ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      })();

      inFlight = tickWork;
      await tickWork;
      inFlight = null;

      if (signal.stopped) break;
      await sleep(tickMs, signal);
    }

    if (inFlight) {
      log("heartbeat", `waiting up to ${SHUTDOWN_DRAIN_MS}ms for in-flight tick`);
      await Promise.race([
        inFlight,
        new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_DRAIN_MS)),
      ]);
    }
  } finally {
    process.off("SIGTERM", onStop);
    process.off("SIGINT", onStop);
    await locks.close();
    log("heartbeat", "stopped");
  }
}
