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
 * Returns "suppressed" instead of "applied" when the provider reported the pass voided but
 * reconcileWalletPassLifecycle held the transition back for being too close to Admitto's own last
 * command - the registration-count write still happens exactly as for "applied". A caller that only
 * cares about registration data (the periodic sync, a manual Refresh) can treat "suppressed" the
 * same as "applied"; a caller acting on an external signal (the `pass_voided` webhook) must not, or
 * a real void that happens to land in that window is silently lost forever on an archived or
 * switched-off event.
 *
 * Reads are ordered on `lifecycle_observed_at`, stamped with the moment the snapshot was OBSERVED
 * (not when it was written): the write only lands while the stored value is STRICTLY older than
 * that (`<`, not `<=`). Two overlapping reads of one pass (the worker's tick, a manual Refresh, a
 * `pass_voided` webhook) can therefore never let the older observation overwrite the newer one,
 * whichever finishes last - which matters most for a stale "voided" read, since nothing polls a
 * voided pass again to correct it. The strict inequality also covers the tie itself: two reads that
 * happen to share the same millisecond-resolution `observedAt` (Date/`TIMESTAMP(3)` both truncate
 * to milliseconds) are not orderable by timestamp alone, and a non-strict `<=` would let whichever
 * one simply finishes its DB write last win regardless of which one is actually fresher - possibly
 * applying a stale transition after a genuinely newer one already landed. With `<`, only the FIRST
 * write for a given timestamp (equal or otherwise) can ever land; a second one claiming the exact
 * same instant becomes an ordinary "conflict" instead of a coin-flip overwrite (Codex review,
 * 2026-09-27) - the same safe, self-correcting outcome every other race in this function already
 * falls back to.
 *
 * `lifecycle_observed_at` has exactly one writer: this function, only when a snapshot was actually
 * read. It is deliberately its own column, not reused from `registration_checked_at` or
 * `registration_sync_attempted_at` - both of those are also written, with no observation attached
 * at all, by code paths that only ever decided NOT to read the provider: `applyWebhookUpdate`
 * (passcreator-webhook.ts) for a plain registration delivery, `syncOne`'s own no-match/failure
 * branch, and `syncEventBucket`'s whole-event "wallet not configured" skip (all in
 * registration-sync.ts). Using either of those shared columns as the ordering key let one of those
 * no-data writes race ahead of, and silently discard, a real observation - found three times over
 * (Codex review, 2026-09-27) before landing on a column nothing else can touch.
 * `registration_sync_attempted_at` keeps its original, simpler job: the periodic worker's own
 * oldest-first scheduling/backoff marker, bumped by this function too so a row it just read isn't
 * immediately re-selected, but never read back by anything as evidence of what the provider said.
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
): Promise<"applied" | "conflict" | "suppressed"> {
  const now = options.now ?? new Date();
  const { transition, suppressedByRecentCommand } = reconcileWalletPassLifecycle({
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
      OR: [{ lifecycle_observed_at: null }, { lifecycle_observed_at: { lt: snapshot.observedAt } }],
    },
    data: {
      ...snapshotToWalletPassFields(snapshot),
      registration_checked_at: now,
      registration_sync_attempted_at: now,
      lifecycle_observed_at: snapshot.observedAt,
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
  return suppressedByRecentCommand ? "suppressed" : "applied";
}
