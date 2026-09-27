import type { PrismaClient } from "@admitto/db";
import { emitSystemLog } from "@admitto/shared/system-log";
import { reconcileWalletPassLifecycle, type WalletPassLifecycleState } from "./reconcile-lifecycle.js";
import { snapshotToWalletPassFields } from "./snapshot-to-wallet-pass-fields.js";
import type { WalletProviderConsistencyPolicy, WalletProviderSnapshot } from "./types.js";

/** One WalletPass as it was read BEFORE the provider call the snapshot came from: its identity and
 * the lifecycle state the reconciliation decided from. The write below is conditioned on exactly
 * this, so anything that changed the row while the provider call was in flight (a Void, a
 * Restore, a delete-and-reissue) makes the write a quiet no-op instead of landing stale data. */
export type WalletPassSnapshotTarget = WalletPassLifecycleState & {
  attendeeId: string;
  providerPassId: string;
  userProvidedId: string;
};

export type ApplyProviderSnapshotOptions = {
  policy: WalletProviderConsistencyPolicy;
  /** See ReconcileWalletPassLifecycleInput.providerTimeZone. */
  providerTimeZone: string | null;
  now?: Date;
};

/**
 * Writes one found provider snapshot onto its WalletPass row - registration counts and first
 * download as before, plus the lifecycle transition the reconciliation allows (see
 * reconcileWalletPassLifecycle), all in ONE conditional write. A pass that turns voided/expired in
 * this same write therefore freezes the newest registration counts it will ever have: nothing polls
 * an inactive pass afterwards, so those are its last known values.
 *
 * Reads are ordered on `registration_sync_attempted_at`, stamped with the moment the snapshot was
 * OBSERVED (not when it was written): the write only lands while the stored value is not newer than
 * that. Two overlapping reads of one pass (the worker's tick, a manual Refresh, a `pass_voided`
 * webhook) can therefore never let the older observation overwrite the newer one, whichever
 * finishes last - which matters most for a stale "voided" read, since nothing polls a voided pass
 * again to correct it.
 *
 * Deliberately NOT `registration_checked_at`: that column is also written by
 * `applyWebhookUpdate` (passcreator-webhook.ts) for every plain registration delivery
 * (pushnotification_registered/unregistered), which carries no lifecycle observation at all. Using
 * it as the ordering key let an unrelated registration webhook that merely arrived while a
 * `pass_voided` re-read was in flight advance it past that read's `observedAt`, making the
 * re-read's own write look "stale" and silently drop the voided transition - `refreshOneWalletPassStatus`
 * doesn't throw on a mismatch, so the webhook handler answered 200 as if it had been applied, and
 * archived/switched-off events have no periodic sync to ever retry it (Codex review, 2026-09-27).
 * `registration_sync_attempted_at` is written only by the sync/refresh/webhook-reconciliation
 * paths that actually go through this function, never by a plain registration webhook, so it
 * can't be advanced by anything unrelated to an observation.
 *
 * Returns "conflict" (writes nothing) when the row no longer matches `target` or a newer
 * observation is already stored, and never throws for it - a caller looping over many passes
 * treats it like "already handled elsewhere".
 */
export async function applyProviderSnapshotToWalletPass(
  db: PrismaClient,
  target: WalletPassSnapshotTarget,
  snapshot: WalletProviderSnapshot,
  options: ApplyProviderSnapshotOptions,
): Promise<"applied" | "conflict"> {
  const now = options.now ?? new Date();
  const transition = reconcileWalletPassLifecycle({
    current: target,
    validity: snapshot.validity,
    observedAt: snapshot.observedAt,
    policy: options.policy,
    providerTimeZone: options.providerTimeZone,
  });

  const { count } = await db.walletPass.updateMany({
    where: {
      attendee_id: target.attendeeId,
      provider_pass_id: target.providerPassId,
      user_provided_id: target.userProvidedId,
      status: target.status,
      provider_commanded_at: target.provider_commanded_at,
      provider_removed_at: target.provider_removed_at,
      OR: [
        { registration_sync_attempted_at: null },
        { registration_sync_attempted_at: { lte: snapshot.observedAt } },
      ],
    },
    data: {
      ...snapshotToWalletPassFields(snapshot),
      registration_checked_at: now,
      registration_sync_attempted_at: snapshot.observedAt,
      ...(transition ? { status: transition } : {}),
      ...(transition === "voided" ? { voided_at: now } : {}),
    },
  });
  if (count === 0) return "conflict";

  if (transition) {
    emitSystemLog("wallet", "info", "wallet_pass_lifecycle_observed", {
      attendeeId: target.attendeeId,
      from: target.status,
      to: transition,
    });
  }
  return "applied";
}
