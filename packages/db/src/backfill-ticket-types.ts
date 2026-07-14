import type { PrismaClient } from "@prisma/client";

const TICKET_TYPE_KEY_MAX_LENGTH = 60;
const TICKET_TYPE_LABEL_MAX_LENGTH = 60;

/** Mirrors apps/admin/src/requirements/itemKey.ts's slugifyItemKey - duplicated rather than
 * imported because packages/db can't depend on apps/admin. Keep in sync by hand if that changes. */
function slugifyTicketTypeKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .slice(0, TICKET_TYPE_KEY_MAX_LENGTH);
}

function uniqueTicketTypeKey(label: string, usedKeys: Set<string>, fallbackIndex: number): string {
  const base = slugifyTicketTypeKey(label) || `type_${fallbackIndex}`;
  if (!usedKeys.has(base)) return base;
  for (let n = 2; n < 100; n++) {
    const suffix = `_${n}`;
    const candidate = `${base.slice(0, Math.max(1, TICKET_TYPE_KEY_MAX_LENGTH - suffix.length))}${suffix}`;
    if (!usedKeys.has(candidate)) return candidate;
  }
  return `${base}_${fallbackIndex}`;
}

/**
 * Idempotent backfill: pre-catalog events have `Attendee.ticket_type` as free text (`VIP`/`vip`/
 * `Vip` all distinct strings). For every event with zero `TicketType` rows, groups its attendees'
 * `ticket_type` values case-insensitively, creates one canonical `TicketType` per group (`"vip"`
 * -> purple, everything else -> gray - preserves today's only special-cased color with zero visual
 * regression), then rewrites every `Attendee.ticket_type` in that event to the winning group's
 * canonical key so future exact-match filtering (packages/tickets/src/attendees-list-filters.ts)
 * keeps working unchanged. Events with no non-null `ticket_type` values (including brand-new
 * events with no attendees yet) get a single default "Standard" (gray) entry instead of an empty
 * catalog, matching the seed a newly-created event gets going forward. Runs automatically after
 * `npm run db:migrate`; safe to re-run manually - an event that already has `TicketType` rows is
 * left untouched.
 */
export async function backfillTicketTypes(prisma: PrismaClient): Promise<{
  eventsSeeded: number;
  typesCreated: number;
  attendeesNormalized: number;
}> {
  const events = await prisma.event.findMany({
    where: { ticket_types: { none: {} } },
    select: { id: true },
    orderBy: { created_at: "asc" },
  });

  let eventsSeeded = 0;
  let typesCreated = 0;
  let attendeesNormalized = 0;

  for (const event of events) {
    const attendees = await prisma.attendee.findMany({
      where: { event_id: event.id, ticket_type: { not: null } },
      select: { id: true, ticket_type: true },
    });

    // Group case-insensitively; first-seen casing within the event wins as the display label.
    const groups = new Map<string, { label: string; attendeeIds: string[] }>();
    for (const attendee of attendees) {
      const raw = (attendee.ticket_type ?? "").trim();
      if (!raw) continue;
      const norm = raw.toLowerCase();
      let group = groups.get(norm);
      if (!group) {
        group = { label: raw, attendeeIds: [] };
        groups.set(norm, group);
      }
      group.attendeeIds.push(attendee.id);
    }

    // Wrapped in a transaction so a mid-event crash can't leave a partially migrated event
    // behind - the idempotency check above (`ticket_types: { none: {} } `) would then skip it
    // forever on re-run, since it already has at least one TicketType row (CodeRabbit review).
    await prisma.$transaction(async (tx) => {
      if (groups.size === 0) {
        await tx.ticketType.create({
          data: { event_id: event.id, key: "standard", label: "Standard", color: "gray", sort_order: 0 },
        });
        typesCreated += 1;
        return;
      }

      const usedKeys = new Set<string>();
      let sortOrder = 0;
      for (const [norm, group] of groups) {
        const key = uniqueTicketTypeKey(norm, usedKeys, sortOrder + 1);
        usedKeys.add(key);
        const label = group.label.slice(0, TICKET_TYPE_LABEL_MAX_LENGTH);
        const color = norm === "vip" ? "purple" : "gray";
        await tx.ticketType.create({
          data: { event_id: event.id, key, label, color, sort_order: sortOrder },
        });
        typesCreated += 1;
        sortOrder += 1;

        const { count } = await tx.attendee.updateMany({
          where: { id: { in: group.attendeeIds }, ticket_type: { not: key } },
          data: { ticket_type: key },
        });
        attendeesNormalized += count;
      }
    });
    eventsSeeded += 1;
  }

  return { eventsSeeded, typesCreated, attendeesNormalized };
}
