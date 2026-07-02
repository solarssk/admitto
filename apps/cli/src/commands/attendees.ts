import fs from "node:fs";
import type { PrismaClient } from "@prisma/client";
import {
  AttendeeExportTooLargeError,
  exportAttendeesCsv,
} from "@admitto/tickets/attendees-export";
import {
  writeBulkActionLog,
  type AttendeeListFilterParams,
} from "@admitto/tickets";
import { CliError, arg, hasFlag } from "../lib/args.js";
import { requireOperatorUserId } from "../lib/audit.js";

const PRIVATE_EXPORT_MODE = 0o600;

function writePrivateExportFile(path: string, content: string): void {
  fs.writeFileSync(path, content, { encoding: "utf8", mode: PRIVATE_EXPORT_MODE });
  fs.chmodSync(path, PRIVATE_EXPORT_MODE);
}

export async function runAttendeesExport(db: PrismaClient): Promise<void> {
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

  if (hasFlag("dry-run")) {
    console.log(`Dry run: would export attendees for event ${eventId} to ${out}`);
    return;
  }

  const actorUserId = await requireOperatorUserId(db);

  let result;
  try {
    result = await exportAttendeesCsv(db, eventId, filters);
  } catch (err) {
    if (err instanceof AttendeeExportTooLargeError) {
      throw new CliError(`Export too large: ${err.count} rows (cap ${err.cap}).`);
    }
    if (err instanceof Error && err.message === "event_not_found") {
      throw new CliError("Event not found.");
    }
    throw err;
  }

  try {
    writePrivateExportFile(out, result.csv);
  } catch (err) {
    throw new CliError(
      `Failed to write export to ${out}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  try {
    await db.$transaction(async (tx) => {
      await writeBulkActionLog(tx, {
        event_id: eventId,
        action_type: "attendees_exported",
        audit: { operator: actorUserId, ip: "127.0.0.1" },
        metadata: {
          format: "csv",
          count: result.rowCount,
          source: "cli",
          outPath: out,
          filters: {
            status: filters.status,
            ticket_type: filters.ticket_type ?? null,
            has_query: Boolean(filters.q),
          },
        },
      });
    });
  } catch (err) {
    try {
      fs.unlinkSync(out);
    } catch {
      // Best-effort rollback when audit fails after write.
    }
    throw new CliError(
      `Export audit log failed: ${err instanceof Error ? err.message : String(err)}`,
      2,
    );
  }

  console.log(`Exported ${result.rowCount} rows to ${out}`);
}
