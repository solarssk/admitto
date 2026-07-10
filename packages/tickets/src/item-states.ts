import type { Prisma, PrismaClient } from "@prisma/client";
import type { AttendeeStatus } from "@admitto/db";
import { ensureBadgeEventItem } from "./event-items.js";
import { writeActionLog, type OpsAuditContext } from "./ops-audit.js";
import { isAdmittable } from "./admittable.js";

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

/**
 * Lazy-init pending rows for enabled EventItems — idempotent (Lock #2).
 * Also ensures the default "badge" item exists first (safety net for events
 * created outside the admin API, e.g. seed scripts / legacy rows).
 */
export async function ensureAttendeeItemStates(
  attendeeId: string,
  eventId: string,
  db: DbClient,
): Promise<void> {
  await ensureBadgeEventItem(eventId, db);

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

/** Shared attendee lookup for both item-transition paths below — throws the same error either way. */
async function loadAttendeeForItemAction(
  tx: DbClient,
  attendeeId: string,
  eventId: string,
): Promise<{ id: string; status: AttendeeStatus }> {
  const attendee = await tx.attendee.findFirst({
    where: { id: attendeeId, event_id: eventId },
    select: { id: true, status: true },
  });
  if (!attendee) {
    throw new IllegalItemTransitionError("Attendee not found for this event");
  }
  return { id: attendee.id, status: attendee.status as AttendeeStatus };
}

/** Operator-visible actions for current state; omits return when `requires_return` is false. */
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
    await loadAttendeeForItemAction(tx, params.attendeeId, params.eventId);

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

/**
 * Force one item state back to "pending" and audit it. Privileged/admin path:
 * bypasses OPERATOR_TRANSITIONS on purpose (issued OR returned → pending),
 * separate from the operator's forward-only machine. The `state: fromState`
 * filter guards against a concurrent change: if another caller already reset
 * this item to "pending" in the meantime, that's a harmless race and this is
 * a no-op; any other observed state means a *different* concurrent change
 * raced this one, which is surfaced as an error rather than silently
 * dropped (matches transitionItemState's same-shaped race check above).
 */
async function resetItemStateToPending(
  tx: Prisma.TransactionClient,
  params: {
    attendeeId: string;
    eventId: string;
    eventItemId: string;
    itemKey: string;
    fromState: string;
    audit: OpsAuditContext;
  },
): Promise<void> {
  const updated = await tx.attendeeItemState.updateMany({
    where: {
      attendee_id: params.attendeeId,
      event_item_id: params.eventItemId,
      state: params.fromState,
    },
    data: { state: "pending", updated_by: params.audit.operator ?? null },
  });
  if (updated.count === 0) {
    const reread = await tx.attendeeItemState.findUnique({
      where: {
        attendee_id_event_item_id: { attendee_id: params.attendeeId, event_item_id: params.eventItemId },
      },
    });
    if (reread?.state === "pending") return;
    throw new IllegalItemTransitionError(`Concurrent transition on ${params.itemKey}`);
  }

  await writeActionLog(tx, {
    event_id: params.eventId,
    attendee_id: params.attendeeId,
    action_type: "item_revoked",
    audit: params.audit,
    metadata: { event_item_key: params.itemKey, from_state: params.fromState, to_state: "pending" },
  });
}

/**
 * Admin/superadmin-only: reset a single handed-out item back to "pending" so it
 * can be issued again ("cofnąć to że się to wydało"). Unlike transitionItemState
 * this is NOT gated by OPERATOR_TRANSITIONS — issued OR returned both go
 * straight to pending. Idempotent: an already-pending item is a harmless no-op
 * (no state change, no audit row). Gated by canManageEvent at the route level,
 * and independently rejects a blocked (revoked/cancelled) pass server-side —
 * the admin card's Revoke button hides itself for a blocked pass too, but
 * that's UX only, not the enforcement boundary. Doesn't require the item to
 * still be `enabled`: this corrects a *past* hand-out regardless of whether
 * the item type is still offered going forward — unlike the operator's
 * forward-only transitionItemState, which shouldn't let anyone issue a
 * disabled item but has no reason to block undoing one that was already
 * issued before it got disabled.
 */
export async function revokeItemState(
  params: {
    attendeeId: string;
    eventId: string;
    itemKey: string;
    audit: OpsAuditContext;
  },
  prisma: PrismaClient,
): Promise<{ state: string }> {
  return prisma.$transaction(async (tx) => {
    const attendee = await loadAttendeeForItemAction(tx, params.attendeeId, params.eventId);
    if (!isAdmittable(attendee.status)) {
      throw new IllegalItemTransitionError("Attendee's pass is not active");
    }

    const item = await tx.eventItem.findFirst({
      where: { event_id: params.eventId, key: params.itemKey },
    });
    if (!item) throw new IllegalItemTransitionError("Item not found or disabled");

    const current = await tx.attendeeItemState.findUnique({
      where: {
        attendee_id_event_item_id: { attendee_id: params.attendeeId, event_item_id: item.id },
      },
    });
    const fromState = current?.state ?? "pending";
    if (fromState === "pending") return { state: "pending" };

    await resetItemStateToPending(tx, {
      attendeeId: params.attendeeId,
      eventId: params.eventId,
      eventItemId: item.id,
      itemKey: params.itemKey,
      fromState,
      audit: params.audit,
    });
    return { state: "pending" };
  });
}

/**
 * Reset EVERY non-pending item for this attendee back to "pending" in the
 * caller's transaction — the blanket version used when an admin revokes a
 * check-in ("i wtedy przy revoke checkin było też revoke items ... bez
 * zagłębiania się w które itemy"). Deliberately coarser than
 * rollbackBadgeForCheckIn: no attempt to trace which check-in issued which
 * item — just clear them all. Since this already covers the auto-issued badge,
 * the admin-revoke path uses this instead of rollbackBadgeForCheckIn. Each item
 * actually reset is audited (item_revoked).
 */
export async function resetAllItemStatesForRevoke(
  tx: Prisma.TransactionClient,
  params: {
    attendeeId: string;
    eventId: string;
    audit: OpsAuditContext;
  },
): Promise<void> {
  const states = await tx.attendeeItemState.findMany({
    where: { attendee_id: params.attendeeId, state: { not: "pending" } },
    select: { event_item_id: true, state: true },
  });
  if (states.length === 0) return;

  const items = await tx.eventItem.findMany({
    where: { id: { in: states.map((s) => s.event_item_id) } },
    select: { id: true, key: true },
  });
  // Every event_item_id in `states` resolves here: same transaction, no
  // deletion in between, and AttendeeItemState.event_item cascade-deletes
  // (schema.prisma) so an orphaned state row can't exist either way.
  const keyById = new Map(items.map((i) => [i.id, i.key]));

  for (const s of states) {
    await resetItemStateToPending(tx, {
      attendeeId: params.attendeeId,
      eventId: params.eventId,
      eventItemId: s.event_item_id,
      itemKey: keyById.get(s.event_item_id)!,
      fromState: s.state,
      audit: params.audit,
    });
  }
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
