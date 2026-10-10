/**
 * Claim and run pending AdminJob type=export (attendees filtered files).
 *
 * Storage is a narrow duck type so @admitto/tickets does not depend on
 * @admitto/storage (storage → auth → tickets would be a package cycle).
 */
import type { PrismaClient } from "@admitto/db";
import { emitSystemLog } from "@admitto/shared/system-log";
import { buildAttendeesExportArtifact } from "./attendees-export-artifact.js";
import {
  countFilteredAttendees,
  findFilteredAttendeesForExport,
  EXPORT_ROW_CAP,
  type AttendeeListFilterParams,
} from "./attendees-list-filters.js";
import { claimNextAdminJob } from "./claim-admin-job.js";
import { writeBulkActionLog } from "./ops-audit.js";
import {
  parseExportJobStaleRunningMs,
  reclaimStaleExportJobs,
} from "./reclaim-stale-export-jobs.js";
import { redactAttendeeListFiltersForStorage, scrubExportJobResultJson } from "./export-job-privacy.js";

export type DrainExportJobsResult = {
  claimed: number;
  succeeded: number;
  failed: number;
  reclaimed: number;
};

/** Subset of StorageAdapter used by export drain: `put` writes the file, `delete` takes it back when the job cannot record it. */
export type ExportJobStorage = {
  put(
    bytes: Buffer,
    opts: {
      orgId: string;
      eventId: string;
      scope: "event";
      ext: ".csv" | ".pdf" | ".xlsx";
    },
  ): Promise<{ key: string }>;
  delete(key: string): Promise<unknown>;
};

type AttendeesFilteredRequest = {
  kind: "attendees_filtered";
  format: "csv" | "xlsx" | "pdf";
  filters: AttendeeListFilterParams;
};

type ClaimedExportJob = NonNullable<Awaited<ReturnType<typeof claimNextAdminJob>>>;

function readRequest(job: { result_json: unknown }): AttendeesFilteredRequest | null {
  if (!job.result_json || typeof job.result_json !== "object" || Array.isArray(job.result_json)) {
    return null;
  }
  const raw = job.result_json as Record<string, unknown>;
  const request = raw.request;
  if (!request || typeof request !== "object" || Array.isArray(request)) return null;
  const req = request as Record<string, unknown>;
  if (req.kind !== "attendees_filtered") return null;
  if (req.format !== "csv" && req.format !== "xlsx" && req.format !== "pdf") return null;
  return {
    kind: "attendees_filtered",
    format: req.format,
    filters: (req.filters ?? {}) as AttendeeListFilterParams,
  };
}

function storageExt(format: AttendeesFilteredRequest["format"]): ".csv" | ".pdf" | ".xlsx" {
  if (format === "csv") return ".csv";
  if (format === "pdf") return ".pdf";
  return ".xlsx";
}

async function markExportFailed(db: PrismaClient, jobId: string, err: unknown): Promise<void> {
  const existing = await db.adminJob.findUnique({
    where: { id: jobId },
    select: { result_json: true },
  });
  const scrubbed = scrubExportJobResultJson(existing?.result_json);
  // Only a job that is still running: one whose row is gone (its event was deleted while it ran) or that
  // somebody closed already (an erasure stopped it, or it was reclaimed as stale) matches nothing, keeps its
  // own error, and the rest of the queue still runs. One statement, so the check and the write cannot part.
  await db.adminJob.updateMany({
    where: { id: jobId, status: "running" },
    data: {
      status: "failed",
      finished_at: new Date(),
      error: (err instanceof Error ? err.message : String(err)).slice(0, 2000),
      ...(scrubbed !== undefined && scrubbed !== null ? { result_json: scrubbed } : {}),
    },
  });
}

/**
 * Takes back a file that the job cannot record: its row is gone (the event was deleted while the export ran),
 * was closed meanwhile (an erasure stopped the job, or it was reclaimed as stale) or the write failed. The
 * file holds attendees and nothing else knows of it, so when even the delete fails its key must not be lost:
 * it goes to stdout (the System logs buffer lives in memory) and, if the row is still there, onto the row,
 * where the retention run of finished jobs tries again.
 */
async function takeBackStoredFile(
  db: PrismaClient,
  storage: ExportJobStorage,
  job: { id: string; event_id: string | null },
  key: string,
): Promise<void> {
  try {
    await storage.delete(key);
    return;
  } catch (err) {
    // A file system error carries a code (ENOSPC, EACCES) and the key path, never a person's data.
    const code = (err as { code?: unknown } | null)?.code;
    const reason = typeof code === "string" ? code : err instanceof Error ? err.name : "unknown";
    emitSystemLog("worker", "error", "export_file_left_in_storage", {
      jobId: job.id,
      eventId: job.event_id,
      key,
      reason,
    });
  }
  try {
    await db.adminJob.updateMany({ where: { id: job.id, storage_key: null }, data: { storage_key: key } });
  } catch {
    /* the log line above is the record */
  }
}

async function runOneExportJob(
  db: PrismaClient,
  storage: ExportJobStorage,
  job: ClaimedExportJob,
): Promise<"succeeded" | "failed"> {
  try {
    if (!job.event_id || !job.organization_id) throw new Error("export_job_incomplete");
    const request = readRequest(job);
    if (!request) throw new Error("export_job_bad_request");

    // Exports never include an erased attendee, whatever the stored filters say.
    const total = await countFilteredAttendees(db, job.event_id, { ...request.filters, includeErased: false });
    if (total > EXPORT_ROW_CAP) throw new Error("export_too_large");

    const event = await db.event.findUniqueOrThrow({
      where: { id: job.event_id },
      select: { title: true, date: true, timezone: true },
    });
    const rows = await findFilteredAttendeesForExport(db, job.event_id, request.filters);
    const file = await buildAttendeesExportArtifact(
      db,
      job.event_id,
      rows,
      request.format,
      event,
    );
    const staged = await storage.put(file.bytes, {
      orgId: job.organization_id,
      eventId: job.event_id,
      scope: "event",
      ext: storageExt(request.format),
    });

    let recorded: { count: number };
    try {
      // Only a job that is still running records its file: one that was closed meanwhile (an erasure that
      // committed after the last check of the rows stopped it) must not end up with a file that holds the
      // people the erasure removed. One statement, so the check and the write cannot part.
      recorded = await db.adminJob.updateMany({
        where: { id: job.id, status: "running" },
        data: {
          status: "succeeded",
          finished_at: new Date(),
          storage_key: staged.key,
          filename: file.filename,
          created_count: file.rowCount,
          result_json: {
            request: {
              kind: request.kind,
              format: request.format,
              filters: redactAttendeeListFiltersForStorage(request.filters),
            },
            filename: file.filename,
            contentType: file.contentType,
            rowCount: file.rowCount,
          },
          error: null,
        },
      });
    } catch (finalizeErr) {
      // The write itself failed. The file is in storage and no row names it: take it back.
      await takeBackStoredFile(db, storage, job, staged.key);
      throw finalizeErr;
    }
    if (recorded.count === 0) {
      // The job is not running any more: its row is gone (the event was deleted while the export ran), or
      // somebody closed it (an erasure stopped it, or it was reclaimed as stale) and said why. The file
      // holds attendees and nothing names it: take it back.
      await takeBackStoredFile(db, storage, job, staged.key);
      return "failed";
    }

    // Audit must not flip a completed export back to failed (file already in storage).
    try {
      await writeBulkActionLog(db, {
        event_id: job.event_id,
        action_type: "attendees_exported",
        audit: {
          operator: job.actor_user_id ?? undefined,
          sessionId: job.session_id ?? undefined,
          timezone: job.client_timezone ?? undefined,
        },
        metadata: {
          format: request.format,
          count: file.rowCount,
          filters: {
            status: request.filters.status ?? "all",
            ticket_type: request.filters.ticket_type ?? null,
            mail_status: request.filters.mail_status ?? null,
            has_query: Boolean(request.filters.q),
          },
        },
      });
    } catch {
      /* best-effort */
    }
    return "succeeded";
  } catch (err) {
    await markExportFailed(db, job.id, err);
    return "failed";
  }
}

export async function drainExportJobs(
  db: PrismaClient,
  storage: ExportJobStorage,
  options: { limit?: number; staleRunningMs?: number; heartbeatStaleMs?: number } = {},
): Promise<DrainExportJobsResult> {
  const limit = options.limit && options.limit > 0 ? Math.floor(options.limit) : 1;
  const staleRunningMs = options.staleRunningMs ?? parseExportJobStaleRunningMs();
  const { reclaimed } = await reclaimStaleExportJobs(db, {
    olderThanMs: staleRunningMs,
    heartbeatStaleMs: options.heartbeatStaleMs,
  });

  let claimed = 0;
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < limit; i += 1) {
    const job = await claimNextAdminJob(db, "export");
    if (!job) break;
    claimed += 1;
    const outcome = await runOneExportJob(db, storage, job);
    if (outcome === "succeeded") succeeded += 1;
    else failed += 1;
  }

  return { claimed, succeeded, failed, reclaimed };
}
