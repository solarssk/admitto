import type { PrismaClient } from "@admitto/db";
import { emitSystemLog } from "@admitto/shared/system-log";
import type { WalletPassProvider } from "@admitto/wallet";
import { writeActionLog, type OpsAuditContext } from "./ops-audit.js";

/** `voided` - this call voided the pass at the provider and recorded it locally. `skipped` - not
 * an active, still-managed pass (already voided or expired, or removed at the provider), or one that
 * changed (voided and restored, removed, replaced) since the caller read it. */
export type VoidWalletPassOutcome = "voided" | "skipped";

/**
 * Voids one active wallet pass at the provider and marks the local row `voided`. Shared by the
 * bulk "Void wallet pass" selection route and the event-wide wallet_void_active job, so the two
 * cannot drift apart: same eligibility rule, same conditional write, same action-log entry.
 *
 * `target` is a snapshot: for an event-wide job it was read minutes before this pass's turn, and
 * another operator (or the periodic sync) may have voided, restored, expired or removed the pass
 * since. So the row is read again right before the provider call and the pass is skipped unless it
 * is still active, not removed and, when the snapshot carried `providerCommandedAt`, untouched by
 * any Void or Restore since (that stamp is what a void-then-restore leaves behind). The local write
 * then matches that same state (status, command stamp, pass identity, not removed), so a change
 * landing during the provider call is never overwritten with `voided`.
 *
 * If that write finds the pass restored meanwhile (someone's Restore landed between the re-read and
 * the void reaching the provider), the provider may now hold our void over their Restore while
 * Admitto shows the pass active. A Restore is an explicit, newer decision than a sweep over
 * "everything active", so it wins: the pass is restored at the provider again (see
 * realignRestoredPass) and counted as skipped, instead of leaving the two sides to drift until the
 * background check notices.
 */
export async function voidOneWalletPassAtProvider(
  db: PrismaClient,
  eventId: string,
  target: {
    attendeeId: string;
    providerPassId: string;
    status: string;
    providerRemovedAt: Date | null;
    providerCommandedAt?: Date | null;
  },
  provider: WalletPassProvider,
  audit: OpsAuditContext,
  options: { eventWide?: boolean } = {},
): Promise<VoidWalletPassOutcome> {
  if (target.status !== "active" || target.providerRemovedAt) return "skipped";
  const current = await db.walletPass.findFirst({
    where: { attendee_id: target.attendeeId, provider_pass_id: target.providerPassId },
    select: { status: true, provider_removed_at: true, provider_commanded_at: true },
  });
  if (current?.status !== "active" || current.provider_removed_at) return "skipped";
  const commandedSince =
    target.providerCommandedAt !== undefined &&
    (target.providerCommandedAt?.getTime() ?? null) !== (current.provider_commanded_at?.getTime() ?? null);
  if (commandedSince) return "skipped";

  await provider.voidPass(target.providerPassId);
  const outcome = await db.$transaction(async (tx): Promise<"voided" | "lost"> => {
    const now = new Date();
    const { count } = await tx.walletPass.updateMany({
      // The pass identity and the state that was checked are part of the predicate, like the
      // removal helper's: a pass deleted and issued again, restored, expired or removed while the
      // provider call was in flight is not the pass this call voided, and its row must not be
      // marked voided.
      where: {
        attendee_id: target.attendeeId,
        provider_pass_id: target.providerPassId,
        provider_removed_at: null,
        status: "active",
        provider_commanded_at: current.provider_commanded_at,
      },
      data: { status: "voided", voided_at: now, provider_commanded_at: now, last_error_code: null },
    });
    // Changed, removed or replaced while this pass was being processed: nothing to mark.
    if (count === 0) return "lost";
    await writeActionLog(tx, {
      event_id: eventId,
      attendee_id: target.attendeeId,
      action_type: "wallet_pass_voided",
      audit,
      metadata: { bulk: true, ...(options.eventWide ? { event_wide: true } : {}) },
    });
    return "voided";
  });
  if (outcome === "lost") await realignRestoredPass(db, eventId, target, provider);
  return outcome === "voided" ? "voided" : "skipped";
}

/**
 * The void reached the provider but the local write found the pass changed. The one case that
 * leaves the two sides disagreeing is a Restore that landed in that gap: the row is `active` again
 * (same pass, not removed) while the provider may hold our void. The Restore is the newer, explicit
 * decision, so the provider is told to restore the pass again (idempotent) and the row's command
 * stamp is refreshed, which keeps a stale "voided" read of the provider's lagging search from being
 * taken for a real void. Every other change needs nothing: a removed pass is gone, an expired one is
 * expired either way, and a replaced pass is a different pass.
 *
 * Best effort: a failure here is logged and leaves the pass to the periodic check, which brings a
 * provider-side void into line with what Admitto recorded, so it never turns the pass into an error
 * of the job.
 */
async function realignRestoredPass(
  db: PrismaClient,
  eventId: string,
  target: { attendeeId: string; providerPassId: string },
  provider: WalletPassProvider,
): Promise<void> {
  try {
    const now = await db.walletPass.findFirst({
      where: { attendee_id: target.attendeeId, provider_pass_id: target.providerPassId },
      select: { status: true, provider_removed_at: true },
    });
    if (now?.status !== "active" || now.provider_removed_at) return;
    await provider.restorePass(target.providerPassId);
    await db.walletPass.updateMany({
      where: {
        attendee_id: target.attendeeId,
        provider_pass_id: target.providerPassId,
        provider_removed_at: null,
        status: "active",
      },
      data: { provider_commanded_at: new Date() },
    });
  } catch (err) {
    emitSystemLog("wallet", "warn", "wallet_void_realign_failed", {
      event_id: eventId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
