import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

const TICKET_TYPE_KEY_MAX_LENGTH = 60;
const TICKET_TYPE_LABEL_MAX_LENGTH = 60;

/** Per-event transaction budget - the advisory-lock wait (if blocked behind a concurrent replica
 * on a rolling deploy) and the attendee updateMany both count against this, same rationale/naming
 * as apps/web/src/admin/import-api-routes.ts's IMPORT_TX_TIMEOUT_MS/IMPORT_TX_MAX_WAIT_MS. Kept
 * well under the deploy entrypoint's `timeout 120` so multiple events can each get a turn. */
const BACKFILL_TX_TIMEOUT_MS = 60_000;
const BACKFILL_TX_MAX_WAIT_MS = 10_000;

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

/** Mirrors packages/tickets/src/ticket-types.ts's uniqueTicketTypeKey fallback behavior (constant
 * "type" base, Date.now()-suffixed final collision fallback) so the same conceptually-empty label
 * produces the same key whether it's migrated here or created later via the admin UI. Per-event
 * uniqueness is tracked via `usedKeys` instead of that file's `existingKeys` array, since this
 * loop processes one event's groups at a time. */
function uniqueTicketTypeKey(label: string, usedKeys: Set<string>): string {
  const base = slugifyTicketTypeKey(label) || "type";
  if (!usedKeys.has(base)) return base;
  for (let n = 2; n < 100; n++) {
    const suffix = `_${n}`;
    const candidate = `${base.slice(0, Math.max(1, TICKET_TYPE_KEY_MAX_LENGTH - suffix.length))}${suffix}`;
    if (!usedKeys.has(candidate)) return candidate;
  }
  return `${base}_${Date.now()}`;
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
      // Explicit order so "first-seen" (below) is well-defined: without one, SQL row order is
      // unspecified, and Postgres could satisfy this event_id predicate via one of Attendee's
      // event_id-leading unique indexes (email/external_uuid/qr_payload) instead of a table scan,
      // silently reordering rows. `id` breaks ties when multiple attendees share a created_at -
      // e.g. a same-transaction bulk import (packages/import) via createMany, which lets every
      // row fall back to the same DB-side CURRENT_TIMESTAMP default.
      orderBy: [{ created_at: "asc" }, { id: "asc" }],
    });

    // Group case-insensitively; first-seen casing within the event wins as the display label.
    // Whitespace-only values (e.g. "   ") never join a group - blank isn't a real ticket type -
    // but are collected separately so they can be normalized to actual `null` below, matching how
    // packages/import/src/parser.ts treats an empty/whitespace CSV cell for this same column.
    const groups = new Map<string, { label: string; attendeeIds: string[] }>();
    const blankIds: string[] = [];
    for (const attendee of attendees) {
      const raw = (attendee.ticket_type ?? "").trim();
      if (!raw) {
        blankIds.push(attendee.id);
        continue;
      }
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
    const migrated = await prisma.$transaction(
      async (tx) => {
        // Serialize against any other process touching this event's ticket-type catalog - a
        // concurrent replica of this same script on a rolling deploy, or an API route - same lock
        // key/format as packages/tickets/src/ticket-types.ts's acquireEventTicketTypesLock,
        // inlined here since packages/db can't import from packages/tickets. Transaction-scoped,
        // so it auto-releases on commit/rollback.
        const lockKey = `ticket-types:${event.id}`;
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);

        // `groups`/`blankIds` were computed from a read done *before* this lock was acquired, so
        // a process that was blocked here (another replica won the race and already committed)
        // must re-check idempotency now, under the lock, before writing anything - otherwise it
        // would still try to create the same (event_id, key) rows and hit the unique constraint.
        // Returns false in that case so the caller doesn't count this event as seeded twice.
        const alreadyMigrated = await tx.ticketType.count({ where: { event_id: event.id } });
        if (alreadyMigrated > 0) return false;

        if (groups.size === 0) {
          await tx.ticketType.create({
            data: { event_id: event.id, key: "standard", label: "Standard", color: "gray", sort_order: 0 },
          });
          typesCreated += 1;
        } else {
          const usedKeys = new Set<string>();
          let sortOrder = 0;
          for (const [norm, group] of groups) {
            const key = uniqueTicketTypeKey(norm, usedKeys);
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
        }

        if (blankIds.length > 0) {
          const { count } = await tx.attendee.updateMany({
            where: { id: { in: blankIds } },
            data: { ticket_type: null },
          });
          attendeesNormalized += count;
        }

        return true;
      },
      { timeout: BACKFILL_TX_TIMEOUT_MS, maxWait: BACKFILL_TX_MAX_WAIT_MS },
    );
    if (migrated) eventsSeeded += 1;
  }

  return { eventsSeeded, typesCreated, attendeesNormalized };
}
