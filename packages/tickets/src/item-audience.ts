import type { Prisma, PrismaClient } from "@admitto/db";

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * Who an event item is offered to (`EventItemConfig.audience`, D-E5): `all` attendees, which is also what an item with no
 * audience means, or only the attendees who bring a companion (`with_companion`).
 */
export const EVENT_ITEM_AUDIENCES = ["all", "with_companion"] as const;
export type EventItemAudience = (typeof EVENT_ITEM_AUDIENCES)[number];

type AudienceConfig = { audience?: EventItemAudience } | null | undefined;

/** True for an item that is for the guests who bring a companion, and not for the others. */
export function isCompanionAudience(config: AudienceConfig): boolean {
  return config?.audience === "with_companion";
}

/**
 * THE rule of which items an attendee is offered: an item for guests with a companion is for those who have one, and
 * any other item is for everyone. Whatever lists the items of an attendee applies it, so that the check-in card, the
 * attendee page, the hand-out states a card makes and the items of the Reports log never disagree: the card of the
 * operator (getAttendeeCard), ensureAttendeeItemStates, transitionItemState, the summary on the attendee page
 * (loadAttendeeItemsSummary) and the items of the admission log (loadIssuedItemLabelsByAttendee). A new reader of an
 * attendee's items goes through here too; item-audience.test.ts lists the readers and fails for one it does not know.
 *
 * Whether the attendee has a companion is the existence of an `AttendeeCompanion` row, which an erased attendee keeps
 * (with a placeholder name), so the rule reads the same for them.
 */
export function itemAppliesToAttendee(config: AudienceConfig, hasCompanion: boolean): boolean {
  return !isCompanionAudience(config) || hasCompanion;
}

/** Whether the attendee has a companion. */
export async function attendeeHasCompanion(db: DbClient, attendeeId: string): Promise<boolean> {
  return (await db.attendeeCompanion.count({ where: { attendee_id: attendeeId } })) > 0;
}

/** Which of these attendees have a companion, in one read (the readers of many attendees' items). */
export async function attendeeIdsWithCompanion(db: DbClient, attendeeIds: readonly string[]): Promise<Set<string>> {
  if (attendeeIds.length === 0) return new Set();
  const rows = await db.attendeeCompanion.findMany({
    where: { attendee_id: { in: [...attendeeIds] } },
    select: { attendee_id: true },
    distinct: ["attendee_id"],
  });
  return new Set(rows.map((row) => row.attendee_id));
}

/**
 * The items (rows with a `config`) that apply to one attendee, in their order. The companion is looked up only when
 * one of the items is for guests with a companion, so an event without such an item pays nothing for the rule.
 */
export async function filterItemsForAttendee<T extends { config: unknown }>(
  db: DbClient,
  attendeeId: string,
  items: readonly T[],
): Promise<T[]> {
  const audienceOf = (item: T) => item.config as AudienceConfig;
  if (!items.some((item) => isCompanionAudience(audienceOf(item)))) return [...items];
  const hasCompanion = await attendeeHasCompanion(db, attendeeId);
  return items.filter((item) => itemAppliesToAttendee(audienceOf(item), hasCompanion));
}
