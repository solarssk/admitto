/**
 * Claim and run pending AdminJob type=export (attendees filtered files).
 *
 * Storage is a narrow duck type so @admitto/tickets does not depend on
 * @admitto/storage (storage → auth → tickets would be a package cycle).
 */
import type { PrismaClient } from "@admitto/db";
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

export type DrainExportJobsResult = {
  claimed: number;
  succeeded: number;
  failed: number;
  reclaimed: number;
};

/** Subset of StorageAdapter.put used by export drain. */
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
  await db.adminJob.update({
    where: { id: jobId },
    data: {
      status: "failed",
      finished_at: new Date(),
      error: (err instanceof Error ? err.message : String(err)).slice(0, 2000),
    },
  });
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

    const total = await countFilteredAttendees(db, job.event_id, request.filters);
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

    await db.adminJob.update({
      where: { id: job.id },
      data: {
        status: "succeeded",
        finished_at: new Date(),
        storage_key: staged.key,
        filename: file.filename,
        created_count: file.rowCount,
        result_json: {
          request,
          filename: file.filename,
          contentType: file.contentType,
          rowCount: file.rowCount,
        },
        error: null,
      },
    });

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
  options: { limit?: number; staleRunningMs?: number } = {},
): Promise<DrainExportJobsResult> {
  const limit = options.limit && options.limit > 0 ? Math.floor(options.limit) : 1;
  const staleRunningMs = options.staleRunningMs ?? parseExportJobStaleRunningMs();
  const { reclaimed } = await reclaimStaleExportJobs(db, { olderThanMs: staleRunningMs });

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
