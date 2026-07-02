import fs from "node:fs";
import type { PrismaClient } from "@prisma/client";
import {
  AttendeeExportTooLargeError,
  exportAttendeesCsv,
  writeBulkActionLog,
  type AttendeeListFilterParams,
} from "@admitto/tickets";
import { CliError, arg, hasFlag } from "../lib/args.js";
import { resolveOperatorContext } from "../lib/audit.js";

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

  const filters: AttendeeListFilterParams = {
    status: "all",
    ...(arg("status") === "admitted" || arg("status") === "not_admitted"
      ? { status: arg("status") as "admitted" | "not_admitted" }
      : {}),
    ...(arg("ticket_type") ? { ticket_type: arg("ticket_type") } : {}),
    ...(arg("q") ? { q: arg("q") } : {}),
  };

  if (hasFlag("dry-run")) {
    console.log(`Dry run: would export attendees for event ${eventId} to ${out}`);
    return;
  }

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

  fs.writeFileSync(out, result.csv, "utf8");

  const audit = await resolveOperatorContext(db);
  await db.$transaction(async (tx) => {
    await writeBulkActionLog(tx, {
      event_id: eventId,
      action_type: "attendees_exported",
      audit,
      metadata: {
        format: "csv",
        count: result.rowCount,
        source: "cli",
        filters: {
          status: filters.status,
          ticket_type: filters.ticket_type ?? null,
          has_query: Boolean(filters.q),
        },
      },
    });
  });

  console.log(`Exported ${result.rowCount} rows to ${out}`);
}
