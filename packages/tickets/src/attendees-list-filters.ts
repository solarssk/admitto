import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { EMAIL_DELIVERY_SUCCESS_STATUSES } from "@admitto/db/status";

export const ATTENDEE_EXPORT_RSVP_STATUSES = [
  "none",
  "confirmed",
  "declined",
  "tentative",
  "cancelled",
] as const;

export type AttendeeExportRsvpStatus = (typeof ATTENDEE_EXPORT_RSVP_STATUSES)[number];

/** Mail-delivery filter buckets — the list's Mail column shows the LATEST delivery's status
 * per attendee, so these buckets classify that latest status (not "any delivery ever"):
 * `not_sent` = no delivery rows at all, `sent` = accepted/sent/delivered, `pending` = queued,
 * `failed` = failed/bounced/rejected. Buckets rather than the seven raw statuses because
 * that's the operator question ("who never got a mail / whose mail failed"), matching the
 * Overview page's Sent/Pending/Failed email-delivery card. */
export const ATTENDEE_MAIL_STATUS_FILTERS = ["not_sent", "sent", "pending", "failed"] as const;

export type AttendeeMailStatusFilter = (typeof ATTENDEE_MAIL_STATUS_FILTERS)[number];

function mailFilterStatuses(filter: Exclude<AttendeeMailStatusFilter, "not_sent">): readonly string[] {
  switch (filter) {
    case "sent":
      return EMAIL_DELIVERY_SUCCESS_STATUSES;
    case "pending":
      return ["queued"];
    case "failed":
      return ["failed", "bounced", "rejected"];
  }
}

export type AttendeeListFilterParams = {
  q?: string;
  status: "all" | "admitted" | "not_admitted";
  ticket_type?: string;
  rsvp_status?: AttendeeExportRsvpStatus;
  mail_status?: AttendeeMailStatusFilter;
};

/** Whitelisted sortable columns for the attendee list — Ticket sorts by the catalog's curated
 * `TicketType.sort_order` (the same order the ticket-type dropdowns use), not alphabetically. */
export const ATTENDEE_SORT_COLUMNS = [
  "name",
  "ticket_type",
  "company",
  "rsvp_status",
  "status",
  "admitted_at",
] as const;

export type AttendeeSortBy = (typeof ATTENDEE_SORT_COLUMNS)[number];
export type AttendeeSortDir = "asc" | "desc";

export const EXPORT_ROW_CAP = 50_000;

export const EXPORT_ATTENDEE_SELECT = {
  name: true,
  email: true,
  company: true,
  department: true,
  custom_data: true,
  ticket_type: true,
  admitted_at: true,
} as const;

export type AttendeeListSqlRow = {
  id: string;
  name: string;
  email: string;
  company: string | null;
  department: string | null;
  custom_data: unknown;
  ticket_type: string | null;
  status: string;
  admitted_at: Date | null;
  updated_at: Date;
  rsvp_status: string;
};

export type ExportAttendeeSqlRow = {
  name: string;
  email: string;
  company: string | null;
  department: string | null;
  custom_data: unknown;
  ticket_type: string | null;
  admitted_at: Date | null;
};

/** Build Prisma where for attendee list and export (status/ticket_type only — no search). */
export function buildAttendeeListWhere(
  eventId: string,
  params: AttendeeListFilterParams,
): Prisma.AttendeeWhereInput {
  const { status, ticket_type, rsvp_status } = params;
  return {
    event_id: eventId,
    ...(status === "admitted" ? { admitted_at: { not: null } } : {}),
    ...(status === "not_admitted" ? { admitted_at: null } : {}),
    ...(ticket_type ? { ticket_type } : {}),
    ...(rsvp_status ? { rsvp_status } : {}),
  };
}

/** Attendee list ordering, always raw SQL (see findFilteredAttendeesForList) — case-insensitive
 * on `name`/`company` via `LOWER()`, since Postgres's default collation here is case-sensitive
 * (every capitalized name sorts before every lowercase one, e.g. "asdasd" would land after
 * "Dave Brown" instead of next to "Alice Smith"). Nullable sort keys go last regardless of
 * direction, and every branch carries a `LOWER(name)` then `id` tiebreak — name alone isn't
 * unique (two attendees can share a normalized name), and without a final unique key, ties can
 * shuffle across `LIMIT`/`OFFSET` pages. `tt` is only joined in when sortBy is "ticket_type"
 * (see attendeeTicketTypeJoinSql). */
function attendeeOrderBySql(sortBy: AttendeeSortBy, sortDir: AttendeeSortDir): Prisma.Sql {
  const dir = sortDir === "desc" ? Prisma.sql`DESC` : Prisma.sql`ASC`;
  switch (sortBy) {
    case "ticket_type":
      return Prisma.sql`ORDER BY tt.sort_order ${dir} NULLS LAST, LOWER(a.name) ASC, a.id ASC`;
    case "company":
      // Matches resolveCompanyDepartment's precedence (custom_data.company first, then the
      // scalar column) - sorting by the raw column alone would order rows differently than
      // the company value actually shown for them.
      return Prisma.sql`ORDER BY LOWER(COALESCE(a.custom_data->>'company', a.company)) ${dir} NULLS LAST, LOWER(a.name) ASC, a.id ASC`;
    case "admitted_at":
      return Prisma.sql`ORDER BY a.admitted_at ${dir} NULLS LAST, LOWER(a.name) ASC, a.id ASC`;
    case "rsvp_status":
      return Prisma.sql`ORDER BY a.rsvp_status ${dir}, LOWER(a.name) ASC, a.id ASC`;
    case "status":
      return Prisma.sql`ORDER BY a.status ${dir}, LOWER(a.name) ASC, a.id ASC`;
    case "name":
    default:
      return Prisma.sql`ORDER BY LOWER(a.name) ${dir}, a.id ASC`;
  }
}

/** Only join the ticket-type catalog when actually sorting by it — every other sort/search
 * path has no need for it. */
function attendeeTicketTypeJoinSql(sortBy: AttendeeSortBy): Prisma.Sql {
  return sortBy === "ticket_type"
    ? Prisma.sql`LEFT JOIN "TicketType" tt ON tt.event_id = a.event_id AND tt.key = a.ticket_type`
    : Prisma.empty;
}

function attendeeStatusSql(status: AttendeeListFilterParams["status"]) {
  if (status === "admitted") return Prisma.sql`AND a.admitted_at IS NOT NULL`;
  if (status === "not_admitted") return Prisma.sql`AND a.admitted_at IS NULL`;
  return Prisma.empty;
}

function attendeeTicketTypeSql(ticket_type?: string) {
  return ticket_type ? Prisma.sql`AND a.ticket_type = ${ticket_type}` : Prisma.empty;
}

function attendeeRsvpStatusSql(rsvp_status?: AttendeeExportRsvpStatus) {
  return rsvp_status ? Prisma.sql`AND a.rsvp_status = ${rsvp_status}` : Prisma.empty;
}

/** Latest-delivery mail-status filter, as a correlated subquery against "EmailDelivery" —
 * "latest" must match what serializeAttendeeRow displays (newest by created_at, id as a
 * deterministic tiebreak), and a correlated LIMIT 1 expresses that directly where a plain
 * JOIN + IN would match ANY historical delivery. Per-attendee delivery counts are tiny
 * (initial send + a few resends), so the subquery walks a handful of rows per candidate via
 * the (attendee_id, event_id, status) index's leading column. */
function attendeeMailStatusSql(mail_status?: AttendeeMailStatusFilter) {
  if (!mail_status) return Prisma.empty;
  if (mail_status === "not_sent") {
    return Prisma.sql`AND NOT EXISTS (SELECT 1 FROM "EmailDelivery" ed WHERE ed.attendee_id = a.id)`;
  }
  const statuses = mailFilterStatuses(mail_status);
  return Prisma.sql`AND (
    SELECT ed.status FROM "EmailDelivery" ed
    WHERE ed.attendee_id = a.id
    ORDER BY ed.created_at DESC, ed.id DESC
    LIMIT 1
  ) IN (${Prisma.join([...statuses])})`;
}

/** Search OR (columns + custom_data json), inlined in SQL — no id materialization. Empty when
 * there's no search term (the raw-SQL branch also runs, unsearched, for ticket_type sorting). */
function attendeeSearchOrSql(q?: string) {
  if (!q) return Prisma.empty;
  const pattern = `%${q}%`;
  return Prisma.sql`AND (
    a.name ILIKE ${pattern}
    OR a.email ILIKE ${pattern}
    OR a.company ILIKE ${pattern}
    OR a.department ILIKE ${pattern}
    OR (a.custom_data->>'company') ILIKE ${pattern}
    OR (a.custom_data->>'department') ILIKE ${pattern}
  )`;
}

export async function countFilteredAttendees(
  db: PrismaClient,
  eventId: string,
  params: AttendeeListFilterParams,
): Promise<number> {
  const { q, status, ticket_type, rsvp_status, mail_status } = params;
  // The latest-delivery mail filter (like search) has no Prisma-where equivalent — either one
  // routes the count through the raw-SQL branch so it stays in lockstep with the list query.
  if (!q && !mail_status) {
    return db.attendee.count({ where: buildAttendeeListWhere(eventId, params) });
  }
  const [{ count }] = await db.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*)::bigint AS count FROM "Attendee" a
    WHERE a.event_id = ${eventId}
      ${attendeeStatusSql(status)}
      ${attendeeTicketTypeSql(ticket_type)}
      ${attendeeRsvpStatusSql(rsvp_status)}
      ${attendeeMailStatusSql(mail_status)}
      ${attendeeSearchOrSql(q)}
  `;
  return Number(count);
}

export async function findFilteredAttendeesForList(
  db: PrismaClient,
  eventId: string,
  params: AttendeeListFilterParams,
  page: number,
  pageSize: number,
  sortBy: AttendeeSortBy = "name",
  sortDir: AttendeeSortDir = "asc",
): Promise<AttendeeListSqlRow[]> {
  const { q, status, ticket_type, rsvp_status, mail_status } = params;
  const skip = (page - 1) * pageSize;
  return db.$queryRaw<AttendeeListSqlRow[]>`
    SELECT a.id, a.name, a.email, a.company, a.department, a.custom_data, a.ticket_type, a.status, a.admitted_at, a.updated_at, a.rsvp_status
    FROM "Attendee" a
    ${attendeeTicketTypeJoinSql(sortBy)}
    WHERE a.event_id = ${eventId}
      ${attendeeStatusSql(status)}
      ${attendeeTicketTypeSql(ticket_type)}
      ${attendeeRsvpStatusSql(rsvp_status)}
      ${attendeeMailStatusSql(mail_status)}
      ${attendeeSearchOrSql(q)}
    ${attendeeOrderBySql(sortBy, sortDir)}
    LIMIT ${pageSize} OFFSET ${skip}
  `;
}

/** Explicit-selection export — rows for the given ids only, scoped to the event. Ids that
 * don't belong to this event are silently ignored, same convention as bulk delete/check-in
 * (the UI can only select rows already on the current event's current page). */
export async function findSelectedAttendeesForExport(
  db: PrismaClient,
  eventId: string,
  attendeeIds: string[],
): Promise<ExportAttendeeSqlRow[]> {
  if (attendeeIds.length === 0) return [];
  return db.attendee.findMany({
    where: { event_id: eventId, id: { in: attendeeIds } },
    select: EXPORT_ATTENDEE_SELECT,
    orderBy: { name: "asc" },
    take: EXPORT_ROW_CAP,
  });
}

export async function findFilteredAttendeesForExport(
  db: PrismaClient,
  eventId: string,
  params: AttendeeListFilterParams,
): Promise<ExportAttendeeSqlRow[]> {
  const { q, status, ticket_type, rsvp_status, mail_status } = params;
  if (!q && !mail_status) {
    return db.attendee.findMany({
      where: buildAttendeeListWhere(eventId, params),
      select: EXPORT_ATTENDEE_SELECT,
      orderBy: { name: "asc" },
      take: EXPORT_ROW_CAP,
    });
  }
  return db.$queryRaw<ExportAttendeeSqlRow[]>`
    SELECT a.name, a.email, a.company, a.department, a.custom_data, a.ticket_type, a.admitted_at
    FROM "Attendee" a
    WHERE a.event_id = ${eventId}
      ${attendeeStatusSql(status)}
      ${attendeeTicketTypeSql(ticket_type)}
      ${attendeeRsvpStatusSql(rsvp_status)}
      ${attendeeMailStatusSql(mail_status)}
      ${attendeeSearchOrSql(q)}
    ORDER BY a.name ASC
    LIMIT ${EXPORT_ROW_CAP}
  `;
}
