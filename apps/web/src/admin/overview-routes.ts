import type { Context } from "hono";
import type { PrismaClient } from "@admitto/db";
import { resolvePreviewEventTimeZone } from "@admitto/mail-templates";
import { loadEventTicketTypes } from "@admitto/tickets";
import { assertEventManageAccess, requireEventId } from "./admin-helpers.js";
import { countActiveAdmittedAttendees, countActiveAttendees, CAPACITY_EXCLUDED_STATUSES } from "./event-capacity.js";
import { loadRecentImportBatches } from "./import-api-routes.js";

export interface EventContactData {
  id: string;
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
  note: string | null;
  sort_order: number;
}

export interface EventResourceData {
  id: string;
  title: string;
  type: "link" | "file";
  url: string;
  description: string | null;
  sort_order: number;
}

export interface EventOverviewResponse {
  event: {
    id: string;
    title: string;
    slug: string;
    date: string;
    location: string | null;
    capacity: number | null;
    archived_at: string | null;
    organization_id: string;
    timezone: string;
    pinned_note: string | null;
  };
  attendee_count: number;
  admitted_count: number;
  email_sent: number;
  email_failed: number;
  email_bounced: number;
  email_queued: number;
  requirements_count: number;
  /** Active users who can perform check-in: event operators + org admins. */
  checkin_staff_count: number;
  /** Distinct attendees with at least one successful initial ticket delivery. */
  attendees_with_ticket: number;
  /** Most recent still-current admission for this event, or null if nobody is checked in. */
  last_check_in_at: string | null;
  /** Hour-of-day (event timezone) with the most still-current admissions, or null if nobody is
   * checked in. */
  busiest_hour: { hour: string; count: number } | null;
  /** Active attendees per catalog ticket type (batch 04), catalog order, zero-count types omitted. */
  ticket_type_breakdown: Array<{ key: string; label: string; color: string; count: number }>;
  /** Newest-first merged feed of check-ins, mail delivery failures, and import batches. */
  recent_activity: EventRecentActivityEntry[];
  contacts: EventContactData[];
  resources: EventResourceData[];
}

export interface EventRecentActivityEntry {
  id: string;
  type: "checkin" | "mail_bounced" | "mail_failed" | "mail_resent" | "import";
  tone: "ok" | "warn" | "error" | "info" | "muted";
  attendee_name?: string | null;
  /** Links the entry to the attendee's detail view in the admin UI; null for entries with no
   * single attendee (import batches). */
  attendee_id: string | null;
  message: string;
  occurred_at: string;
}

const RECENT_ACTIVITY_LIMIT = 30;

/** Most recent check-in and the busiest hour-of-day among currently-admitted attendees, in the
 * event's timezone. Sourced from Attendee.admitted_at rather than CheckIn: undo.ts/bulk-revoke.ts
 * never delete or update a check-in's own row when an admission is undone/revoked, they only clear
 * admitted_at and append a new UNDO row (CheckIn is an append-only scan log, not current state) -
 * querying CheckIn directly (even with a `status = 'VALID'` filter) would keep counting a
 * since-revoked attendee's original row forever, e.g. "revoke all check-ins" would still show a
 * stale busiest hour/last check-in instead of resetting to none. admitted_at is cleared on
 * undo/revoke, so it always reflects only still-current admissions. Mirrors reports-routes.ts's
 * own byHourRaw peak-hour query, which already sources from Attendee for the same reason (see its
 * comment there) - same naive-UTC double AT TIME ZONE conversion, Attendee.admitted_at is
 * TIMESTAMP(3) same as CheckIn.checked_in_at. */
async function loadCheckInTimingStats(
  db: PrismaClient,
  eventId: string,
  timeZone: string,
): Promise<{ lastCheckInAt: string | null; busiestHour: { hour: string; count: number } | null }> {
  const [lastAdmitted, byHour] = await Promise.all([
    db.attendee.findFirst({
      where: { event_id: eventId, admitted_at: { not: null } },
      orderBy: { admitted_at: "desc" },
      select: { admitted_at: true },
    }),
    db.$queryRaw<Array<{ hour: string; count: bigint }>>`
      SELECT
        TO_CHAR(DATE_TRUNC('hour', (admitted_at AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}), 'HH24:00') AS hour,
        COUNT(*)::bigint AS count
      FROM "Attendee"
      WHERE event_id = ${eventId} AND admitted_at IS NOT NULL
      GROUP BY 1
      ORDER BY 1
    `,
  ]);

  let busiestHour: { hour: string; count: number } | null = null;
  for (const row of byHour) {
    const count = Number(row.count);
    if (!busiestHour || count > busiestHour.count) busiestHour = { hour: row.hour, count };
  }

  return {
    lastCheckInAt: lastAdmitted?.admitted_at?.toISOString() ?? null,
    busiestHour,
  };
}

/** Active attendees per catalog ticket type - same catalog/active-attendee scope as
 * ticket_type_breakdown's callers use elsewhere (reports-routes.ts, attendees list), just
 * omitting zero-count types instead of the "(none)"/unmatched-key trailing rows reports adds. */
async function loadTicketTypeBreakdown(
  db: PrismaClient,
  eventId: string,
): Promise<EventOverviewResponse["ticket_type_breakdown"]> {
  const [catalog, counts] = await Promise.all([
    loadEventTicketTypes(db, eventId),
    db.attendee.groupBy({
      by: ["ticket_type"],
      where: { event_id: eventId, status: { notIn: [...CAPACITY_EXCLUDED_STATUSES] } },
      _count: { _all: true },
    }),
  ]);
  const countByKey = new Map(counts.map((c) => [c.ticket_type, c._count._all]));
  return catalog
    .map((t) => ({ key: t.key, label: t.label, color: t.color, count: countByKey.get(t.key) ?? 0 }))
    .filter((t) => t.count > 0);
}

async function loadRecentCheckInActivity(db: PrismaClient, eventId: string): Promise<EventRecentActivityEntry[]> {
  const rows = await db.checkIn.findMany({
    where: { event_id: eventId, status: "VALID" },
    orderBy: { checked_in_at: "desc" },
    take: RECENT_ACTIVITY_LIMIT,
    select: { id: true, checked_in_at: true, attendee_id: true, attendee: { select: { name: true } } },
  });
  return rows.map((row) => ({
    id: `checkin:${row.id}`,
    type: "checkin",
    tone: "ok",
    attendee_name: row.attendee.name,
    attendee_id: row.attendee_id,
    message: "checked in",
    occurred_at: row.checked_in_at.toISOString(),
  }));
}

/** "bounced" has no dedicated timestamp column (no send path sets it yet - reserved for a future
 * delivery-status webhook), so failed_at (set for "failed"/"rejected") falls back to updated_at. */
async function loadRecentMailFailureActivity(
  db: PrismaClient,
  eventId: string,
): Promise<EventRecentActivityEntry[]> {
  const rows = await db.emailDelivery.findMany({
    where: { event_id: eventId, status: { in: ["failed", "bounced", "rejected"] } },
    orderBy: { updated_at: "desc" },
    take: RECENT_ACTIVITY_LIMIT,
    select: {
      id: true,
      status: true,
      recipient_email: true,
      failed_at: true,
      updated_at: true,
      attendee_id: true,
      attendee: { select: { name: true, email: true } },
    },
  });
  return rows.map((row) => {
    const bounced = row.status === "bounced";
    const email = row.recipient_email ?? row.attendee.email;
    return {
      id: `mail:${row.id}`,
      type: bounced ? "mail_bounced" : "mail_failed",
      tone: "error",
      attendee_name: row.attendee.name,
      attendee_id: row.attendee_id,
      message: `Ticket email ${bounced ? "bounced" : "failed"} for ${email}`,
      occurred_at: (row.failed_at ?? row.updated_at).toISOString(),
    };
  });
}

async function loadRecentImportActivity(db: PrismaClient, eventId: string): Promise<EventRecentActivityEntry[]> {
  const entries = await loadRecentImportBatches(db, eventId, RECENT_ACTIVITY_LIMIT);
  return entries.map((entry) => {
    const total = entry.created + entry.updated;
    return {
      id: `import:${entry.id}`,
      type: "import",
      tone: "muted",
      attendee_id: null,
      message: `${total} attendee${total === 1 ? "" : "s"} imported`,
      occurred_at: entry.created_at,
    };
  });
}

/** Merges the three activity sources newest-first and caps the total. Taking up to
 * RECENT_ACTIVITY_LIMIT from each source (already sorted newest-first) before merging is
 * sufficient for a correct top-N merge - the final slice can never need more than N items from
 * any single source. */
async function loadRecentActivity(db: PrismaClient, eventId: string): Promise<EventRecentActivityEntry[]> {
  const [checkins, mailFailures, imports] = await Promise.all([
    loadRecentCheckInActivity(db, eventId),
    loadRecentMailFailureActivity(db, eventId),
    loadRecentImportActivity(db, eventId),
  ]);
  return [...checkins, ...mailFailures, ...imports]
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
    .slice(0, RECENT_ACTIVITY_LIMIT);
}

/** GET /api/admin/events/:eventId/overview — aggregated dashboard stats (read-only, no audit). */
export async function handleGetEventOverview(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdParam = requireEventId(c);
  if (eventIdParam instanceof Response) return eventIdParam;
  const eventId = eventIdParam;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const event = await db.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      title: true,
      slug: true,
      date: true,
      timezone: true,
      location: true,
      capacity: true,
      archived_at: true,
      organization_id: true,
      pinned_note: true,
    },
  });
  if (!event) return c.json({ error: "not_found" }, 404);

  const timeZone = resolvePreviewEventTimeZone(event.timezone);

  const [
    activeAttendeeCount,
    activeAdmittedCount,
    deliveryStats,
    requirementsCount,
    checkinStaffCount,
    attendeesWithTicketRows,
    contacts,
    resources,
    checkInTimingStats,
    ticketTypeBreakdown,
    recentActivity,
  ] = await Promise.all([
    countActiveAttendees(db, eventId),
    countActiveAdmittedAttendees(db, eventId),
    db.emailDelivery.groupBy({
      by: ["status"],
      where: { event_id: eventId },
      _count: { id: true },
    }),
    db.eventItem.count({ where: { event_id: eventId, enabled: true } }),
    // Count active users who can perform check-in: event-scope operators + org-scope admins.
    db.roleAssignment.count({
      where: {
        OR: [
          {
            role: "operator",
            scope_type: "event",
            scope_id: eventId,
            user: { is_active: true },
          },
          {
            role: "admin",
            scope_type: "organization",
            scope_id: event.organization_id,
            user: { is_active: true },
          },
        ],
      },
    }),
    // Distinct *active* attendees with at least one successful initial ticket delivery.
    db.emailDelivery.groupBy({
      by: ["attendee_id"],
      where: {
        event_id: eventId,
        purpose: "initial",
        status: { in: ["accepted", "sent", "delivered"] },
        attendee: { status: { notIn: [...CAPACITY_EXCLUDED_STATUSES] } },
      },
      _count: { id: true },
    }),
    db.eventContact.findMany({
      where: { event_id: eventId },
      orderBy: [{ sort_order: "asc" }, { created_at: "asc" }],
      select: { id: true, name: true, role: true, phone: true, email: true, note: true, sort_order: true },
    }),
    db.eventResource.findMany({
      where: { event_id: eventId },
      orderBy: [{ sort_order: "asc" }, { created_at: "asc" }],
      select: { id: true, title: true, type: true, url: true, description: true, sort_order: true },
    }),
    loadCheckInTimingStats(db, eventId, timeZone),
    loadTicketTypeBreakdown(db, eventId),
    loadRecentActivity(db, eventId),
  ]);

  const emailByStatus = Object.fromEntries(
    deliveryStats.map((g) => [g.status, g._count.id]),
  );
  const emailSent =
    (emailByStatus["accepted"] ?? 0) +
    (emailByStatus["sent"] ?? 0) +
    (emailByStatus["delivered"] ?? 0);
  const emailBounced = emailByStatus["bounced"] ?? 0;
  const emailFailed =
    (emailByStatus["failed"] ?? 0) +
    (emailByStatus["rejected"] ?? 0);
  const emailQueued = emailByStatus["queued"] ?? 0;

  const body: EventOverviewResponse = {
    event: {
      id: event.id,
      title: event.title,
      slug: event.slug,
      date: event.date.toISOString(),
      timezone: event.timezone,
      location: event.location,
      capacity: event.capacity,
      archived_at: event.archived_at?.toISOString() ?? null,
      organization_id: event.organization_id,
      pinned_note: event.pinned_note,
    },
    attendee_count: activeAttendeeCount,
    admitted_count: activeAdmittedCount,
    email_sent: emailSent,
    email_failed: emailFailed,
    email_bounced: emailBounced,
    email_queued: emailQueued,
    requirements_count: requirementsCount,
    checkin_staff_count: checkinStaffCount,
    attendees_with_ticket: attendeesWithTicketRows.length,
    last_check_in_at: checkInTimingStats.lastCheckInAt,
    busiest_hour: checkInTimingStats.busiestHour,
    ticket_type_breakdown: ticketTypeBreakdown,
    recent_activity: recentActivity,
    contacts,
    resources,
  };

  return c.json(body);
}
