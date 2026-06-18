import type { Prisma, PrismaClient } from "@prisma/client";
import { ensureDefaultEventItems } from "./event-items.js";
import { writeActionLog, type OpsAuditContext } from "./ops-audit.js";

import type { EventItemConfig } from "./types.js";

type DbClient = PrismaClient | Prisma.TransactionClient;

const OPERATOR_TRANSITIONS: Record<string, string[]> = {
  pending: ["issued"],
  issued: ["returned"],
};

export class IllegalItemTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IllegalItemTransitionError";
  }
}

/** Lazy-init pending rows for enabled EventItems — idempotent (Lock #2). */
export async function ensureAttendeeItemStates(
  attendeeId: string,
  eventId: string,
  db: DbClient,
): Promise<void> {
  await ensureDefaultEventItems(eventId, db);

  const items = await db.eventItem.findMany({
    where: { event_id: eventId, enabled: true },
    select: { id: true },
  });
  if (items.length === 0) return;

  await db.attendeeItemState.createMany({
    data: items.map((item) => ({
      attendee_id: attendeeId,
      event_item_id: item.id,
      state: "pending",
    })),
    skipDuplicates: true,
  });
}

function allowedTarget(current: string, target: string): boolean {
  return OPERATOR_TRANSITIONS[current]?.includes(target) ?? false;
}

/** Operator-visible actions for current state and item config. */
export function operatorItemActions(
  state: string,
  config?: EventItemConfig | null,
): string[] {
  const actions = OPERATOR_TRANSITIONS[state] ?? [];
  if (state === "issued" && config?.requires_return === false) {
    return actions.filter((action) => action !== "returned");
  }
  return actions;
}

/**
 * Issue badge in same transaction as check-in (Lock #1).
 * Caller must have already created CheckIn and pass its id for undo linkage.
 */
export async function issueBadgeOnCheckIn(
  tx: Prisma.TransactionClient,
  params: {
    attendeeId: string;
    eventId: string;
    checkInId: string;
    audit: OpsAuditContext;
  },
): Promise<void> {
  const badgeItem = await tx.eventItem.findFirst({
    where: { event_id: params.eventId, key: "badge", enabled: true },
  });
  if (!badgeItem) return;

  const config = badgeItem.config as { issue_on_checkin?: boolean } | null;
  if (config?.issue_on_checkin === false) return;

  await ensureAttendeeItemStates(params.attendeeId, params.eventId, tx);

  const updated = await tx.attendeeItemState.updateMany({
    where: {
      attendee_id: params.attendeeId,
      event_item_id: badgeItem.id,
      state: "pending",
    },
    data: { state: "issued", updated_by: params.audit.operator ?? null },
  });

  if (updated.count === 0) return;

  await writeActionLog(tx, {
    event_id: params.eventId,
    attendee_id: params.attendeeId,
    action_type: "item_issued",
    audit: params.audit,
    metadata: {
      event_item_key: "badge",
      check_in_id: params.checkInId,
    },
  });
}

/**
 * Conditional/idempotent item transition — operator paths only (Lock known limitation).
 * lost / problem / not_applicable → IllegalItemTransitionError.
 */
export async function transitionItemState(
  params: {
    attendeeId: string;
    eventId: string;
    itemKey: string;
    targetState: string;
    audit: OpsAuditContext;
  },
  prisma: PrismaClient,
): Promise<{ state: string }> {
  return prisma.$transaction(async (tx) => {
    const attendee = await tx.attendee.findFirst({
      where: { id: params.attendeeId, event_id: params.eventId },
      select: { id: true },
    });
    if (!attendee) {
      throw new IllegalItemTransitionError("Attendee not found for this event");
    }

    await ensureAttendeeItemStates(params.attendeeId, params.eventId, tx);

    const item = await tx.eventItem.findFirst({
      where: { event_id: params.eventId, key: params.itemKey, enabled: true },
    });
    if (!item) throw new IllegalItemTransitionError("Item not found or disabled");

    const current = await tx.attendeeItemState.findUnique({
      where: {
        attendee_id_event_item_id: { attendee_id: params.attendeeId, event_item_id: item.id },
      },
    });
    const fromState = current?.state ?? "pending";
    if (!allowedTarget(fromState, params.targetState)) {
      throw new IllegalItemTransitionError(`Illegal transition ${fromState} → ${params.targetState}`);
    }

    const itemConfig = item.config as EventItemConfig | null;
    if (params.targetState === "returned" && itemConfig?.requires_return === false) {
      throw new IllegalItemTransitionError("Return is not enabled for this item");
    }

    const updated = await tx.attendeeItemState.updateMany({
      where: {
        attendee_id: params.attendeeId,
        event_item_id: item.id,
        state: fromState,
      },
      data: { state: params.targetState, updated_by: params.audit.operator ?? null },
    });

    if (updated.count === 0) {
      const reread = await tx.attendeeItemState.findUnique({
        where: {
          attendee_id_event_item_id: { attendee_id: params.attendeeId, event_item_id: item.id },
        },
      });
      if (reread?.state === params.targetState) return { state: params.targetState };
      throw new IllegalItemTransitionError(`Concurrent transition on ${params.itemKey}`);
    }

    const actionType = params.targetState === "returned" ? "item_returned" : "item_issued";
    await writeActionLog(tx, {
      event_id: params.eventId,
      attendee_id: params.attendeeId,
      action_type: actionType,
      audit: params.audit,
      metadata: { event_item_key: params.itemKey, from_state: fromState, to_state: params.targetState },
    });

    return { state: params.targetState };
  });
}

/** Roll back badge issued during a specific check-in (Lock #1 undo). */
export async function rollbackBadgeForCheckIn(
  tx: Prisma.TransactionClient,
  params: {
    attendeeId: string;
    eventId: string;
    checkInId: string;
    audit: OpsAuditContext;
  },
): Promise<void> {
  const badgeLog = await tx.attendeeActionLog.findFirst({
    where: {
      event_id: params.eventId,
      attendee_id: params.attendeeId,
      action_type: "item_issued",
      metadata: { path: ["check_in_id"], equals: params.checkInId },
    },
  });
  if (!badgeLog) return;

  const badgeItem = await tx.eventItem.findFirst({
    where: { event_id: params.eventId, key: "badge" },
  });
  if (!badgeItem) return;

  const updated = await tx.attendeeItemState.updateMany({
    where: {
      attendee_id: params.attendeeId,
      event_item_id: badgeItem.id,
      state: "issued",
    },
    data: { state: "pending", updated_by: params.audit.operator ?? null },
  });

  if (updated.count === 0) return;

  await writeActionLog(tx, {
    event_id: params.eventId,
    attendee_id: params.attendeeId,
    action_type: "item_returned",
    audit: params.audit,
    metadata: {
      event_item_key: "badge",
      check_in_id: params.checkInId,
      reason: "check_in_undo",
    },
  });
}
