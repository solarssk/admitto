import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

export const ATTENDEE_EXPORT_RSVP_STATUSES = [
  "none",
  "confirmed",
  "declined",
  "tentative",
  "cancelled",
] as const;

export type AttendeeExportRsvpStatus = (typeof ATTENDEE_EXPORT_RSVP_STATUSES)[number];

export type AttendeeListFilterParams = {
  q?: string;
  status: "all" | "admitted" | "not_admitted";
  ticket_type?: string;
  rsvp_status?: AttendeeExportRsvpStatus;
};

export const EXPORT_ROW_CAP = 50_000;

const ATTENDEE_LIST_SELECT = {
  id: true,
  name: true,
  email: true,
  company: true,
  department: true,
  custom_data: true,
  ticket_type: true,
  status: true,
  admitted_at: true,
  updated_at: true,
  rsvp_status: true,
} as const;

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

function attendeeStatusSql(status: AttendeeListFilterParams["status"]) {
  if (status === "admitted") return Prisma.sql`AND admitted_at IS NOT NULL`;
  if (status === "not_admitted") return Prisma.sql`AND admitted_at IS NULL`;
  return Prisma.empty;
}

function attendeeTicketTypeSql(ticket_type?: string) {
  return ticket_type ? Prisma.sql`AND ticket_type = ${ticket_type}` : Prisma.empty;
}

function attendeeRsvpStatusSql(rsvp_status?: AttendeeExportRsvpStatus) {
  return rsvp_status ? Prisma.sql`AND rsvp_status = ${rsvp_status}` : Prisma.empty;
}

/** Search OR (columns + custom_data json), inlined in SQL — no id materialization. */
function attendeeSearchOrSql(q: string) {
  const pattern = `%${q}%`;
  return Prisma.sql`AND (
    name ILIKE ${pattern}
    OR email ILIKE ${pattern}
    OR company ILIKE ${pattern}
    OR department ILIKE ${pattern}
    OR (custom_data->>'company') ILIKE ${pattern}
    OR (custom_data->>'department') ILIKE ${pattern}
  )`;
}

export async function countFilteredAttendees(
  db: PrismaClient,
  eventId: string,
  params: AttendeeListFilterParams,
): Promise<number> {
  const { q, status, ticket_type, rsvp_status } = params;
  if (!q) {
    return db.attendee.count({ where: buildAttendeeListWhere(eventId, params) });
  }
  const [{ count }] = await db.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*)::bigint AS count FROM "Attendee"
    WHERE event_id = ${eventId}
      ${attendeeStatusSql(status)}
      ${attendeeTicketTypeSql(ticket_type)}
      ${attendeeRsvpStatusSql(rsvp_status)}
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
): Promise<AttendeeListSqlRow[]> {
  const { q, status, ticket_type, rsvp_status } = params;
  if (!q) {
    return db.attendee.findMany({
      where: buildAttendeeListWhere(eventId, params),
      select: ATTENDEE_LIST_SELECT,
      orderBy: { name: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
  }
  const skip = (page - 1) * pageSize;
  return db.$queryRaw<AttendeeListSqlRow[]>`
    SELECT id, name, email, company, department, custom_data, ticket_type, status, admitted_at, updated_at, rsvp_status
    FROM "Attendee"
    WHERE event_id = ${eventId}
      ${attendeeStatusSql(status)}
      ${attendeeTicketTypeSql(ticket_type)}
      ${attendeeRsvpStatusSql(rsvp_status)}
      ${attendeeSearchOrSql(q)}
    ORDER BY name ASC
    LIMIT ${pageSize} OFFSET ${skip}
  `;
}

export async function findFilteredAttendeesForExport(
  db: PrismaClient,
  eventId: string,
  params: AttendeeListFilterParams,
): Promise<ExportAttendeeSqlRow[]> {
  const { q, status, ticket_type, rsvp_status } = params;
  if (!q) {
    return db.attendee.findMany({
      where: buildAttendeeListWhere(eventId, params),
      select: EXPORT_ATTENDEE_SELECT,
      orderBy: { name: "asc" },
      take: EXPORT_ROW_CAP,
    });
  }
  return db.$queryRaw<ExportAttendeeSqlRow[]>`
    SELECT name, email, company, department, custom_data, ticket_type, admitted_at
    FROM "Attendee"
    WHERE event_id = ${eventId}
      ${attendeeStatusSql(status)}
      ${attendeeTicketTypeSql(ticket_type)}
      ${attendeeRsvpStatusSql(rsvp_status)}
      ${attendeeSearchOrSql(q)}
    ORDER BY name ASC
    LIMIT ${EXPORT_ROW_CAP}
  `;
}
