import type { PrismaClient } from "@prisma/client";
import { admitAttendee, lookupAttendees, resolveTicket } from "@admitto/tickets";
import { CliError, arg, hasFlag, parseFormat } from "../lib/args.js";
import { formatJson, formatTable, printError } from "../lib/output.js";
import { resolveOperatorContext } from "../lib/audit.js";

/**
 * Archiving fully locks down check-in (admin UI and API alike) — the CLI shares the same
 * domain functions as the HTTP routes, so it needs its own guard rather than relying on
 * `assertEventNotArchived`, which builds an HTTP `Response` and isn't usable outside a route.
 */
async function assertEventNotArchivedCli(db: PrismaClient, eventId: string): Promise<void> {
  const event = await db.event.findUnique({ where: { id: eventId }, select: { archived_at: true } });
  if (event?.archived_at) {
    throw new CliError("This event is archived. Check-in is disabled.");
  }
}

export async function runCheckinLookup(db: PrismaClient): Promise<void> {
  const eventId = arg("event");
  const query = arg("query");
  if (!eventId || !query) {
    throw new CliError("Usage: admitto checkin lookup --event <id> --query <text>");
  }
  await assertEventNotArchivedCli(db, eventId);

  const rows = await lookupAttendees(eventId, query, db);
  const format = parseFormat();
  const mapped = rows.map((r) => ({
    attendeeId: r.id,
    name: r.name,
    ticketType: r.ticket_type ?? "",
    company: r.company ?? "",
    department: r.department ?? "",
    checkInStatus: r.check_in_status,
  }));

  if (format === "json") {
    console.log(formatJson(mapped));
    return;
  }
  console.log(formatTable(mapped));
}

export async function runCheckinAdmit(db: PrismaClient): Promise<void> {
  const eventId = arg("event");
  const attendeeIdArg = arg("attendee-id");
  const scan = arg("scan");
  const notes = arg("notes");
  if (!eventId || (!attendeeIdArg && !scan)) {
    throw new CliError(
      "Usage: admitto checkin admit --event <id> (--attendee-id <id> | --scan <url-or-token>) [--notes ...]",
    );
  }
  await assertEventNotArchivedCli(db, eventId);

  if (hasFlag("dry-run")) {
    console.log("Dry run: would admit attendee (no write).");
    return;
  }

  const format = parseFormat();
  const audit = await resolveOperatorContext(db);
  let attendeeId = attendeeIdArg;

  if (scan) {
    const resolved = await resolveTicket(scan, db, { eventId });
    if (!resolved) {
      throw new CliError("Scan did not resolve to an attendee for this event.");
    }
    if (resolved.event.id !== eventId) {
      throw new CliError("Resolved attendee belongs to a different event.");
    }
    attendeeId = resolved.attendee.id;
  }

  const result = await admitAttendee(
    {
      attendeeId: attendeeId!,
      eventId,
      method: scan ? "scan" : "manual",
      audit,
      notes,
    },
    db,
  );

  const payload = {
    status: result.status,
    confirmed: result.confirmed,
    attendeeId,
    eventId,
  };
  if (format === "json") {
    console.log(formatJson(payload));
    if (result.status !== "VALID" && result.status !== "ALREADY_CHECKED_IN") {
      process.exitCode = 1;
    }
    return;
  }

  if (result.status === "VALID") {
    console.log(`Admitted ${attendeeId} (${result.status}).`);
  } else if (result.status === "ALREADY_CHECKED_IN") {
    console.log(`Already checked in: ${attendeeId}.`);
  } else {
    printError(`Check-in result: ${result.status}`);
    process.exitCode = 1;
  }
}
