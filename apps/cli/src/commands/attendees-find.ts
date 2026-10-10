import type { PrismaClient } from "@admitto/db";
import { CliError, arg, parseFormat } from "../lib/args.js";
import { formatJson, formatTable, printError } from "../lib/output.js";

const USAGE = 'Usage: admitto attendees find --query "<name or email>" [--event <id>] [--format table|json]';
/** The same number the check-in lookup lists: more than that is a query to narrow, not a list to page through. */
const FIND_LIMIT = 20;

export function parseAttendeesFindArgs(argv: string[] = process.argv): {
  eventId: string | undefined;
  query: string;
  format: "table" | "json";
} {
  const query = arg("query", argv)?.trim();
  if (!query) throw new CliError(USAGE);
  return { eventId: arg("event", argv), query, format: parseFormat(argv) };
}

/**
 * `admitto attendees find`: the ids a privacy request needs for `attendees erase`, read-only. It lists the people whose
 * name or address contains the text (the same two fields the check-in lookup matches) with the event they are in, so
 * that a request that names only a person finds the event id too, and with their address, so that two people with one
 * name can be told apart. `--event` looks in one event only. People who are already erased are not listed: they hold
 * nothing to find.
 *
 * It is not `checkin lookup`, which refuses an archived event (check-in is locked there), because an archived event's
 * attendees can still be erased, and the ids must be findable there too: this command has no archived-event guard.
 */
export async function runAttendeesFind(db: PrismaClient, argv: string[] = process.argv): Promise<void> {
  const { eventId, query, format } = parseAttendeesFindArgs(argv);
  if (eventId && !(await db.event.findUnique({ where: { id: eventId }, select: { id: true } }))) {
    throw new CliError("Event not found.");
  }

  // One more than is listed, to know whether the list was cut short.
  const found = await db.attendee.findMany({
    where: {
      ...(eventId ? { event_id: eventId } : {}),
      erased_at: null,
      OR: [{ name: { contains: query, mode: "insensitive" } }, { email: { contains: query, mode: "insensitive" } }],
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: FIND_LIMIT + 1,
    select: { id: true, event_id: true, event: { select: { title: true } }, name: true, email: true, ticket_type: true },
  });
  const rows = found.slice(0, FIND_LIMIT).map((row) => ({
    eventId: row.event_id,
    event: row.event.title,
    attendeeId: row.id,
    name: row.name,
    email: row.email,
    ticketType: row.ticket_type ?? "",
  }));

  console.log(format === "json" ? formatJson(rows) : formatTable(rows));
  if (rows.length === 0) {
    printError(`No attendee ${eventId ? "of this event " : ""}matches. People who are already erased are not listed.`);
  } else if (found.length > FIND_LIMIT) {
    printError(`Only the first ${FIND_LIMIT} matches are listed. Narrow the query, for example to the whole address.`);
  }
}
