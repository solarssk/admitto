import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

type TicketTypeDb = PrismaClient | Prisma.TransactionClient;

export interface TicketTypeInfo {
  id: string;
  key: string;
  label: string;
  color: string;
  sort_order: number;
}

const DEFAULT_TICKET_TYPE = { key: "standard", label: "Standard", color: "gray" } as const;

/** Public constant for the auto-seeded "standard" ticket-type key — reuse instead of the literal. */
export const STANDARD_TICKET_TYPE_KEY = DEFAULT_TICKET_TYPE.key;

/** The 8 curated colors a ticket type may use - kept in sync by hand with
 * packages/ui/src/components/TicketTypeBadge.tsx's TICKET_TYPE_COLORS (this list is just the
 * valid keys, for server-side validation; the UI package owns the actual solid/tint CSS values
 * and isn't importable here - apps/web doesn't depend on the browser-only @admitto/ui package). */
export const TICKET_TYPE_COLOR_KEYS = [
  "gray",
  "blue",
  "green",
  "yellow",
  "red",
  "azure",
  "teal",
  "purple",
] as const;
export type TicketTypeColor = (typeof TICKET_TYPE_COLOR_KEYS)[number];

const KEY_MAX_LENGTH = 60;

/** Mirrors apps/admin/src/requirements/itemKey.ts's slugifyItemKey/uniqueItemKey - the one place
 * both packages/db's backfill script (which can't depend on @admitto/tickets) and apps/web's
 * ticket-types-routes.ts (which can) need the same slugification; apps/web imports this instead
 * of duplicating it, packages/db keeps its own copy per the same reasoning as
 * RESERVED_CUSTOM_DATA_SOURCE_FIELDS in custom-data-reserved.ts. */
export function slugifyTicketTypeKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+/, "")
    .replace(/_+$/, "")
    .replace(/_+/g, "_")
    .slice(0, KEY_MAX_LENGTH);
}

/** Pick a unique key among an event's existing ticket-type keys (appends `_2`, `_3`, ...). */
export function uniqueTicketTypeKey(label: string, existingKeys: string[]): string {
  const base = slugifyTicketTypeKey(label) || "type";
  if (!existingKeys.includes(base)) return base;
  for (let n = 2; n < 100; n++) {
    const suffix = `_${n}`;
    const candidate = `${base.slice(0, Math.max(1, KEY_MAX_LENGTH - suffix.length))}${suffix}`;
    if (!existingKeys.includes(candidate)) return candidate;
  }
  return `${base}_${Date.now()}`;
}

/**
 * Eagerly seed the default "Standard" TicketType at event-creation time - idempotent (checks for
 * any existing row first, `skipDuplicates` as a second guard). Unlike `ensureBadgeEventItem`, no
 * lazy self-heal path is needed here: every pre-existing event is covered once by the one-time
 * `backfillTicketTypes` migration script (packages/db), so a new event is the only place this
 * needs to run.
 */
export async function ensureStandardTicketType(eventId: string, db: TicketTypeDb): Promise<void> {
  const existing = await db.ticketType.findFirst({
    where: { event_id: eventId },
    select: { id: true },
  });
  if (existing) return;

  await db.ticketType.createMany({
    data: [{ event_id: eventId, ...DEFAULT_TICKET_TYPE, sort_order: 0 }],
    skipDuplicates: true,
  });
}

/** Reads an event's ticket-type catalog, ordered for display - the single source of truth
 * consumed by the Event Settings tab, attendee create/edit, CSV import, filters, bulk-send, and
 * Reports alike. */
export async function loadEventTicketTypes(db: TicketTypeDb, eventId: string): Promise<TicketTypeInfo[]> {
  return db.ticketType.findMany({
    where: { event_id: eventId },
    orderBy: { sort_order: "asc" },
  });
}

/** Serializes create/delete for one event's ticket-type catalog against each other, closing the
 * same concurrent-create-vs-cap race as apps/web's acquireEventCustomFieldsLock. Exported so every
 * writer that assigns Attendee.ticket_type - apps/web's attendees-api-routes.ts and
 * import-api-routes.ts, and packages/import's cli.ts - can take the same lock and fully serialize
 * against a concurrent delete of the type it's about to reference (TOCTOU fix, code review). Lives
 * here rather than in apps/web because packages/import (the standalone CLI importer) needs it too
 * and cannot depend on apps/web (dependency direction is the other way) - packages/tickets is the
 * shared package both already depend on. */
export async function acquireEventTicketTypesLock(tx: Prisma.TransactionClient, eventId: string): Promise<void> {
  const lockKey = `ticket-types:${eventId}`;
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);
}

/** Thrown when a `ticket_type` value doesn't match any entry in the event's catalog. */
export class UnknownTicketTypeError extends Error {
  constructor(public readonly value: string) {
    super(`unknown_ticket_type:${value}`);
  }
}

/** Reject a `ticket_type` value if it isn't one of the event's catalog keys - exact match, since
 * every write path that reaches this (attendee create/edit API, PATCH) submits a catalog `key`
 * from a `Select`, never free text. CSV import needs a looser case-insensitive match against
 * `key` or `label` instead - see packages/import/src/importer.ts, which doesn't reuse this. */
export function assertTicketTypeInCatalog(
  catalog: TicketTypeInfo[],
  ticketType: string | null | undefined,
): void {
  if (!ticketType) return;
  const found = catalog.some((t) => t.key === ticketType);
  if (!found) throw new UnknownTicketTypeError(ticketType);
}
