import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";
import { assertEventManageAccess, requireEventId } from "./admin-helpers.js";
import { countActiveAdmittedAttendees, countActiveAttendees, CAPACITY_EXCLUDED_STATUSES } from "./event-capacity.js";

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
  contacts: EventContactData[];
  resources: EventResourceData[];
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

  const [
    activeAttendeeCount,
    activeAdmittedCount,
    deliveryStats,
    requirementsCount,
    checkinStaffCount,
    attendeesWithTicketRows,
    contacts,
    resources,
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
    contacts,
    resources,
  };

  return c.json(body);
}
