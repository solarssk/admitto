import fs from "node:fs";
import type { PrismaClient } from "@admitto/db";
import {
  AttendeeExportTooLargeError,
  exportAttendeesCsv,
  type ExportAttendeesCsvResult,
} from "@admitto/tickets/attendees-export";
import {
  writeBulkActionLog,
  type AttendeeListFilterParams,
} from "@admitto/tickets";
import { CliError, arg, hasFlag } from "../lib/args.js";
import { requireOperatorUserId } from "../lib/audit.js";
import {
  assertSafeEmergencyExportOut,
  writeSafeEmergencyExportFile,
} from "../lib/export-out-path.js";

function parseAttendeesExportArgs(): {
  eventId: string;
  out: string;
  filters: AttendeeListFilterParams;
} {
  const eventId = arg("event");
  const out = arg("out");
  const format = arg("format") ?? "csv";
  if (!eventId || !out) {
    throw new CliError("Usage: admitto attendees export --event <id> --out <path> [--format csv]");
  }
  if (format !== "csv") {
    throw new CliError("Emergency CLI supports --format csv only (use admin UI for xlsx/pdf).");
  }

  const statusFilter = arg("status");
  const filters: AttendeeListFilterParams = {
    status: "all",
    ...(statusFilter === "admitted" || statusFilter === "not_admitted"
      ? { status: statusFilter }
      : {}),
    ...(arg("ticket_type") ? { ticket_type: arg("ticket_type") } : {}),
    ...(arg("q") ? { q: arg("q") } : {}),
  };

  return { eventId, out, filters };
}

async function exportAttendeesForCli(
  db: PrismaClient,
  eventId: string,
  filters: AttendeeListFilterParams,
): Promise<ExportAttendeesCsvResult> {
  try {
    return await exportAttendeesCsv(db, eventId, filters);
  } catch (err) {
    if (err instanceof AttendeeExportTooLargeError) {
      throw new CliError(`Export too large: ${err.count} rows (cap ${err.cap}).`);
    }
    if (err instanceof Error && err.message === "event_not_found") {
      throw new CliError("Event not found.");
    }
    throw err;
  }
}

function writeAttendeesExportFile(out: string, csv: string): string {
  try {
    return writeSafeEmergencyExportFile(out, csv);
  } catch (err) {
    throw new CliError(
      `Failed to write export to ${out}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function logAttendeesExportAudit(
  db: PrismaClient,
  params: {
    eventId: string;
    actorUserId: string;
    exportPath: string;
    result: ExportAttendeesCsvResult;
    filters: AttendeeListFilterParams;
  },
): Promise<void> {
  try {
    await db.$transaction(async (tx) => {
      await writeBulkActionLog(tx, {
        event_id: params.eventId,
        action_type: "attendees_exported",
        audit: { operator: params.actorUserId, ip: "127.0.0.1" },
        metadata: {
          format: "csv",
          count: params.result.rowCount,
          source: "cli",
          outPath: params.exportPath,
          filters: {
            status: params.filters.status,
            ticket_type: params.filters.ticket_type ?? null,
            has_query: Boolean(params.filters.q),
          },
        },
      });
    });
  } catch (err) {
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- path joined from trusted repo root or upload dir
      fs.unlinkSync(params.exportPath);
    } catch {
      // Best-effort rollback when audit fails after write.
    }
    throw new CliError(
      `Export audit log failed: ${err instanceof Error ? err.message : String(err)}`,
      2,
    );
  }
}

export async function runAttendeesExport(db: PrismaClient): Promise<void> {
  const { eventId, out, filters } = parseAttendeesExportArgs();

  if (hasFlag("dry-run")) {
    const exportPath = assertSafeEmergencyExportOut(out);
    console.log(`Dry run: would export attendees for event ${eventId} to ${exportPath}`);
    return;
  }

  const actorUserId = await requireOperatorUserId(db);

  const result = await exportAttendeesForCli(db, eventId, filters);

  const exportPath = writeAttendeesExportFile(out, result.csv);

  await logAttendeesExportAudit(db, { eventId, actorUserId, exportPath, result, filters });

  console.log(`Exported ${result.rowCount} rows to ${exportPath}`);
}
