import type { PrismaClient } from "@admitto/db";
import { applyProviderSnapshotToWalletPass, type WalletPassProvider } from "@admitto/wallet";
import { lockAttendeeRow } from "./attendee-lock.js";
import { writeActionLog, type OpsAuditContext } from "./ops-audit.js";

/**
 * `removed` - this call stamped the row. `already_removed` - the row was already stamped (an earlier
 * call, or a concurrent one that won the race). `not_found` - the WalletPass row is gone (erased
 * while the provider call was in flight). `changed` - the row now holds a different provider pass
 * than the one that was deleted (deleted and re-added in between), so there is nothing to stamp.
 * Callers treat everything except `removed` and `already_removed` as "not stamped".
 */
export type RemoveWalletPassOutcome = "removed" | "already_removed" | "not_found" | "changed";

/**
 * Permanently removes one wallet pass from the provider while keeping the local WalletPass row and
 * its history (Reports, registration counts) - the answer to the problem "Delete wallet pass" can't
 * solve, since that one wipes the row itself. Only meaningful for a pass that is already `voided`
 * or `expired` (the caller enforces that, along with `provider.capabilities.remoteDelete`, before
 * calling this - see the single/bulk routes) and never changes `status`: this is a provider-presence
 * action, not a validity one.
 *
 * Already-removed (`providerRemovedAt` already set) is treated as success without touching
 * anything - `deletePass` is idempotent at the provider too, but skipping it here avoids a wasted
 * call for a selection that includes a pass another request already removed.
 *
 * Order matters, same reasoning as the plan's own "Remove" business rule:
 * 1. A best-effort final snapshot read (only when a `userProvidedId` is known - a row that somehow
 *    lacks one has nothing to look up by). Found: applied through the same
 *    applyProviderSnapshotToWalletPass every other read goes through, so the very last registration
 *    counts this pass will ever have are as fresh as possible. `null` (no match) leaves the
 *    existing data alone without drawing any conclusion - it is not proof of anything. A thrown
 *    provider error aborts this pass entirely (the caller's Promise.allSettled counts it as failed,
 *    safe to retry) rather than proceeding to delete without knowing what was last true.
 * 2. A second, later re-read, right before the one call that cannot be undone - the same
 *    provider_commanded_at compare-and-swap voidOneWalletPassAtProvider uses at its write, just
 *    moved ahead of the provider call instead of after it, because delete has no self-heal to fall
 *    back on. Every caller (single-attendee, bulk, and the event-wide job) does its own eligibility
 *    check before calling this function, but that check can be seconds to minutes stale by the time
 *    this point is reached, including across the snapshot read in step 1. A status or
 *    provider_commanded_at that no longer matches what the caller last knew - a Restore, most
 *    plausibly - aborts before `deletePass` fires, as `changed`, the same outcome already used for
 *    a post-delete identity mismatch, so every caller already handles it. This narrows the race to
 *    the `deletePass` round trip itself, which cannot be closed without a distributed lock.
 * 3. Always `deletePass(providerPassId)` - 2xx or 404 (already gone) both count as success, per its
 *    own contract.
 * 4. Only once that has genuinely succeeded: stamp `provider_removed_at` and write the action log
 *    entry, in one transaction. The stamp is conditional (same pass identity, not yet removed), so
 *    two concurrent removals log one entry between them; the loser reports `already_removed`. If a
 *    concurrent Restore landed in the one window step 2 cannot close (during `deletePass` itself),
 *    the remote pass is gone regardless and a removed pass is always inactive, so the row is put
 *    back to `voided` in the same transaction (the log entry says so) instead of being left `active`
 *    with nothing behind it at the provider.
 */
export async function removeOneWalletPassFromProvider(
  db: PrismaClient,
  eventId: string,
  target: {
    attendeeId: string;
    providerPassId: string;
    userProvidedId: string | null;
    status: string;
    providerCommandedAt: Date | null;
    providerRemovedAt: Date | null;
  },
  provider: WalletPassProvider,
  audit: OpsAuditContext,
  options: { bulk?: boolean; eventWide?: boolean } = {},
): Promise<RemoveWalletPassOutcome> {
  if (target.providerRemovedAt) return "already_removed";

  if (target.userProvidedId) {
    const snapshot = await provider.getPassSnapshot({
      providerPassId: target.providerPassId,
      userProvidedId: target.userProvidedId,
    });
    if (snapshot) {
      await applyProviderSnapshotToWalletPass(
        db,
        {
          attendeeId: target.attendeeId,
          providerPassId: target.providerPassId,
          userProvidedId: target.userProvidedId,
          status: target.status,
          provider_commanded_at: target.providerCommandedAt,
          provider_removed_at: null,
        },
        snapshot,
        { policy: provider.consistencyPolicy, providerTimeZone: null },
      );
    }
  }

  const stillEligible = await db.walletPass.findFirst({
    where: { attendee_id: target.attendeeId, provider_pass_id: target.providerPassId },
    select: { status: true, provider_removed_at: true, provider_commanded_at: true },
  });
  if (!stillEligible) return "not_found";
  if (stillEligible.provider_removed_at) return "already_removed";
  if (stillEligible.status !== "voided" && stillEligible.status !== "expired") return "changed";
  if ((stillEligible.provider_commanded_at?.getTime() ?? null) !== (target.providerCommandedAt?.getTime() ?? null)) {
    return "changed";
  }

  await provider.deletePass(target.providerPassId);

  return db.$transaction(async (tx): Promise<RemoveWalletPassOutcome> => {
    // Attendee row first, like an erasure, so the two cannot deadlock over the pass row. The
    // removal itself is recorded whoever the attendee is: the pass is gone at the provider.
    await lockAttendeeRow(tx, target.attendeeId);
    const now = new Date();
    const { count } = await tx.walletPass.updateMany({
      where: {
        attendee_id: target.attendeeId,
        provider_pass_id: target.providerPassId,
        provider_removed_at: null,
      },
      data: { provider_removed_at: now },
    });
    if (count === 0) {
      const current = await tx.walletPass.findUnique({
        where: { attendee_id: target.attendeeId },
        select: { provider_removed_at: true },
      });
      if (!current) return "not_found";
      return current.provider_removed_at ? "already_removed" : "changed";
    }

    const { count: statusReset } = await tx.walletPass.updateMany({
      where: { attendee_id: target.attendeeId, status: { notIn: ["voided", "expired"] } },
      data: { status: "voided", voided_at: now },
    });
    await writeActionLog(tx, {
      event_id: eventId,
      attendee_id: target.attendeeId,
      action_type: "wallet_pass_removed",
      audit,
      metadata: {
        ...(options.bulk ? { bulk: true } : {}),
        ...(options.eventWide ? { event_wide: true } : {}),
        ...(statusReset > 0 ? { status_reset: true } : {}),
      },
    });
    return "removed";
  });
}
