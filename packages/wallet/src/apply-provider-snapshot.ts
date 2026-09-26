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
 * Returns "conflict" (writes nothing) when the row no longer matches `target`, and never throws for
 * it - a caller looping over many passes treats it like "already handled elsewhere". Stamps
 * registration_checked_at and registration_sync_attempted_at like the callers' own success writes
 * did before this existed.
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
    },
    data: {
      ...snapshotToWalletPassFields(snapshot),
      registration_checked_at: now,
      registration_sync_attempted_at: now,
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
