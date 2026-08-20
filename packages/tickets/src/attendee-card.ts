import type { Prisma, PrismaClient } from "@admitto/db";
import { CAPACITY_EXCLUDED_STATUSES } from "@admitto/db/status";
import { parseCustomData } from "./custom-data.js";
import { buildItemDetail } from "./event-item-contents.js";
import { loadEventCustomDataFields } from "./event-custom-fields.js";
import { ensureAttendeeItemStates, operatorItemActions } from "./item-states.js";
import { isAdmittable } from "./admittable.js";
import type { AttendeeCardDto, EventItemConfig, LookupAttendeeResult } from "./types.js";

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

  // Match on name and email only — never company/department (neither the
  // columns nor the custom_data JSON copies). Company-substring matching made
  // "Hitachi" surface both "Hitachi" and "Hitachi Energy", which read as a
  // bug rather than a feature (PO review). Company/department are still shown
  // on each result below, just not used to find one.
  const rows = await prisma.attendee.findMany({
    where: {
      event_id: eventId,
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
      ],
    },
    take: LOOKUP_LIMIT,
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      ticket_type: true,
      custom_data: true,
      company: true,
      department: true,
      admitted_at: true,
      status: true,
    },
  });

  return rows.map((row) => {
    const { company, department } = companyFromAttendee(row);
    return {
      id: row.id,
      name: row.name,
      ticket_type: row.ticket_type,
      company,
      department,
      // Revoked/cancelled passes never read as "admitted" here even with a
      // stale admitted_at — a stale-green "checked in" hint in the typeahead
      // would contradict the red Revoked card the operator sees on select
      // (scanResultFromCard gives the card's `blocked` flag precedence over
      // admitted_at).
      check_in_status:
        row.admitted_at && !(CAPACITY_EXCLUDED_STATUSES as readonly string[]).includes(row.status)
          ? ("admitted" as const)
          : ("not_admitted" as const),
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

  const customFields = await loadEventCustomDataFields(prisma, eventId);
  const customFieldsByKey = new Map(customFields.map((f) => [f.source_field, f]));

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
  // Full email, not the "@"-local-part - splitting it produced misleading labels like "admin"
  // for admin@example.com, which reads as a role rather than an identifier and doesn't match
  // the display_name-then-email fallback the Attendee Detail Notes tab already uses (PO report).
  const authorMap = new Map(
    authors.map((u) => [u.id, u.display_name || u.email || "Operator"]),
  );

  const { company, department } = companyFromAttendee(attendee);
  const blocked = !isAdmittable(attendee.status as "registered" | "confirmed" | "cancelled");

  return {
    id: attendee.id,
    name: attendee.name,
    company,
    department,
    ticket_type: attendee.ticket_type,
    check_in_status: attendee.admitted_at ? "admitted" : "not_admitted",
    admitted_at: attendee.admitted_at?.toISOString() ?? null,
    items: eventItems.map((item) => {
      const state = stateByItem.get(item.id) ?? "pending";
      return {
        key: item.key,
        label: item.label,
        description: item.description ?? null,
        icon: item.icon ?? null,
        state,
        actions: operatorItemActions(state, item.config as EventItemConfig | null),
        detail: buildItemDetail(item.config, attendee.custom_data, customFieldsByKey),
      };
    }),
    notes: notes.map((n) => ({
      body: n.body,
      author_display: authorMap.get(n.author_user_id) ?? "Operator",
      created_at: n.created_at.toISOString(),
    })),
    blocked,
  };
}

/**
 * Door stats over ACTIVE attendees only (#380): revoked/cancelled don't consume
 * capacity and aren't expected at the door, so they're excluded from both
 * counts — same denominator as the Overview KPI (countActiveAttendees).
 */
export async function getCheckInStats(
  eventId: string,
  prisma: PrismaClient,
): Promise<{ admitted_count: number; total_count: number }> {
  const activeWhere = { event_id: eventId, status: { notIn: [...CAPACITY_EXCLUDED_STATUSES] } };
  const [admitted_count, total_count] = await Promise.all([
    prisma.attendee.count({ where: { ...activeWhere, admitted_at: { not: null } } }),
    prisma.attendee.count({ where: activeWhere }),
  ]);
  return { admitted_count, total_count };
}
