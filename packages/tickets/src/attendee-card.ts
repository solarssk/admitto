import type { Prisma, PrismaClient } from "@prisma/client";
import { parseCustomData, shirtSizeFromCustomData } from "./custom-data.js";
import { ensureAttendeeItemStates, operatorItemActions } from "./item-states.js";
import { isAdmittable } from "./admittable.js";
import type { AttendeeCardDto, LookupAttendeeResult } from "./types.js";

type DbClient = PrismaClient | Prisma.TransactionClient;

const CARD_NOTES_LIMIT = 5;
const LOOKUP_LIMIT = 20;

function companyFromAttendee(row: {
  custom_data: unknown;
  company: string | null;
  department: string | null;
}): { company: string | null; department: string | null } {
  const cd = parseCustomData(row.custom_data);
  return {
    company: cd.company ?? row.company,
    department: cd.department ?? row.department,
  };
}

export async function lookupAttendees(
  eventId: string,
  query: string,
  prisma: PrismaClient,
): Promise<LookupAttendeeResult[]> {
  const q = query.trim();
  if (!q) return [];

  const select = {
    id: true,
    name: true,
    ticket_type: true,
    custom_data: true,
    company: true,
    department: true,
    admitted_at: true,
  } as const;

  const [columnRows, jsonMatches] = await Promise.all([
    prisma.attendee.findMany({
      where: {
        event_id: eventId,
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          { company: { contains: q, mode: "insensitive" } },
          { department: { contains: q, mode: "insensitive" } },
        ],
      },
      take: LOOKUP_LIMIT,
      orderBy: { name: "asc" },
      select,
    }),
    prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Attendee"
      WHERE event_id = ${eventId}
        AND (
          (custom_data->>'company') ILIKE ${`%${q}%`}
          OR (custom_data->>'department') ILIKE ${`%${q}%`}
        )
      LIMIT ${LOOKUP_LIMIT}
    `,
  ]);

  const seen = new Set(columnRows.map((r) => r.id));
  const extraIds = jsonMatches.map((r) => r.id).filter((id) => !seen.has(id));
  const extraRows =
    extraIds.length > 0
      ? await prisma.attendee.findMany({
          where: { id: { in: extraIds }, event_id: eventId },
          select,
        })
      : [];

  const rows = [...columnRows, ...extraRows]
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, LOOKUP_LIMIT);

  return rows.map((row) => {
    const { company, department } = companyFromAttendee(row);
    return {
      id: row.id,
      name: row.name,
      ticket_type: row.ticket_type,
      company,
      department,
      check_in_status: row.admitted_at ? ("admitted" as const) : ("not_admitted" as const),
    };
  });
}

export async function getAttendeeCard(
  eventId: string,
  attendeeId: string,
  prisma: DbClient,
): Promise<AttendeeCardDto | null> {
  const attendee = await prisma.attendee.findFirst({
    where: { id: attendeeId, event_id: eventId },
    select: {
      id: true,
      name: true,
      ticket_type: true,
      status: true,
      admitted_at: true,
      custom_data: true,
      company: true,
      department: true,
    },
  });
  if (!attendee) return null;

  await ensureAttendeeItemStates(attendeeId, eventId, prisma);

  const eventItems = await prisma.eventItem.findMany({
    where: { event_id: eventId, enabled: true },
    orderBy: { key: "asc" },
  });

  const states = await prisma.attendeeItemState.findMany({
    where: { attendee_id: attendeeId, event_item_id: { in: eventItems.map((i) => i.id) } },
  });
  const stateByItem = new Map(states.map((s) => [s.event_item_id, s.state]));

  const notes = await prisma.attendeeNote.findMany({
    where: { attendee_id: attendeeId, event_id: eventId },
    orderBy: { created_at: "desc" },
    take: CARD_NOTES_LIMIT,
  });

  const authorIds = [...new Set(notes.map((n) => n.author_user_id))];
  const authors =
    authorIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: authorIds } },
          select: { id: true, display_name: true, email: true },
        })
      : [];
  const authorMap = new Map(
    authors.map((u) => [u.id, u.display_name || u.email.split("@")[0] || "Operator"]),
  );

  const { company, department } = companyFromAttendee(attendee);
  const warnings: string[] = [];
  if (!isAdmittable(attendee.status as "registered" | "confirmed" | "cancelled")) {
    warnings.push("Ticket is not admittable (cancelled or revoked).");
  }

  const shirtSize = shirtSizeFromCustomData(attendee.custom_data);

  return {
    id: attendee.id,
    name: attendee.name,
    company,
    department,
    ticket_type: attendee.ticket_type,
    check_in_status: attendee.admitted_at ? "admitted" : "not_admitted",
    admitted_at: attendee.admitted_at?.toISOString() ?? null,
    shirt_size: shirtSize,
    items: eventItems.map((item) => {
      const state = stateByItem.get(item.id) ?? "pending";
      return {
        key: item.key,
        label: item.label,
        state,
        actions: operatorItemActions(state),
        detail:
          item.key === "giftbag" && shirtSize ? `Shirt size: ${shirtSize}` : undefined,
      };
    }),
    notes: notes.map((n) => ({
      body: n.body,
      author_display: authorMap.get(n.author_user_id) ?? "Operator",
      created_at: n.created_at.toISOString(),
    })),
    warnings,
  };
}

export async function getCheckInStats(
  eventId: string,
  prisma: PrismaClient,
): Promise<{ admitted_count: number }> {
  const admitted_count = await prisma.attendee.count({
    where: { event_id: eventId, admitted_at: { not: null } },
  });
  return { admitted_count };
}
